package probe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/usage"
)

// AccountController toggles CPA auth-file availability for high-availability management.
type AccountController interface {
	SetAuthFileDisabled(ctx context.Context, fileName string, disabled bool) error
}

// UpstreamResolver supplies the current CPA upstream credentials for account actions.
type UpstreamResolver interface {
	ResolveCPAUpstream(ctx context.Context) (baseURL string, managementKey string, ok bool)
}

// Manager consumes collected usage events as asynchronous probe results and
// optionally adjusts key priority/status plus CPA account online/offline state.
type Manager struct {
	store    *Store
	upstream UpstreamResolver
	queue    chan []usage.Event
	worker   sync.Once

	mu                sync.Mutex
	cfg               Config
	status            Status
	httpClient        *http.Client
	lastConfigRefresh time.Time
}

func NewManager(store *Store, upstream UpstreamResolver) *Manager {
	cfg := DefaultConfig()
	return &Manager{
		store:    store,
		upstream: upstream,
		queue:    make(chan []usage.Event, 64),
		cfg:      cfg,
		status: Status{
			Enabled:       cfg.Enabled,
			ServiceStatus: "stopped",
			Config:        cfg,
		},
		httpClient: &http.Client{Timeout: 12 * time.Second},
	}
}

func (m *Manager) EnsureReady(ctx context.Context) error {
	if err := m.store.EnsureSchema(ctx); err != nil {
		return err
	}
	cfg, err := m.store.LoadConfig(ctx)
	if err != nil {
		return err
	}
	m.applyConfigLocked(cfg)
	m.worker.Do(func() {
		go m.run(context.Background())
	})
	return nil
}

func (m *Manager) Config() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cfg
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	status := m.status
	status.Config = m.cfg
	status.Enabled = m.cfg.Enabled
	status.QueueDepth = len(m.queue)
	return status
}

func (m *Manager) UpdateConfig(ctx context.Context, cfg Config) (Config, error) {
	cfg = cfg.Normalize()
	if err := m.store.SaveConfig(ctx, cfg); err != nil {
		return Config{}, err
	}
	m.mu.Lock()
	m.applyConfigLocked(cfg)
	m.mu.Unlock()
	return cfg, nil
}

func (m *Manager) applyConfigLocked(cfg Config) {
	m.cfg = cfg.Normalize()
	m.status.Config = m.cfg
	m.status.Enabled = m.cfg.Enabled
	if m.cfg.Enabled {
		m.status.ServiceStatus = "running"
	} else {
		m.status.ServiceStatus = "stopped"
	}
	m.lastConfigRefresh = time.Now()
}

func (m *Manager) refreshConfigIfNeeded(ctx context.Context) {
	m.mu.Lock()
	needsRefresh := time.Since(m.lastConfigRefresh) > 5*time.Second
	m.mu.Unlock()
	if !needsRefresh {
		return
	}
	cfg, err := m.store.LoadConfig(ctx)
	if err != nil {
		return
	}
	m.mu.Lock()
	m.applyConfigLocked(cfg)
	m.mu.Unlock()
}

// ProcessUsageEvents enqueues a collector batch so HA actions never block collection.
func (m *Manager) ProcessUsageEvents(ctx context.Context, events []usage.Event) {
	if len(events) == 0 {
		return
	}
	batch := append([]usage.Event(nil), events...)
	select {
	case m.queue <- batch:
	default:
		m.mu.Lock()
		m.status.DroppedBatches++
		m.status.LastError = "probe queue is full"
		m.status.ServiceStatus = "degraded"
		m.mu.Unlock()
	}
}

func (m *Manager) run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.expireDueKeys(ctx)
		case events := <-m.queue:
			m.processBatch(ctx, events)
		}
	}
}

func (m *Manager) processBatch(ctx context.Context, events []usage.Event) {
	m.refreshConfigIfNeeded(ctx)
	m.mu.Lock()
	cfg := m.cfg
	m.mu.Unlock()
	if !cfg.Enabled {
		return
	}

	actionsApplied := 0
	for _, event := range events {
		if strings.TrimSpace(event.EventHash) == "" {
			continue
		}
		result := resultFromEvent(event)
		var match keyMatch
		var matched bool
		if found, ok, err := m.store.FindKeyByAuthIndex(ctx, result.AuthIndex); err == nil && ok {
			match = found
			matched = true
			id := match.ID
			result.KeyID = &id
			if match.ProviderID.Valid {
				providerID := match.ProviderID.Int64
				result.ProviderID = &providerID
			}
			if result.ProviderName == "" {
				result.ProviderName = match.ProviderName
			}
			if result.AuthFile == "" {
				result.AuthFile = match.AuthFile
			}
		}

		inserted, err := m.store.InsertResult(ctx, result)
		if err != nil {
			m.markError(err)
			continue
		}
		if !inserted {
			continue
		}

		m.mu.Lock()
		m.status.TotalProcessed++
		m.status.LastProcessedAtMS = nowMS()
		m.status.ServiceStatus = "running"
		m.status.LastError = ""
		m.mu.Unlock()

		if !matched {
			continue
		}
		policy, enabled := effectivePolicy(cfg, match.ProviderPolicy, match.ProbePolicy)
		if match.ExpiresAtMS.Valid && match.ExpiresAtMS.Int64 > 0 && match.ExpiresAtMS.Int64 <= nowMS() {
			action, detail, applied := m.expireMatchedKey(ctx, policy, match, result)
			if applied {
				actionsApplied++
				_ = m.store.UpdateResultAction(ctx, result.EventHash, action, detail)
			}
			continue
		}
		if !enabled {
			continue
		}
		if result.Success && policy.RenewExpiryOnSuccess && policy.RenewalSeconds > 0 {
			nextExpiry := nowMS() + int64(policy.RenewalSeconds)*1000
			if err := m.store.UpdateKeyExpiration(ctx, match.ID, nextExpiry); err == nil {
				_ = m.store.InsertActionLog(ctx, ActionLog{CreatedAtMS: nowMS(), AuthIndex: result.AuthIndex, KeyID: result.KeyID, Action: "expiry_renew", Detail: fmt.Sprintf("%d", nextExpiry), Success: true})
			}
		}
		if actionsApplied >= policy.MaxActionsPerBatch {
			continue
		}
		action, detail, applied := m.applyPolicies(ctx, policy, result)
		if !applied {
			continue
		}
		actionsApplied++
		_ = m.store.UpdateResultAction(ctx, result.EventHash, action, detail)
		m.mu.Lock()
		m.status.TotalActions++
		m.mu.Unlock()
	}
}

func parseKeyPolicy(raw string) KeyPolicy {
	var policy KeyPolicy
	_ = json.Unmarshal([]byte(strings.TrimSpace(raw)), &policy)
	return policy
}

func effectivePolicy(base Config, providerRaw, keyRaw string) (Config, bool) {
	providerConfig, providerEnabled := parseKeyPolicy(providerRaw).Apply(base)
	keyConfig, keyEnabled := parseKeyPolicy(keyRaw).Apply(providerConfig)
	return keyConfig, providerEnabled && keyEnabled
}

func (m *Manager) expireDueKeys(ctx context.Context) {
	m.mu.Lock()
	cfg := m.cfg
	m.mu.Unlock()
	if !cfg.Enabled {
		return
	}
	items, err := m.store.ExpireDueKeys(ctx, nowMS(), 200)
	if err != nil {
		m.markError(err)
		return
	}
	for _, item := range items {
		policy, _ := effectivePolicy(cfg, item.ProviderPolicy, item.ProbePolicy)
		result, ok, _ := m.store.latestResult(ctx, item.AuthIndex)
		if !ok {
			id := item.ID
			result = Result{AuthIndex: item.AuthIndex, KeyID: &id, AuthFile: item.AuthFile}
		}
		m.expireMatchedKey(ctx, policy, item, result)
	}
}

func (m *Manager) expireMatchedKey(ctx context.Context, cfg Config, match keyMatch, result Result) (string, string, bool) {
	if match.Status == -3 {
		return "", "", false
	}
	if err := m.store.UpdateKeyStatus(ctx, match.ID, -3); err != nil {
		m.markError(err)
		return "", "", false
	}
	detail := fmt.Sprintf("%d -> -3 at %d", match.Status, match.ExpiresAtMS.Int64)
	keyID := match.ID
	_ = m.store.InsertActionLog(ctx, ActionLog{CreatedAtMS: nowMS(), AuthIndex: match.AuthIndex, KeyID: &keyID, Action: "status_expired", Detail: detail, Success: true})
	if cfg.AutoCPAAccountEnabled && match.ProviderID.Valid {
		if err := m.syncProviderConfig(ctx, match.ProviderID.Int64); err != nil {
			m.markError(err)
		}
	}
	if cfg.AutoCPAAccountEnabled && m.upstream != nil && strings.TrimSpace(result.AuthFile) != "" {
		baseURL, managementKey, ok := m.upstream.ResolveCPAUpstream(ctx)
		if ok && strings.TrimSpace(baseURL) != "" && strings.TrimSpace(managementKey) != "" {
			if err := m.setAuthFileDisabled(ctx, baseURL, managementKey, result.AuthFile, true); err == nil {
				_ = m.store.InsertActionLog(ctx, ActionLog{CreatedAtMS: nowMS(), AuthIndex: match.AuthIndex, KeyID: &keyID, Action: "cpa_offline_expired", Detail: result.AuthFile, Success: true})
			}
		}
	}
	return "status_expired", detail, true
}

func resultFromEvent(event usage.Event) Result {
	failed := event.Failed
	if !failed && event.StatusCode >= 400 {
		failed = true
	}
	account := firstNonEmpty(event.AccountSnapshot, event.AuthLabelSnapshot, event.Source)
	return Result{
		EventHash:    event.EventHash,
		RequestID:    event.RequestID,
		TimestampMS:  event.TimestampMS,
		AuthIndex:    strings.TrimSpace(event.AuthIndex),
		APIKeyHash:   event.APIKeyHash,
		Account:      account,
		AuthLabel:    event.AuthLabelSnapshot,
		AuthFile:     event.AuthFileSnapshot,
		AuthProvider: firstNonEmpty(event.AuthProviderSnapshot, event.Provider),
		Model:        firstNonEmpty(event.RequestedModel, event.Model, event.ResolvedModel),
		Endpoint:     event.Endpoint,
		StatusCode:   event.StatusCode,
		LatencyMS:    event.LatencyMS,
		Failed:       failed,
		Success:      !failed,
		ErrorMessage: event.ErrorMessage,
		CreatedAtMS:  nowMS(),
	}
}

func (m *Manager) applyPolicies(ctx context.Context, cfg Config, result Result) (action string, detail string, applied bool) {
	if strings.TrimSpace(result.AuthIndex) == "" {
		return "", "", false
	}

	var actions []string
	var details []string

	if cfg.AutoPriorityEnabled && result.KeyID != nil {
		if act, det, ok := m.applyPriority(ctx, cfg, result); ok {
			actions = append(actions, act)
			details = append(details, det)
		}
	}
	if cfg.AutoStatusEnabled && result.KeyID != nil {
		if act, det, ok := m.applyKeyStatus(ctx, cfg, result); ok {
			actions = append(actions, act)
			details = append(details, det)
		}
	}
	if cfg.AutoCPAAccountEnabled && strings.TrimSpace(result.AuthFile) != "" {
		if act, det, ok := m.applyCPAAccount(ctx, cfg, result); ok {
			actions = append(actions, act)
			details = append(details, det)
		}
	}
	if len(actions) == 0 {
		return "", "", false
	}
	if cfg.AutoCPAAccountEnabled && result.ProviderID != nil {
		if err := m.syncProviderConfig(ctx, *result.ProviderID); err != nil {
			_ = m.store.InsertActionLog(ctx, ActionLog{CreatedAtMS: nowMS(), AuthIndex: result.AuthIndex, KeyID: result.KeyID, Action: "cpa_provider_sync", Success: false, Error: err.Error()})
			m.markError(err)
		} else {
			actions = append(actions, "cpa_provider_sync")
			details = append(details, fmt.Sprintf("provider:%d", *result.ProviderID))
		}
	}
	return strings.Join(actions, ","), strings.Join(details, "; "), true
}

func (m *Manager) applyPriority(ctx context.Context, cfg Config, result Result) (string, string, bool) {
	match, ok, err := m.store.FindKeyByAuthIndex(ctx, result.AuthIndex)
	if err != nil || !ok {
		return "", "", false
	}
	next := match.Priority
	action := ""
	if result.Success {
		next = clampInt(match.Priority+cfg.PriorityBoost, cfg.MinPriority, cfg.MaxPriority)
		if next == match.Priority {
			return "", "", false
		}
		action = "priority_boost"
	} else {
		next = clampInt(match.Priority-cfg.PriorityPenalty, cfg.MinPriority, cfg.MaxPriority)
		if next == match.Priority {
			return "", "", false
		}
		action = "priority_penalty"
	}
	if err := m.store.UpdateKeyPriority(ctx, match.ID, next); err != nil {
		_ = m.store.InsertActionLog(ctx, ActionLog{
			CreatedAtMS: nowMS(),
			AuthIndex:   result.AuthIndex,
			KeyID:       result.KeyID,
			Action:      action,
			Detail:      fmt.Sprintf("%d -> %d", match.Priority, next),
			Success:     false,
			Error:       err.Error(),
		})
		m.markError(err)
		return "", "", false
	}
	detail := fmt.Sprintf("%d -> %d", match.Priority, next)
	_ = m.store.InsertActionLog(ctx, ActionLog{
		CreatedAtMS: nowMS(),
		AuthIndex:   result.AuthIndex,
		KeyID:       result.KeyID,
		Action:      action,
		Detail:      detail,
		Success:     true,
	})
	return action, detail, true
}

func (m *Manager) applyKeyStatus(ctx context.Context, cfg Config, result Result) (string, string, bool) {
	match, ok, err := m.store.FindKeyByAuthIndex(ctx, result.AuthIndex)
	if err != nil || !ok {
		return "", "", false
	}

	// Manual detailed invalid range (-2..-99) is left untouched. Generic -1
	// remains probe-manageable so an HTTP result can refine its reason.
	if match.Status <= -2 && match.Status >= -99 {
		return "", "", false
	}

	if result.Failed {
		fails, err := m.store.CountConsecutive(ctx, result.AuthIndex, false)
		if err != nil || fails < int64(cfg.FailureThreshold) {
			return "", "", false
		}
		nextStatus := statusFromFailure(result.StatusCode)
		if match.Status == nextStatus {
			return "", "", false
		}
		if err := m.store.UpdateKeyStatus(ctx, match.ID, nextStatus); err != nil {
			_ = m.store.InsertActionLog(ctx, ActionLog{
				CreatedAtMS: nowMS(),
				AuthIndex:   result.AuthIndex,
				KeyID:       result.KeyID,
				Action:      "status_invalid",
				Detail:      fmt.Sprintf("%d -> %d after %d fails", match.Status, nextStatus, fails),
				Success:     false,
				Error:       err.Error(),
			})
			m.markError(err)
			return "", "", false
		}
		detail := fmt.Sprintf("%d -> %d after %d fails", match.Status, nextStatus, fails)
		_ = m.store.InsertActionLog(ctx, ActionLog{
			CreatedAtMS: nowMS(),
			AuthIndex:   result.AuthIndex,
			KeyID:       result.KeyID,
			Action:      "status_invalid",
			Detail:      detail,
			Success:     true,
		})
		return "status_invalid", detail, true
	}

	oks, err := m.store.CountConsecutive(ctx, result.AuthIndex, true)
	if err != nil || oks < int64(cfg.RecoveryThreshold) {
		return "", "", false
	}
	nextStatus := statusFromSuccess(match.Status, result.StatusCode)
	if match.Status == nextStatus {
		return "", "", false
	}
	if err := m.store.UpdateKeyStatus(ctx, match.ID, nextStatus); err != nil {
		_ = m.store.InsertActionLog(ctx, ActionLog{
			CreatedAtMS: nowMS(),
			AuthIndex:   result.AuthIndex,
			KeyID:       result.KeyID,
			Action:      "status_recover",
			Detail:      fmt.Sprintf("%d -> %d after %d oks", match.Status, nextStatus, oks),
			Success:     false,
			Error:       err.Error(),
		})
		m.markError(err)
		return "", "", false
	}
	detail := fmt.Sprintf("%d -> %d after %d oks", match.Status, nextStatus, oks)
	_ = m.store.InsertActionLog(ctx, ActionLog{
		CreatedAtMS: nowMS(),
		AuthIndex:   result.AuthIndex,
		KeyID:       result.KeyID,
		Action:      "status_recover",
		Detail:      detail,
		Success:     true,
	})
	return "status_recover", detail, true
}

func (m *Manager) applyCPAAccount(ctx context.Context, cfg Config, result Result) (string, string, bool) {
	fileName := strings.TrimSpace(result.AuthFile)
	if fileName == "" || m.upstream == nil {
		return "", "", false
	}
	baseURL, managementKey, ok := m.upstream.ResolveCPAUpstream(ctx)
	if !ok || strings.TrimSpace(baseURL) == "" || strings.TrimSpace(managementKey) == "" {
		return "", "", false
	}
	lastAction, hasLastAction, err := m.store.LatestSuccessfulAction(ctx, result.AuthIndex)
	if err != nil {
		m.markError(err)
		return "", "", false
	}

	if result.Failed {
		fails, err := m.store.CountConsecutive(ctx, result.AuthIndex, false)
		if err != nil || fails < int64(cfg.FailureThreshold) {
			return "", "", false
		}
		if hasLastAction && lastAction == "cpa_offline" {
			return "", "", false
		}
		if err := m.setAuthFileDisabled(ctx, baseURL, managementKey, fileName, true); err != nil {
			_ = m.store.InsertActionLog(ctx, ActionLog{
				CreatedAtMS: nowMS(),
				AuthIndex:   result.AuthIndex,
				KeyID:       result.KeyID,
				Action:      "cpa_offline",
				Detail:      fileName,
				Success:     false,
				Error:       err.Error(),
			})
			m.markError(err)
			return "", "", false
		}
		_ = m.store.InsertActionLog(ctx, ActionLog{
			CreatedAtMS: nowMS(),
			AuthIndex:   result.AuthIndex,
			KeyID:       result.KeyID,
			Action:      "cpa_offline",
			Detail:      fileName,
			Success:     true,
		})
		return "cpa_offline", fileName, true
	}

	oks, err := m.store.CountConsecutive(ctx, result.AuthIndex, true)
	if err != nil || oks < int64(cfg.RecoveryThreshold) {
		return "", "", false
	}
	if !hasLastAction || lastAction != "cpa_offline" {
		return "", "", false
	}
	if err := m.setAuthFileDisabled(ctx, baseURL, managementKey, fileName, false); err != nil {
		_ = m.store.InsertActionLog(ctx, ActionLog{
			CreatedAtMS: nowMS(),
			AuthIndex:   result.AuthIndex,
			KeyID:       result.KeyID,
			Action:      "cpa_online",
			Detail:      fileName,
			Success:     false,
			Error:       err.Error(),
		})
		m.markError(err)
		return "", "", false
	}
	_ = m.store.InsertActionLog(ctx, ActionLog{
		CreatedAtMS: nowMS(),
		AuthIndex:   result.AuthIndex,
		KeyID:       result.KeyID,
		Action:      "cpa_online",
		Detail:      fileName,
		Success:     true,
	})
	return "cpa_online", fileName, true
}

func (m *Manager) setAuthFileDisabled(ctx context.Context, baseURL, managementKey, fileName string, disabled bool) error {
	payload, err := json.Marshal(map[string]any{
		"name":     fileName,
		"disabled": disabled,
	})
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/v0/management/auth-files/status"
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+managementKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	if len(body) == 0 {
		return fmt.Errorf("cpa auth-file status update failed: %s", res.Status)
	}
	return fmt.Errorf("cpa auth-file status update failed: %s (%s)", res.Status, strings.TrimSpace(string(body)))
}

func statusFromFailure(statusCode int64) int {
	if statusCode < 100 || statusCode > 999 || (statusCode >= 200 && statusCode < 300) {
		return 0
	}
	return -int(statusCode)
}

func statusFromSuccess(currentStatus int, statusCode int64) int {
	if currentStatus == -1 {
		return 0
	}
	if statusCode >= 200 && statusCode < 300 {
		return int(statusCode)
	}
	return 1
}

func (m *Manager) markError(err error) {
	if err == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status.LastError = err.Error()
	if m.cfg.Enabled {
		m.status.ServiceStatus = "error"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
