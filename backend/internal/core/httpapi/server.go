package httpapi

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	communityconfig "github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/charitable"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/cluster"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/collector"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/probe"
	coreproxy "github.com/router-for-me/CLIProxyAPI/v7/internal/core/proxy"
	proxyservice "github.com/router-for-me/CLIProxyAPI/v7/internal/core/proxy/service"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/usage"
)

//go:embed web/management.html
var embeddedPanel embed.FS

type Server struct {
	cfg               config.Config
	store             *store.Store
	collector         *collector.Manager
	startedAt         int64
	charitableMux     http.Handler
	probeManager      *probe.Manager
	localEngineStatus func() any
	pluginRegistered  func(string) bool
	pluginBusy        func(string) bool
	clusterHandler    *cluster.Handler
	proxyService      *proxyservice.Service
	proxyServiceMu    sync.Mutex
}

type setupSource string

const serviceID = "cpamc"

// cpamcBase is the root path for all secondary-development routes.
// Community /v0/management/* routes are proxied to CPA and never collide.
const cpamcBase = "/v0/cpamc"

const (
	setupSourceNone setupSource = ""
	setupSourceEnv  setupSource = "env"
	setupSourceDB   setupSource = "db"
)

const maxUsageImportBytes int64 = 64 * 1024 * 1024

const modelPriceSyncSource = "litellm"

var modelPriceSyncURL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"

type setupRequest struct {
	CPAUpstreamURL               string `json:"cpaBaseUrl"`
	ManagementKey                string `json:"managementKey"`
	CollectorMode                string `json:"collectorMode"`
	Queue                        string `json:"queue"`
	PopSide                      string `json:"popSide"`
	BatchSize                    int    `json:"batchSize"`
	PollIntervalMS               int    `json:"pollIntervalMs"`
	QueryLimit                   int    `json:"queryLimit"`
	TLSSkipVerify                bool   `json:"tlsSkipVerify"`
	EnsureUsageStatisticsEnabled *bool  `json:"ensureUsageStatisticsEnabled"`
	RequestMonitoringEnabled     *bool  `json:"requestMonitoringEnabled"`
}

type managerConfigResponse struct {
	Config   store.ManagerConfig `json:"config"`
	Source   string              `json:"source"`
	CPAUsage *cpaUsageConfig     `json:"cpaUsage,omitempty"`
}

type cpaUsageConfig struct {
	UsageStatisticsEnabled          bool `json:"usageStatisticsEnabled"`
	RedisUsageQueueRetentionSeconds int  `json:"redisUsageQueueRetentionSeconds"`
	RetentionSourceDefault          bool `json:"retentionSourceDefault"`
}

type modelPricesRequest struct {
	Prices map[string]store.ModelPrice `json:"prices"`
}

type modelPricesSyncRequest struct {
	Models []string `json:"models"`
}

type apiKeyAliasesRequest struct {
	Items              []store.APIKeyAlias `json:"items"`
	ActiveAPIKeyHashes []string            `json:"activeApiKeyHashes,omitempty"`
}

func New(cfg config.Config, store *store.Store, collector *collector.Manager) *Server {
	s := &Server{
		cfg:       cfg,
		store:     store,
		collector: collector,
		startedAt: time.Now().UnixMilli(),
	}
	if store != nil && store.DB() != nil {
		s.initProbe()
		s.initCharitable()
		if s.probeManager != nil {
			collector.SetUsageEventSink(s.probeManager)
		}
		if err := cluster.EnsureTables(store.DB()); err == nil {
			s.clusterHandler = cluster.NewHandler(cluster.NewStore(store.DB()))
		}
	}
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.withCORS(s.handleHealth))
	mux.HandleFunc("/status", s.withCORS(s.handleStatus))
	mux.HandleFunc("/usage-service/info", s.withCORS(s.handleInfo))
	mux.HandleFunc("/usage-service/config", s.withCORS(s.handleManagerConfig))
	mux.HandleFunc("/setup", s.withCORS(s.handleSetup))
	mux.HandleFunc("/management.html", s.handlePanel)
	mux.HandleFunc("/", s.handleRoot)
	return mux
}

// SetLocalEngineStatus exposes the embedded CLIProxyAPI lifecycle in service status responses.
func (s *Server) SetLocalEngineStatus(status func() any) {
	s.localEngineStatus = status
}

// SetLocalPluginRuntime connects read-only plugin runtime state to the core
// plugin-store API without coupling community handlers to core storage.
func (s *Server) SetLocalPluginRuntime(registered func(string) bool, busy func(string) bool) {
	s.pluginRegistered = registered
	s.pluginBusy = busy
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.writeCORS(w, r)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/model-prices") && !strings.HasPrefix(r.URL.Path, cpamcBase+"/model-price-proxy") {
		s.withCORS(s.handleModelPrices)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/model-price-proxy") {
		s.withCORS(s.handleModelPriceProxy)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/plugin-proxy") {
		s.withCORS(s.handlePluginProxy)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/plugin-store") {
		s.withCORS(s.handlePluginStore)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/cluster") {
		if !s.authorizeIfConfigured(w, r) {
			return
		}
		s.withCORS(s.clusterHandler.ServeHTTP)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/api-key-aliases") {
		s.withCORS(s.handleAPIKeyAliases)(w, r)
		return
	}
	cleanUsagePath := strings.TrimRight(r.URL.Path, "/")
	if cleanUsagePath == cpamcBase+"/usage" || strings.HasPrefix(cleanUsagePath, cpamcBase+"/usage/") {
		s.withCORS(s.handleUsage)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v0/management/") {
		s.withCORS(s.handleProxy)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/data-cleanup") {
		s.withCORS(s.handleDataCleanup)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/common-params") {
		s.withCORS(s.handleCommonParams)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/charitable/proxies/service") {
		s.withCORS(s.handleProxyService)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/charitable/") {
		s.withCORS(s.handleCharitable)(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, cpamcBase+"/meta-api") {
		s.withCORS(s.handleMetaAPI)(w, r)
		return
	}
	if isModelListProxyPath(r.URL.Path) {
		s.withCORS(s.handleModelListProxy)(w, r)
		return
	}
	if isInferenceProxyPath(r.URL.Path) {
		s.withCORS(s.handleInferenceProxy)(w, r)
		return
	}
	if r.URL.Path == "/" {
		http.Redirect(w, r, "/management.html", http.StatusTemporaryRedirect)
		return
	}
	http.NotFound(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": serviceID})
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	setup, ok, err := s.resolveSetup(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service":     serviceID,
		"mode":        "embedded",
		"startedAt":   s.startedAt,
		"configured":  ok && setup.CPAUpstreamURL != "" && setup.ManagementKey != "",
		"localEngine": s.currentLocalEngineStatus(),
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if !s.authorizeIfConfigured(w, r) {
		return
	}
	events, deadLetters, err := s.store.Counts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	status := s.collector.Status()
	status.DeadLetters = deadLetters
	writeJSON(w, http.StatusOK, map[string]any{
		"service":     serviceID,
		"dbPath":      s.cfg.DBPath,
		"events":      events,
		"deadLetters": deadLetters,
		"collector":   status,
		"localEngine": s.currentLocalEngineStatus(),
	})
}

func (s *Server) currentLocalEngineStatus() any {
	if s.localEngineStatus == nil {
		return map[string]any{"enabled": false, "running": false}
	}
	return s.localEngineStatus()
}

func (s *Server) handleManagerConfig(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		cfg, source, _, err := s.resolveManagerConfigWithSource(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		var cpaUsage *cpaUsageConfig
		if cfg.CPAConnection.CPABaseURL != "" && cfg.CPAConnection.ManagementKey != "" {
			if usageCfg, err := fetchCPAUsageConfig(
				r.Context(),
				cfg.CPAConnection.CPABaseURL,
				cfg.CPAConnection.ManagementKey,
			); err == nil {
				cpaUsage = &usageCfg
			}
		}
		cfg.Gateway.Mode = normalizeGatewayMode(cfg.Gateway.Mode)
		writeJSON(w, http.StatusOK, managerConfigResponse{
			Config:   cfg,
			Source:   string(source),
			CPAUsage: cpaUsage,
		})
	case http.MethodPut:
		var req struct {
			Config store.ManagerConfig `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		current, source, _, err := s.resolveManagerConfigWithSource(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		next := s.mergeSubmittedManagerConfig(current, req.Config)
		if source == setupSourceEnv && managerConfigConnectionDiffers(current, next) {
			writeError(w, http.StatusConflict, errors.New("connection setup is managed by environment variables"))
			return
		}
		if next.CPAConnection.CPABaseURL != "" || next.CPAConnection.ManagementKey != "" {
			if next.CPAConnection.CPABaseURL == "" || next.CPAConnection.ManagementKey == "" {
				writeError(w, http.StatusBadRequest, errors.New("cpaBaseUrl and managementKey are required"))
				return
			}
			if err := validateManagementAPI(
				r.Context(),
				next.CPAConnection.CPABaseURL,
				next.CPAConnection.ManagementKey,
			); err != nil {
				writeError(w, http.StatusBadGateway, err)
				return
			}
			if managerCollectorEnabled(next) {
				if err := validateCollectorAgainstCPA(r.Context(), next); err != nil {
					writeError(w, http.StatusBadRequest, err)
					return
				}
				if err := setCPAUsageStatisticsEnabled(
					r.Context(),
					next.CPAConnection.CPABaseURL,
					next.CPAConnection.ManagementKey,
					true,
				); err != nil {
					writeError(w, http.StatusBadGateway, err)
					return
				}
			}
		} else if managerCollectorEnabled(next) {
			writeError(w, http.StatusBadRequest, errors.New("cpaBaseUrl and managementKey are required when request monitoring is enabled"))
			return
		}
		if next.CPAConnection.CPABaseURL == "" || next.CPAConnection.ManagementKey == "" {
			if err := s.store.SaveManagerConfig(r.Context(), next); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			s.collector.Stop()
			writeJSON(w, http.StatusOK, managerConfigResponse{
				Config: next,
				Source: string(setupSourceDB),
			})
			return
		}
		if err := s.store.SaveManagerConfig(r.Context(), next); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		setup := setupFromManagerConfig(next)
		if err := s.store.SaveSetup(r.Context(), setup); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if managerCollectorEnabled(next) {
			s.collector.Start(context.Background(), runtimeConfigFromManagerConfig(next))
		} else {
			s.collector.Stop()
		}
		writeJSON(w, http.StatusOK, managerConfigResponse{
			Config: next,
			Source: string(setupSourceDB),
		})
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var req setupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	req.CPAUpstreamURL = normalizeBaseURL(req.CPAUpstreamURL)
	req.ManagementKey = strings.TrimSpace(req.ManagementKey)
	req.CollectorMode = collectorMode(req.CollectorMode)
	if req.Queue == "" {
		req.Queue = s.cfg.Queue
	}
	if req.PopSide == "" {
		req.PopSide = s.cfg.PopSide
	}
	req.PopSide = normalizePopSide(req.PopSide, s.cfg.PopSide)
	req.BatchSize = positiveOrDefault(req.BatchSize, s.cfg.BatchSize, 100)
	req.PollIntervalMS = positiveOrDefault(req.PollIntervalMS, int(s.cfg.PollInterval/time.Millisecond), 500)
	req.QueryLimit = positiveOrDefault(req.QueryLimit, s.cfg.QueryLimit, 50000)
	requestMonitoringEnabled := setupRequestMonitoringEnabled(req)
	if req.CPAUpstreamURL == "" || req.ManagementKey == "" {
		writeError(w, http.StatusBadRequest, errors.New("cpaBaseUrl and managementKey are required"))
		return
	}
	managementAPIValidated := false
	if existing, source, ok, err := s.resolveSetupWithSource(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	} else if source == setupSourceEnv && setupDiffers(existing, req) {
		writeError(w, http.StatusConflict, errors.New("setup is managed by environment variables"))
		return
	} else if ok && existing.ManagementKey != "" &&
		!authMatches(r, existing.ManagementKey) &&
		req.ManagementKey != existing.ManagementKey {
		if normalizeBaseURL(existing.CPAUpstreamURL) != req.CPAUpstreamURL {
			writeError(w, http.StatusUnauthorized, errors.New("invalid management key for existing setup"))
			return
		}
		if err := validateManagementAPI(r.Context(), req.CPAUpstreamURL, req.ManagementKey); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		managementAPIValidated = true
	}
	if !managementAPIValidated {
		if err := validateManagementAPI(r.Context(), req.CPAUpstreamURL, req.ManagementKey); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
	}
	managerCfg := s.defaultManagerConfig()
	if existingManagerCfg, _, ok, err := s.resolveManagerConfigWithSource(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	} else if ok {
		managerCfg = existingManagerCfg
	}
	managerCfg.CPAConnection.CPABaseURL = req.CPAUpstreamURL
	managerCfg.CPAConnection.ManagementKey = req.ManagementKey
	managerCfg.Collector.Enabled = boolPtr(requestMonitoringEnabled)
	managerCfg.Collector.CollectorMode = req.CollectorMode
	managerCfg.Collector.Queue = req.Queue
	managerCfg.Collector.PopSide = req.PopSide
	managerCfg.Collector.BatchSize = req.BatchSize
	managerCfg.Collector.PollIntervalMS = req.PollIntervalMS
	managerCfg.Collector.QueryLimit = req.QueryLimit
	managerCfg.Collector.TLSSkipVerify = req.TLSSkipVerify
	if requestMonitoringEnabled {
		if err := validateCollectorAgainstCPA(r.Context(), managerCfg); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	ensureUsageStatisticsEnabled := requestMonitoringEnabled
	if req.EnsureUsageStatisticsEnabled != nil {
		ensureUsageStatisticsEnabled = requestMonitoringEnabled && *req.EnsureUsageStatisticsEnabled
	}
	if ensureUsageStatisticsEnabled {
		if err := setCPAUsageStatisticsEnabled(r.Context(), req.CPAUpstreamURL, req.ManagementKey, true); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
	}
	setup := store.Setup{
		CPAUpstreamURL: req.CPAUpstreamURL,
		ManagementKey:  req.ManagementKey,
		Queue:          req.Queue,
		PopSide:        req.PopSide,
	}
	if err := s.store.SaveSetup(r.Context(), setup); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := s.store.SaveManagerConfig(r.Context(), managerCfg); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if requestMonitoringEnabled {
		s.collector.Start(context.Background(), runtimeConfigFromManagerConfig(managerCfg))
	} else {
		s.collector.Stop()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "upstream": setup.CPAUpstreamURL})
}

func (s *Server) handleModelPrices(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	switch {
	case path == cpamcBase+"/model-prices" && r.Method == http.MethodGet:
		prices, err := s.store.LoadModelPrices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"prices": prices})
	case path == cpamcBase+"/model-prices" && r.Method == http.MethodPut:
		var req modelPricesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if req.Prices == nil {
			writeError(w, http.StatusBadRequest, errors.New("prices are required"))
			return
		}
		if err := s.store.SaveModelPrices(r.Context(), req.Prices); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		prices, err := s.store.LoadModelPrices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"prices": prices})
	case path == cpamcBase+"/model-prices/sync" && r.Method == http.MethodPost:
		var req modelPricesSyncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		resolution := s.resolveModelPriceProxyResolution(r.Context())
		remotePrices, skipped, err := fetchLiteLLMModelPrices(r.Context(), resolution)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		selectedPrices, unmatched := selectModelPrices(remotePrices, req.Models)
		result, err := s.store.UpsertSyncedModelPrices(r.Context(), selectedPrices)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		prices, err := s.store.LoadModelPrices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"source":    modelPriceSyncSource,
			"imported":  result.Imported,
			"skipped":   result.Skipped + skipped,
			"unmatched": unmatched,
			"prices":    prices,
		})
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleAPIKeyAliases(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	const basePath = cpamcBase+"/api-key-aliases"
	switch {
	case path == basePath && r.Method == http.MethodGet:
		aliases, err := s.store.LoadAPIKeyAliases(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": aliases})
	case path == basePath && r.Method == http.MethodPut:
		var req apiKeyAliasesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if req.Items == nil {
			writeError(w, http.StatusBadRequest, errors.New("api key aliases are required"))
			return
		}
		if err := s.store.UpsertAPIKeyAliases(r.Context(), req.Items, req.ActiveAPIKeyHashes); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		aliases, err := s.store.LoadAPIKeyAliases(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": aliases})
	case strings.HasPrefix(path, basePath+"/") && r.Method == http.MethodDelete:
		apiKeyHash := strings.TrimPrefix(path, basePath+"/")
		if err := s.store.DeleteAPIKeyAlias(r.Context(), apiKeyHash); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		methodNotAllowed(w)
	}
}

// resolveCPAProxyURL 解析 CPA 全局代理 URL；任何步骤失败都返回空字符串，
// 让上游同步流程退化为直连。
func (s *Server) resolveCPAProxyURL(ctx context.Context) string {
	if s.cfg.LocalEngine.Enabled && strings.TrimSpace(s.cfg.LocalEngine.ConfigPath) != "" {
		if cfg, err := communityconfig.LoadConfig(s.cfg.LocalEngine.ConfigPath); err == nil {
			if proxyURL := strings.TrimSpace(cfg.ProxyURL); proxyURL != "" {
				return proxyURL
			}
		}
	}
	setup, ok, err := s.resolveSetup(ctx)
	if err != nil || !ok {
		return ""
	}
	if strings.TrimSpace(setup.CPAUpstreamURL) == "" {
		return ""
	}
	value, err := fetchCPAProxyURL(ctx, setup.CPAUpstreamURL, setup.ManagementKey)
	if err != nil {
		return ""
	}
	return value
}

func fetchLiteLLMModelPrices(ctx context.Context, resolution coreproxy.Resolution) (map[string]store.ModelPrice, int, error) {
	if resolution.ProxyURL != "" || resolution.AcceleratorBase != "" {
		prices, skipped, err := doFetchLiteLLMModelPrices(ctx, resolution)
		if err == nil {
			return prices, skipped, nil
		}
		// 代理/加速器失败时回退直连，避免临时不可用阻塞同步。
	}
	return doFetchLiteLLMModelPrices(ctx, coreproxy.Resolution{})
}

func doFetchLiteLLMModelPrices(ctx context.Context, resolution coreproxy.Resolution) (map[string]store.ModelPrice, int, error) {
	fetchURL := coreproxy.RewriteAcceleratorURL(resolution.AcceleratorBase, modelPriceSyncURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fetchURL, nil)
	if err != nil {
		return nil, 0, err
	}
	client := coreproxy.BuildHTTPClient(resolution, 30*time.Second)
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, 0, errors.New("model price sync failed: " + res.Status)
	}

	var payload map[string]json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return nil, 0, err
	}

	prices := map[string]store.ModelPrice{}
	skipped := 0
	for model, raw := range payload {
		if model == "" || model == "sample_spec" {
			skipped++
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal(raw, &entry); err != nil {
			skipped++
			continue
		}

		prompt, hasPrompt := readFloat(entry, "input_cost_per_token")
		completion, hasCompletion := readFloat(entry, "output_cost_per_token")
		cache, hasCache := readFloat(entry, "cache_read_input_token_cost")
		if !hasCache {
			cache, hasCache = readFloat(entry, "cache_read_cost_per_token")
		}
		if !hasPrompt && !hasCompletion {
			skipped++
			continue
		}
		if !hasPrompt {
			prompt = 0
		}
		if !hasCompletion {
			completion = 0
		}
		if !hasCache {
			cache = prompt
		}

		prices[model] = store.ModelPrice{
			Prompt:        prompt * 1_000_000,
			Completion:    completion * 1_000_000,
			Cache:         cache * 1_000_000,
			Source:        modelPriceSyncSource,
			SourceModelID: model,
			RawJSON:       string(raw),
		}
	}
	return prices, skipped, nil
}

type proxyCacheEntry struct {
	value     string
	expiresAt time.Time
}

const cpaProxyCacheTTL = 5 * time.Minute

var (
	cpaProxyCacheMu sync.RWMutex
	cpaProxyCache   = map[string]proxyCacheEntry{}
)

// fetchCPAProxyURL 从 CPA 上游读取全局代理 URL（GET /v0/management/proxy-url），
// 结果在 cpaProxyCacheTTL 内复用以避免频繁打到 CPA。空字符串表示未配置代理。
func fetchCPAProxyURL(ctx context.Context, baseURL string, managementKey string) (string, error) {
	base := normalizeBaseURL(baseURL)
	if base == "" {
		return "", nil
	}
	if value, ok := lookupCPAProxyCache(base); ok {
		return value, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v0/management/proxy-url", nil)
	if err != nil {
		return "", err
	}
	if managementKey != "" {
		req.Header.Set("Authorization", "Bearer "+managementKey)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		storeCPAProxyCache(base, "")
		return "", nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", errors.New("fetch CPA proxy-url failed: " + res.Status)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	value := extractProxyURLFromBody(body)
	storeCPAProxyCache(base, value)
	return value, nil
}

func extractProxyURLFromBody(body []byte) string {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return ""
	}
	if body[0] == '"' {
		var s string
		if err := json.Unmarshal(body, &s); err == nil {
			return strings.TrimSpace(s)
		}
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err == nil {
		for _, key := range []string{"proxy-url", "proxyUrl", "proxy_url", "value"} {
			raw, ok := obj[key]
			if !ok {
				continue
			}
			if str, ok := raw.(string); ok {
				return strings.TrimSpace(str)
			}
		}
	}
	return ""
}

func lookupCPAProxyCache(base string) (string, bool) {
	cpaProxyCacheMu.RLock()
	entry, ok := cpaProxyCache[base]
	cpaProxyCacheMu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return "", false
	}
	return entry.value, true
}

func storeCPAProxyCache(base string, value string) {
	cpaProxyCacheMu.Lock()
	cpaProxyCache[base] = proxyCacheEntry{value: value, expiresAt: time.Now().Add(cpaProxyCacheTTL)}
	cpaProxyCacheMu.Unlock()
}

// selectModelPrices 按用户请求的模型名挑选价格条目。
//
// 匹配优先级（高到低）：精确 → 大小写无关 → basename → 剥离日期后缀。
// 命中后返回 selected map，未命中模型放入 unmatched 列表反馈给前端。
// models 为空时返回全部价格（用于"同步全部"场景）。
func selectModelPrices(prices map[string]store.ModelPrice, models []string) (map[string]store.ModelPrice, []string) {
	wanted := make([]string, 0, len(models))
	seen := map[string]struct{}{}
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		wanted = append(wanted, model)
	}
	if len(wanted) == 0 {
		copied := make(map[string]store.ModelPrice, len(prices))
		maps.Copy(copied, prices)
		return copied, nil
	}

	index := buildModelPriceIndex(prices)
	selected := map[string]store.ModelPrice{}
	unmatched := []string{}
	for _, model := range wanted {
		if price, ok := lookupModelPriceByIndex(index, prices, model); ok {
			selected[model] = price
			continue
		}
		unmatched = append(unmatched, model)
	}
	return selected, unmatched
}

// modelDateSuffixRegex 匹配形如 "-20240101" / "-202401" 的日期版本后缀。
var modelDateSuffixRegex = regexp.MustCompile(`-\d{6,8}$`)

type modelPriceIndex struct {
	exact        map[string]string // lowercase(full key) -> 原始 key
	base         map[string]string // lowercase(basename(key)) -> 最短原始 key
	dateStripped map[string]string // lowercase(stripDate(basename(key))) -> 最短原始 key
}

func buildModelPriceIndex(prices map[string]store.ModelPrice) *modelPriceIndex {
	idx := &modelPriceIndex{
		exact:        make(map[string]string, len(prices)),
		base:         make(map[string]string),
		dateStripped: make(map[string]string),
	}
	for key := range prices {
		lower := strings.ToLower(key)
		if existing, ok := idx.exact[lower]; !ok || len(key) < len(existing) {
			idx.exact[lower] = key
		}
		baseName := lastPathSegment(lower)
		if existing, ok := idx.base[baseName]; !ok || len(key) < len(existing) {
			idx.base[baseName] = key
		}
		stripped := stripModelDateSuffix(baseName)
		if stripped != baseName {
			if existing, ok := idx.dateStripped[stripped]; !ok || len(key) < len(existing) {
				idx.dateStripped[stripped] = key
			}
		}
	}
	return idx
}

func lookupModelPriceByIndex(idx *modelPriceIndex, prices map[string]store.ModelPrice, model string) (store.ModelPrice, bool) {
	if price, ok := prices[model]; ok {
		return price, true
	}
	lower := strings.ToLower(strings.TrimSpace(model))
	if lower == "" {
		return store.ModelPrice{}, false
	}
	if key, ok := idx.exact[lower]; ok {
		if price, ok := prices[key]; ok {
			return price, true
		}
	}
	baseName := lastPathSegment(lower)
	if key, ok := idx.base[baseName]; ok {
		if price, ok := prices[key]; ok {
			return price, true
		}
	}
	stripped := stripModelDateSuffix(baseName)
	if stripped != baseName {
		if key, ok := idx.base[stripped]; ok {
			if price, ok := prices[key]; ok {
				return price, true
			}
		}
		if key, ok := idx.dateStripped[stripped]; ok {
			if price, ok := prices[key]; ok {
				return price, true
			}
		}
	}
	if key, ok := idx.dateStripped[baseName]; ok {
		if price, ok := prices[key]; ok {
			return price, true
		}
	}
	return store.ModelPrice{}, false
}

func lastPathSegment(value string) string {
	idx := strings.LastIndex(value, "/")
	if idx < 0 {
		return value
	}
	return value[idx+1:]
}

func stripModelDateSuffix(value string) string {
	return modelDateSuffixRegex.ReplaceAllString(value, "")
}

func readFloat(entry map[string]any, key string) (float64, bool) {
	value, ok := entry[key]
	if !ok || value == nil {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		if strings.HasSuffix(r.URL.Path, "/realtime/stream") {
			s.handleUsageRealtimeStream(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/export") {
			s.handleUsageExport(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/summary") {
			s.handleUsageSummary(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/accounts") {
			s.handleUsageBreakdownPage(w, r, store.UsageBreakdownAccounts)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/api-keys") {
			s.handleUsageBreakdownPage(w, r, store.UsageBreakdownAPIKeys)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/realtime") {
			s.handleUsageBreakdownPage(w, r, store.UsageBreakdownRealtime)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/models") {
			s.handleUsageBreakdownPage(w, r, store.UsageBreakdownModels)
			return
		}
		events, err := s.store.RecentEvents(r.Context(), s.cfg.QueryLimit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, usage.BuildPayload(events))
	case http.MethodPost:
		if strings.HasSuffix(r.URL.Path, "/import") {
			s.handleUsageImport(w, r)
			return
		}
		methodNotAllowed(w)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleUsageRealtimeStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is not supported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	cursor, err := s.store.LatestUsageEventCursor(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeUsageSSE(w, flusher, "ready", cursor)

	checkTicker := time.NewTicker(time.Second)
	heartbeatTicker := time.NewTicker(15 * time.Second)
	defer checkTicker.Stop()
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-checkTicker.C:
			nextCursor, err := s.store.LatestUsageEventCursor(r.Context())
			if err != nil {
				return
			}
			if nextCursor <= cursor {
				continue
			}
			cursor = nextCursor
			writeUsageSSE(w, flusher, "usage", cursor)
		case <-heartbeatTicker.C:
			_, _ = fmt.Fprintf(w, ": heartbeat %d\n\n", time.Now().UnixMilli())
			flusher.Flush()
		}
	}
}

func writeUsageSSE(w http.ResponseWriter, flusher http.Flusher, event string, cursor int64) {
	payload, _ := json.Marshal(map[string]int64{
		"cursor": cursor,
		"at_ms":  time.Now().UnixMilli(),
	})
	_, _ = fmt.Fprintf(w, "event: %s\nid: %d\ndata: %s\n\n", event, cursor, payload)
	flusher.Flush()
}

func (s *Server) handleUsageSummary(w http.ResponseWriter, r *http.Request) {
	filter, err := parseUsageSummaryFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	summary, err := s.store.UsageSummary(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleUsageBreakdownPage(w http.ResponseWriter, r *http.Request, kind store.UsageBreakdownKind) {
	filter, err := parseUsageSummaryFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	pageFilter, err := parseUsagePageFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	page, err := s.store.UsageBreakdownPage(r.Context(), kind, filter, pageFilter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func parseUsageSummaryFilter(r *http.Request) (store.UsageSummaryFilter, error) {
	query := r.URL.Query()
	var filter store.UsageSummaryFilter
	if raw := strings.TrimSpace(query.Get("start_ms")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return filter, fmt.Errorf("invalid start_ms")
		}
		filter.StartMS = &value
	}
	if raw := strings.TrimSpace(query.Get("end_ms")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return filter, fmt.Errorf("invalid end_ms")
		}
		filter.EndMS = &value
	}
	if filter.StartMS != nil && filter.EndMS != nil && *filter.StartMS > *filter.EndMS {
		return filter, fmt.Errorf("start_ms must be less than or equal to end_ms")
	}
	filter.Account = strings.TrimSpace(query.Get("account"))
	filter.Provider = strings.TrimSpace(query.Get("provider"))
	filter.Model = strings.TrimSpace(query.Get("model"))
	filter.Channel = strings.TrimSpace(query.Get("channel"))
	filter.APIKeyHash = strings.TrimSpace(query.Get("api_key_hash"))
	filter.Search = strings.TrimSpace(query.Get("search"))
	filter.SearchAPIKeyHash = strings.TrimSpace(query.Get("search_api_key_hash"))
	filter.Status = strings.TrimSpace(query.Get("status"))
	if filter.Status != "" && filter.Status != "success" && filter.Status != "failed" {
		return filter, fmt.Errorf("invalid status")
	}
	return filter, nil
}

func parseUsagePageFilter(r *http.Request) (store.UsagePageFilter, error) {
	query := r.URL.Query()
	var filter store.UsagePageFilter
	if raw := strings.TrimSpace(query.Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return filter, fmt.Errorf("invalid page")
		}
		filter.Page = value
	}
	if raw := strings.TrimSpace(query.Get("page_size")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return filter, fmt.Errorf("invalid page_size")
		}
		if value > store.MaxUsagePageSize {
			return filter, fmt.Errorf("page_size must be less than or equal to %d", store.MaxUsagePageSize)
		}
		filter.PageSize = value
	}
	filter.SortKey = strings.TrimSpace(query.Get("sort_key"))
	if filter.SortKey != "" && !store.IsUsageSortKey(filter.SortKey) {
		return filter, fmt.Errorf("invalid sort_key")
	}
	filter.SortDirection = strings.TrimSpace(query.Get("sort_direction"))
	if filter.SortDirection != "" && filter.SortDirection != "asc" && filter.SortDirection != "desc" {
		return filter, fmt.Errorf("invalid sort_direction")
	}
	return filter, nil
}

func (s *Server) handleUsageExport(w http.ResponseWriter, r *http.Request) {
	data, err := s.store.ExportJSONL(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", `attachment; filename="usage-events.jsonl"`)
	_, _ = w.Write(data)
}

func (s *Server) handleUsageImport(w http.ResponseWriter, r *http.Request) {
	body := http.MaxBytesReader(w, r.Body, maxUsageImportBytes)
	data, err := io.ReadAll(body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, http.StatusRequestEntityTooLarge, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}

	parsed, err := usage.ParseImportPayload(data)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":       err.Error(),
			"format":      parsed.Format,
			"failed":      parsed.Failed,
			"unsupported": parsed.Unsupported,
			"warnings":    parsed.Warnings,
		})
		return
	}

	result, err := s.store.InsertEvents(r.Context(), parsed.Events)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"format":      parsed.Format,
		"added":       result.Inserted,
		"skipped":     result.Skipped,
		"total":       len(parsed.Events),
		"failed":      parsed.Failed,
		"unsupported": parsed.Unsupported,
		"warnings":    parsed.Warnings,
	})
}

func isModelListProxyPath(path string) bool {
	cleaned := strings.TrimRight(path, "/")
	return cleaned == "/v1/models" || cleaned == "/models"
}

func (s *Server) initProbe() {
	if s.store == nil || s.store.DB() == nil {
		return
	}
	probeStore := probe.NewStore(s.store.DB())
	if err := probeStore.EnsureSchema(context.Background()); err != nil {
		// Schema failures are logged but must not block the panel.
		return
	}
	manager := probe.NewManager(probeStore, &cpaUpstreamResolver{server: s})
	_ = manager.EnsureReady(context.Background())
	s.probeManager = manager
}

func (s *Server) initCharitable() {
	if s.store == nil || s.store.DB() == nil {
		return
	}
	cs := charitable.NewCharitableStore(s.store.DB())
	console := charitable.NewSQLConsole(s.store.DB(), s.cfg.DBPath, s.cfg.DebugDatabases)
	h := charitable.NewHandlerWithConsole(cs, console)
	// Inject proxy service status so the proxy list can include a virtual
	// system node when the local proxy service is running.
	h.SetProxyServiceStatus(func() charitable.ProxyServiceSnapshot {
		svc := s.ensureProxyService()
		cfg := svc.Config()
		st := svc.Status()
		return charitable.ProxyServiceSnapshot{
			Running:      st.Running,
			ListenAddr:   cfg.ListenAddr,
			TCPPort:      cfg.TCPPort,
			UDPPort:      cfg.UDPPort,
			Encryption:   cfg.EncryptionMethod,
			Password:     cfg.Password,
			AutoRegister: cfg.AutoRegister,
		}
	})
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	if s.probeManager != nil {
		probeHandler := probe.NewHandler(s.probeManager, probe.NewStore(s.store.DB()))
		probeHandler.RegisterRoutes(mux)
	}
	s.charitableMux = mux
}

// cpaUpstreamResolver exposes the current CPA upstream connection to the probe manager.
type cpaUpstreamResolver struct {
	server *Server
}

func (r *cpaUpstreamResolver) ResolveCPAUpstream(ctx context.Context) (string, string, bool) {
	setup, ok, err := r.server.resolveSetup(ctx)
	if err != nil || !ok {
		return "", "", false
	}
	return setup.CPAUpstreamURL, setup.ManagementKey, true
}

func (s *Server) handleDataCleanup(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}
	cleanPath := strings.TrimRight(r.URL.Path, "/")
	switch {
	case cleanPath == cpamcBase+"/data-cleanup/tables" && r.Method == http.MethodGet:
		tables, err := s.store.ListCleanupTables(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		settings, err := s.store.LoadCleanupSettings(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tables": tables, "settings": settings})
	case cleanPath == cpamcBase+"/data-cleanup/settings" && r.Method == http.MethodGet:
		settings, err := s.store.LoadCleanupSettings(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case cleanPath == cpamcBase+"/data-cleanup/settings" && r.Method == http.MethodPut:
		var req store.CleanupSettings
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		saved, err := s.store.SaveCleanupSettings(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, saved)
	case cleanPath == cpamcBase+"/data-cleanup/purge" && r.Method == http.MethodPost:
		var req store.CleanupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		result, err := s.store.CleanupTable(r.Context(), req)
		if err != nil {
			msg := err.Error()
			if strings.Contains(msg, "unsupported cleanup") || strings.Contains(msg, "days must be greater than 0") {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		// Remember last selected scope for this table.
		pref := store.CleanupTablePreference{Mode: strings.TrimSpace(strings.ToLower(req.Mode))}
		if pref.Mode == "custom_days" {
			pref.Mode = "custom"
		}
		if pref.Mode == "days" || pref.Mode == "custom" {
			pref.Days = req.Days
		}
		if _, err := s.store.UpsertCleanupTablePreference(r.Context(), req.Table, pref); err != nil {
			// Cleanup already succeeded; surface preference persistence issues as 500 with result context.
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleCharitable(w http.ResponseWriter, r *http.Request) {
	if !isPublicClashSubscriptionRequest(r) && !s.authorizeIfConfigured(w, r) {
		return
	}
	if s.charitableMux == nil {
		writeError(w, http.StatusInternalServerError, errors.New("charitable handler not initialized"))
		return
	}
	s.charitableMux.ServeHTTP(w, r)
}

var publicClashSubscriptionPath = regexp.MustCompile(`^` + cpamcBase + `/charitable/subscriptions/[0-9a-f]{48}/clash/?$`)

func isPublicClashSubscriptionRequest(r *http.Request) bool {
	return r.Method == http.MethodGet && publicClashSubscriptionPath.MatchString(r.URL.Path)
}

func (s *Server) handleModelListProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	setup, ok, err := s.resolveSetup(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !ok {
		writeError(w, http.StatusPreconditionRequired, errors.New("usage service is not configured"))
		return
	}
	target, err := url.Parse(setup.CPAUpstreamURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	proxy.ServeHTTP(w, r)
}

func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	setup, ok, err := s.resolveSetup(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !ok {
		writeError(w, http.StatusPreconditionRequired, errors.New("usage service is not configured"))
		return
	}
	if !authMatches(r, setup.ManagementKey) {
		writeError(w, http.StatusUnauthorized, errors.New("invalid management key"))
		return
	}
	target, err := url.Parse(setup.CPAUpstreamURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
		req.Header.Set("Authorization", "Bearer "+setup.ManagementKey)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	proxy.ServeHTTP(w, r)
}

func isInferenceProxyPath(path string) bool {
	cleaned := strings.TrimRight(path, "/")
	if cleaned == "" {
		cleaned = "/"
	}
	// Only model protocol paths are gateway-routed. Management stays on explicit handlers.
	return cleaned == "/v1" || strings.HasPrefix(cleaned, "/v1/")
}

func (s *Server) handleInferenceProxy(w http.ResponseWriter, r *http.Request) {
	targetURL, mode, err := s.resolveInferenceProxyTarget(r.Context())
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if targetURL == "" {
		writeError(w, http.StatusNotFound, fmt.Errorf(
			"inference proxy disabled in dual-port mode; call the local engine or external CPA directly (gateway.mode=%s)",
			mode,
		))
		return
	}
	target, err := url.Parse(targetURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
		// Preserve client Authorization for model API keys; do not overwrite with management key.
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	// Support streamed responses (SSE / chunked).
	proxy.FlushInterval = -1
	proxy.ServeHTTP(w, r)
}

func (s *Server) resolveInferenceProxyTarget(ctx context.Context) (string, string, error) {
	cfg, _, _, err := s.resolveManagerConfigWithSource(ctx)
	if err != nil {
		return "", "", err
	}
	mode := normalizeGatewayMode(cfg.Gateway.Mode)
	switch mode {
	case store.GatewayModeDualPort:
		return "", mode, nil
	case store.GatewayModeLocalEngine:
		base := s.localEngineBaseURL()
		if base == "" {
			return "", mode, errors.New("local engine is disabled or unavailable")
		}
		return base, mode, nil
	case store.GatewayModeExternalCPA:
		base := normalizeBaseURL(cfg.CPAConnection.CPABaseURL)
		if base == "" {
			base = normalizeBaseURL(s.cfg.CPAUpstreamURL)
		}
		if base == "" {
			return "", mode, errors.New("cpaBaseUrl is required for external-cpa gateway mode")
		}
		return base, mode, nil
	default:
		return "", mode, fmt.Errorf("unsupported gateway mode %q", mode)
	}
}

func (s *Server) localEngineBaseURL() string {
	if !s.cfg.LocalEngine.Enabled {
		return ""
	}
	host := strings.TrimSpace(s.cfg.LocalEngine.Host)
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	port := s.cfg.LocalEngine.Port
	if port <= 0 {
		port = 18318
	}
	return fmt.Sprintf("http://%s", net.JoinHostPort(host, strconv.Itoa(port)))
}

func normalizeGatewayMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case store.GatewayModeLocalEngine, "local", "builtin", "internal":
		return store.GatewayModeLocalEngine
	case store.GatewayModeExternalCPA, "external", "upstream", "cpa":
		return store.GatewayModeExternalCPA
	case store.GatewayModeDualPort, "dual", "split", "":
		return store.GatewayModeDualPort
	default:
		return store.GatewayModeDualPort
	}
}

func (s *Server) handlePanel(w http.ResponseWriter, r *http.Request) {
	data, err := s.loadPanelHTML()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

// loadPanelHTML resolves the management panel from PANEL_PATH, common local build
// outputs, then the embedded asset (which may be a stub until release/docker build).
func (s *Server) loadPanelHTML() ([]byte, error) {
	candidates := make([]string, 0, 6)
	if strings.TrimSpace(s.cfg.PanelPath) != "" {
		candidates = append(candidates, s.cfg.PanelPath)
	}
	candidates = append(candidates,
		"dist/index.html",
		"dist/management.html",
		filepath.Join("..", "dist", "index.html"),
		filepath.Join("..", "dist", "management.html"),
	)

	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if isUsablePanelHTML(data) {
			return data, nil
		}
	}

	data, err := embeddedPanel.ReadFile("web/management.html")
	if err != nil {
		return nil, err
	}
	return data, nil
}

func isUsablePanelHTML(data []byte) bool {
	if len(bytes.TrimSpace(data)) == 0 {
		return false
	}
	// Prefer a real SPA build over the source-tree placeholder page.
	if bytes.Contains(data, []byte("管理面板尚未内置到当前二进制")) {
		return false
	}
	return true
}

func (s *Server) resolveSetup(ctx context.Context) (store.Setup, bool, error) {
	setup, _, ok, err := s.resolveSetupWithSource(ctx)
	return setup, ok, err
}

func (s *Server) resolveSetupWithSource(ctx context.Context) (store.Setup, setupSource, bool, error) {
	if s.cfg.CPAUpstreamURL != "" && s.cfg.ManagementKey != "" {
		return store.Setup{
			CPAUpstreamURL: normalizeBaseURL(s.cfg.CPAUpstreamURL),
			ManagementKey:  s.cfg.ManagementKey,
			Queue:          s.cfg.Queue,
			PopSide:        s.cfg.PopSide,
		}, setupSourceEnv, true, nil
	}
	if managerCfg, _, ok, err := s.resolveManagerConfigWithSource(ctx); err != nil {
		return store.Setup{}, setupSourceNone, false, err
	} else if ok && managerCfg.CPAConnection.CPABaseURL != "" && managerCfg.CPAConnection.ManagementKey != "" {
		return setupFromManagerConfig(managerCfg), setupSourceDB, true, nil
	}
	setup, ok, err := s.store.LoadSetup(ctx)
	if !ok || err != nil {
		return setup, setupSourceNone, ok, err
	}
	return setup, setupSourceDB, true, nil
}

func (s *Server) resolveManagerConfigWithSource(ctx context.Context) (store.ManagerConfig, setupSource, bool, error) {
	cfg := s.defaultManagerConfig()
	source := setupSourceNone
	found := false

	if s.store != nil {
		if saved, ok, err := s.store.LoadManagerConfig(ctx); err != nil {
			return cfg, source, false, err
		} else if ok {
			cfg = s.mergeSubmittedManagerConfig(cfg, saved)
			source = setupSourceDB
			found = true
		}

		if setup, ok, err := s.store.LoadSetup(ctx); err != nil {
			return cfg, source, false, err
		} else if ok && cfg.CPAConnection.CPABaseURL == "" && cfg.CPAConnection.ManagementKey == "" {
			cfg.CPAConnection.CPABaseURL = normalizeBaseURL(setup.CPAUpstreamURL)
			cfg.CPAConnection.ManagementKey = setup.ManagementKey
			cfg.Collector.Queue = valueOr(setup.Queue, cfg.Collector.Queue)
			cfg.Collector.PopSide = normalizePopSide(setup.PopSide, cfg.Collector.PopSide)
			source = setupSourceDB
			found = true
		}
	}

	if s.cfg.CPAUpstreamURL != "" && s.cfg.ManagementKey != "" {
		cfg.CPAConnection.CPABaseURL = normalizeBaseURL(s.cfg.CPAUpstreamURL)
		cfg.CPAConnection.ManagementKey = s.cfg.ManagementKey
		cfg.Collector.CollectorMode = collectorMode(s.cfg.CollectorMode)
		cfg.Collector.Queue = valueOr(s.cfg.Queue, cfg.Collector.Queue)
		cfg.Collector.PopSide = normalizePopSide(s.cfg.PopSide, cfg.Collector.PopSide)
		cfg.Collector.BatchSize = positiveOrDefault(s.cfg.BatchSize, cfg.Collector.BatchSize, 100)
		cfg.Collector.PollIntervalMS = positiveOrDefault(int(s.cfg.PollInterval/time.Millisecond), cfg.Collector.PollIntervalMS, 500)
		cfg.Collector.QueryLimit = positiveOrDefault(s.cfg.QueryLimit, cfg.Collector.QueryLimit, 50000)
		cfg.Collector.TLSSkipVerify = s.cfg.TLSSkipVerify
		source = setupSourceEnv
		found = true
	}

	cfg.Gateway.Mode = normalizeGatewayMode(cfg.Gateway.Mode)
	return cfg, source, found, nil
}

func setupDiffers(existing store.Setup, req setupRequest) bool {
	return normalizeBaseURL(existing.CPAUpstreamURL) != req.CPAUpstreamURL ||
		existing.ManagementKey != req.ManagementKey ||
		existing.Queue != req.Queue ||
		existing.PopSide != req.PopSide
}

func setupFromManagerConfig(cfg store.ManagerConfig) store.Setup {
	return store.Setup{
		CPAUpstreamURL: cfg.CPAConnection.CPABaseURL,
		ManagementKey:  cfg.CPAConnection.ManagementKey,
		Queue:          cfg.Collector.Queue,
		PopSide:        cfg.Collector.PopSide,
	}
}

func runtimeConfigFromManagerConfig(cfg store.ManagerConfig) collector.RuntimeConfig {
	return collector.RuntimeConfig{
		CPAUpstreamURL: cfg.CPAConnection.CPABaseURL,
		ManagementKey:  cfg.CPAConnection.ManagementKey,
		CollectorMode:  cfg.Collector.CollectorMode,
		Queue:          cfg.Collector.Queue,
		PopSide:        cfg.Collector.PopSide,
		BatchSize:      cfg.Collector.BatchSize,
		PollInterval:   time.Duration(cfg.Collector.PollIntervalMS) * time.Millisecond,
		TLSSkipVerify:  cfg.Collector.TLSSkipVerify,
	}
}

func (s *Server) defaultManagerConfig() store.ManagerConfig {
	pollIntervalMS := int(s.cfg.PollInterval / time.Millisecond)
	return store.ManagerConfig{
		Collector: store.ManagerCollectorConfig{
			Enabled:        boolPtr(true),
			CollectorMode:  collectorMode(s.cfg.CollectorMode),
			Queue:          valueOr(s.cfg.Queue, "usage"),
			PopSide:        normalizePopSide(s.cfg.PopSide, "right"),
			BatchSize:      positiveOrDefault(s.cfg.BatchSize, 100, 100),
			PollIntervalMS: positiveOrDefault(pollIntervalMS, 500, 500),
			QueryLimit:     positiveOrDefault(s.cfg.QueryLimit, 50000, 50000),
			TLSSkipVerify:  s.cfg.TLSSkipVerify,
		},
		Gateway: store.ManagerGatewayConfig{
			Mode: store.GatewayModeDualPort,
		},
	}
}

func (s *Server) mergeSubmittedManagerConfig(base store.ManagerConfig, submitted store.ManagerConfig) store.ManagerConfig {
	next := base

	if submitted.CPAConnection.CPABaseURL != "" || submitted.CPAConnection.ManagementKey != "" {
		next.CPAConnection.CPABaseURL = normalizeBaseURL(submitted.CPAConnection.CPABaseURL)
		next.CPAConnection.ManagementKey = strings.TrimSpace(submitted.CPAConnection.ManagementKey)
	}

	if submitted.Collector.Enabled != nil {
		next.Collector.Enabled = boolPtr(*submitted.Collector.Enabled)
	}
	next.Collector.CollectorMode = collectorMode(valueOr(submitted.Collector.CollectorMode, next.Collector.CollectorMode))
	next.Collector.Queue = valueOr(strings.TrimSpace(submitted.Collector.Queue), next.Collector.Queue)
	next.Collector.PopSide = normalizePopSide(submitted.Collector.PopSide, next.Collector.PopSide)
	next.Collector.BatchSize = positiveOrDefault(submitted.Collector.BatchSize, next.Collector.BatchSize, 100)
	next.Collector.PollIntervalMS = positiveOrDefault(submitted.Collector.PollIntervalMS, next.Collector.PollIntervalMS, 500)
	next.Collector.QueryLimit = positiveOrDefault(submitted.Collector.QueryLimit, next.Collector.QueryLimit, 50000)
	next.Collector.TLSSkipVerify = submitted.Collector.TLSSkipVerify

	next.ExternalUsageService.Enabled = submitted.ExternalUsageService.Enabled
	next.ExternalUsageService.ServiceBase = normalizeBaseURL(submitted.ExternalUsageService.ServiceBase)
	if !next.ExternalUsageService.Enabled {
		next.ExternalUsageService.ServiceBase = ""
	}

	if strings.TrimSpace(submitted.Gateway.Mode) != "" {
		next.Gateway.Mode = normalizeGatewayMode(submitted.Gateway.Mode)
	} else if strings.TrimSpace(next.Gateway.Mode) == "" {
		next.Gateway.Mode = store.GatewayModeDualPort
	} else {
		next.Gateway.Mode = normalizeGatewayMode(next.Gateway.Mode)
	}

	return next
}

func managerConfigConnectionDiffers(left store.ManagerConfig, right store.ManagerConfig) bool {
	return normalizeBaseURL(left.CPAConnection.CPABaseURL) != normalizeBaseURL(right.CPAConnection.CPABaseURL) ||
		left.CPAConnection.ManagementKey != right.CPAConnection.ManagementKey ||
		managerCollectorEnabled(left) != managerCollectorEnabled(right) ||
		left.Collector.CollectorMode != right.Collector.CollectorMode ||
		left.Collector.Queue != right.Collector.Queue ||
		left.Collector.PopSide != right.Collector.PopSide ||
		left.Collector.BatchSize != right.Collector.BatchSize ||
		left.Collector.PollIntervalMS != right.Collector.PollIntervalMS ||
		left.Collector.TLSSkipVerify != right.Collector.TLSSkipVerify
}

func positiveOrDefault(value int, fallback int, hardDefault int) int {
	if value > 0 {
		return value
	}
	if fallback > 0 {
		return fallback
	}
	return hardDefault
}

func valueOr(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func normalizePopSide(value string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "left", "right":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		if strings.ToLower(strings.TrimSpace(fallback)) == "left" {
			return "left"
		}
		return "right"
	}
}

func collectorMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "http", "resp", "subscribe":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "auto"
	}
}

func boolPtr(value bool) *bool {
	return &value
}

func managerCollectorEnabled(cfg store.ManagerConfig) bool {
	return cfg.Collector.Enabled == nil || *cfg.Collector.Enabled
}

func setupRequestMonitoringEnabled(req setupRequest) bool {
	if req.RequestMonitoringEnabled == nil {
		return true
	}
	return *req.RequestMonitoringEnabled
}

func (s *Server) authorizeIfConfigured(w http.ResponseWriter, r *http.Request) bool {
	setup, ok, err := s.resolveSetup(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return false
	}
	if !ok || setup.ManagementKey == "" {
		return true
	}
	if authMatches(r, setup.ManagementKey) {
		return true
	}
	writeError(w, http.StatusUnauthorized, errors.New("invalid management key"))
	return false
}

func authMatches(r *http.Request, managementKey string) bool {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" || managementKey == "" {
		return false
	}
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return false
	}
	return strings.TrimSpace(header[len(prefix):]) == managementKey
}

func (s *Server) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.writeCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (s *Server) writeCORS(w http.ResponseWriter, r *http.Request) {
	if len(s.cfg.CORSOrigins) == 0 {
		return
	}
	origin := r.Header.Get("Origin")
	allowed := s.cfg.CORSOrigins[0]
	for _, candidate := range s.cfg.CORSOrigins {
		if candidate == "*" || candidate == origin {
			allowed = candidate
			break
		}
	}
	if allowed == "*" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else if origin != "" && allowed == origin {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
}

func validateCollectorAgainstCPA(ctx context.Context, cfg store.ManagerConfig) error {
	usageCfg, err := fetchCPAUsageConfig(ctx, cfg.CPAConnection.CPABaseURL, cfg.CPAConnection.ManagementKey)
	if err != nil {
		return err
	}
	retentionMS := usageCfg.RedisUsageQueueRetentionSeconds * 1000
	if retentionMS <= 0 {
		return errors.New("CPA redis-usage-queue-retention-seconds must be greater than 0")
	}
	if cfg.Collector.PollIntervalMS > retentionMS {
		return fmt.Errorf(
			"pollIntervalMs must be less than or equal to CPA redis-usage-queue-retention-seconds (%d seconds)",
			usageCfg.RedisUsageQueueRetentionSeconds,
		)
	}
	return nil
}

func validateManagementAPI(ctx context.Context, baseURL string, key string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v0/management/config", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	return errors.New("management API validation failed: " + res.Status)
}

func fetchCPAUsageConfig(ctx context.Context, baseURL string, key string) (cpaUsageConfig, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalizeBaseURL(baseURL)+"/v0/management/config", nil)
	if err != nil {
		return cpaUsageConfig{}, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return cpaUsageConfig{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return cpaUsageConfig{}, errors.New("management API config request failed: " + res.Status)
	}

	var raw map[string]any
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return cpaUsageConfig{}, err
	}
	usageEnabled := readBoolField(raw, "usage-statistics-enabled", "usageStatisticsEnabled")
	retention, hasRetention := readIntField(raw, "redis-usage-queue-retention-seconds", "redisUsageQueueRetentionSeconds")
	if !hasRetention {
		retention = 60
	}
	return cpaUsageConfig{
		UsageStatisticsEnabled:          usageEnabled,
		RedisUsageQueueRetentionSeconds: retention,
		RetentionSourceDefault:          !hasRetention,
	}, nil
}

func setCPAUsageStatisticsEnabled(ctx context.Context, baseURL string, key string, enabled bool) error {
	payload := map[string]bool{"value": enabled}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPut,
		normalizeBaseURL(baseURL)+"/v0/management/usage-statistics-enabled",
		strings.NewReader(string(data)),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	return errors.New("enable CPA usage statistics failed: " + res.Status)
}

func readBoolField(raw map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			normalized := strings.ToLower(strings.TrimSpace(typed))
			return normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
		}
	}
	return false
}

func readIntField(raw map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int(typed), true
		case int:
			return typed, true
		case json.Number:
			parsed, err := strconv.Atoi(typed.String())
			return parsed, err == nil
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			return parsed, err == nil
		}
	}
	return 0, false
}

func normalizeBaseURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	value = strings.TrimRight(value, "/")
	value = strings.TrimSuffix(value, "/v0/management")
	value = strings.TrimSuffix(value, "/v0")
	return value
}

// WriteJSON outputs a JSON response. Exported for use by other internal packages.
func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// WriteError outputs an error JSON response. Exported for use by other internal packages.
func WriteError(w http.ResponseWriter, status int, err error) {
	WriteJSON(w, status, map[string]any{"error": err.Error(), "code": usageServiceErrorCode(err)})
}

// Unexported aliases to preserve existing internal call sites unchanged.
func writeJSON(w http.ResponseWriter, status int, value any)  { WriteJSON(w, status, value) }
func writeError(w http.ResponseWriter, status int, err error) { WriteError(w, status, err) }

func methodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
}

func usageServiceErrorCode(err error) string {
	message := err.Error()
	switch {
	case strings.Contains(message, "connection setup is managed by environment variables"):
		return "connection_env_managed"
	case strings.Contains(message, "cpaBaseUrl and managementKey are required when request monitoring is enabled"):
		return "cpa_connection_required_for_monitoring"
	case strings.Contains(message, "cpaBaseUrl and managementKey are required"):
		return "cpa_connection_required"
	case strings.Contains(message, "setup is managed by environment variables"):
		return "setup_env_managed"
	case strings.Contains(message, "invalid management key for existing setup"):
		return "invalid_existing_management_key"
	case strings.Contains(message, "invalid management key"):
		return "invalid_management_key"
	case strings.Contains(message, "usage service is not configured"):
		return "usage_service_not_configured"
	case strings.Contains(message, "CPA redis-usage-queue-retention-seconds must be greater than 0"):
		return "cpa_usage_retention_invalid"
	case strings.Contains(message, "pollIntervalMs must be less than or equal"):
		return "poll_interval_exceeds_retention"
	case strings.Contains(message, "management API validation failed"):
		return "management_api_validation_failed"
	case strings.Contains(message, "management API config request failed"):
		return "management_api_config_failed"
	case strings.Contains(message, "enable CPA usage statistics failed"):
		return "enable_cpa_usage_statistics_failed"
	case strings.Contains(message, "prices are required"):
		return "prices_required"
	case strings.Contains(message, "api key aliases are required"):
		return "api_key_aliases_required"
	case strings.Contains(message, "api key alias already exists"):
		return "api_key_alias_duplicate"
	case strings.Contains(message, "model price sync failed"):
		return "model_price_sync_failed"
	case strings.Contains(message, "method not allowed"):
		return "method_not_allowed"
	default:
		return "request_failed"
	}
}
