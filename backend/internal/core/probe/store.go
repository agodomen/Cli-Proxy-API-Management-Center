package probe

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Store persists probe results, action logs and service config.
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) EnsureSchema(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS probe_results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_hash TEXT NOT NULL UNIQUE,
			request_id TEXT,
			timestamp_ms INTEGER NOT NULL,
			auth_index TEXT,
			api_key_hash TEXT,
			key_id INTEGER,
			provider_id INTEGER,
			provider_name TEXT,
			account TEXT,
			auth_label TEXT,
			auth_file TEXT,
			auth_provider TEXT,
			model TEXT,
			endpoint TEXT,
			status_code INTEGER DEFAULT 0,
			latency_ms INTEGER,
			failed INTEGER NOT NULL DEFAULT 0,
			success INTEGER NOT NULL DEFAULT 0,
			error_message TEXT,
			action_applied TEXT,
			action_detail TEXT,
			created_at_ms INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_results_ts ON probe_results(timestamp_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_results_auth ON probe_results(auth_index, timestamp_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_results_key ON probe_results(key_id, timestamp_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_results_provider ON probe_results(provider_id, timestamp_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_results_success ON probe_results(success, timestamp_ms DESC)`,
		`CREATE TABLE IF NOT EXISTS probe_action_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at_ms INTEGER NOT NULL,
			auth_index TEXT,
			key_id INTEGER,
			action TEXT NOT NULL,
			detail TEXT,
			success INTEGER NOT NULL DEFAULT 0,
			error TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_action_logs_ts ON probe_action_logs(created_at_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_probe_action_logs_auth ON probe_action_logs(auth_index, created_at_ms DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) LoadConfig(ctx context.Context) (Config, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, settingKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultConfig(), nil
	}
	if err != nil {
		return Config{}, err
	}
	cfg := DefaultConfig()
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return DefaultConfig(), nil
	}
	return cfg.Normalize(), nil
}

func (s *Store) SaveConfig(ctx context.Context, cfg Config) error {
	cfg = cfg.Normalize()
	cfg.UpdatedAtMS = nowMS()
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(
		ctx,
		`INSERT INTO settings(key, value, updated_at_ms)
		 VALUES(?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
		settingKey,
		string(data),
		cfg.UpdatedAtMS,
	)
	return err
}

type keyMatch struct {
	ID             int64
	AuthIndex      string
	Status         int
	Priority       int
	ProviderID     sql.NullInt64
	ProviderName   string
	AuthFile       string
	ExpiresAtMS    sql.NullInt64
	ProbePolicy    string
	ProviderPolicy string
}

type providerSyncKey struct {
	ID        int64
	AuthIndex string
	AuthType  int
	AuthValue string
	Status    int
	Priority  int
	Param     string
}

type providerSyncSnapshot struct {
	ID            int64
	Name          string
	Status        int
	BaseURL       string
	ProtocolType  string
	CPAConfigType string
	Param         string
	Keys          []providerSyncKey
}

func (s *Store) LoadProviderSyncSnapshot(ctx context.Context, providerID int64) (providerSyncSnapshot, error) {
	var snapshot providerSyncSnapshot
	err := s.db.QueryRowContext(ctx, `SELECT provider_id, provider_name, status, base_url,
		COALESCE(protocol_type, 'openai_compatible'), COALESCE(cpa_config_type, 'openai-compatibility'), COALESCE(param, '{}')
		FROM cpa_provider_info WHERE provider_id = ?`, providerID).Scan(
		&snapshot.ID, &snapshot.Name, &snapshot.Status, &snapshot.BaseURL,
		&snapshot.ProtocolType, &snapshot.CPAConfigType, &snapshot.Param,
	)
	if err != nil {
		return providerSyncSnapshot{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, auth_index, auth_type, auth_value, status, priority, COALESCE(param, '{}')
		FROM cpa_auth_detail WHERE provider_id = ? ORDER BY priority DESC, id ASC`, providerID)
	if err != nil {
		return providerSyncSnapshot{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var key providerSyncKey
		if err := rows.Scan(&key.ID, &key.AuthIndex, &key.AuthType, &key.AuthValue, &key.Status, &key.Priority, &key.Param); err != nil {
			return providerSyncSnapshot{}, err
		}
		snapshot.Keys = append(snapshot.Keys, key)
	}
	return snapshot, rows.Err()
}

func (s *Store) FindKeyByAuthIndex(ctx context.Context, authIndex string) (keyMatch, bool, error) {
	authIndex = strings.TrimSpace(authIndex)
	if authIndex == "" {
		return keyMatch{}, false, nil
	}
	var item keyMatch
	err := s.db.QueryRowContext(
		ctx,
		`SELECT k.id, k.auth_index, k.status, k.priority, k.provider_id,
		        COALESCE(p.provider_name, ''), COALESCE(CASE WHEN json_valid(k.auth_info) THEN json_extract(k.auth_info, '$.file_name') END, ''),
		        k.expires_at_ms, COALESCE(k.probe_policy, '{}'), COALESCE(p.probe_policy, '{}')
		 FROM cpa_auth_detail k
		 LEFT JOIN cpa_provider_info p ON p.provider_id = k.provider_id
		 WHERE k.auth_index = ?
		 LIMIT 1`,
		authIndex,
	).Scan(&item.ID, &item.AuthIndex, &item.Status, &item.Priority, &item.ProviderID, &item.ProviderName, &item.AuthFile, &item.ExpiresAtMS, &item.ProbePolicy, &item.ProviderPolicy)
	if errors.Is(err, sql.ErrNoRows) {
		return keyMatch{}, false, nil
	}
	if err != nil {
		return keyMatch{}, false, err
	}
	return item, true, nil
}

func (s *Store) InsertResult(ctx context.Context, result Result) (bool, error) {
	failed := 0
	if result.Failed {
		failed = 1
	}
	success := 0
	if result.Success {
		success = 1
	}
	res, err := s.db.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO probe_results (
			event_hash, request_id, timestamp_ms, auth_index, api_key_hash,
			key_id, provider_id, provider_name, account, auth_label, auth_file, auth_provider,
			model, endpoint, status_code, latency_ms, failed, success, error_message,
			action_applied, action_detail, created_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		result.EventHash,
		nullString(result.RequestID),
		result.TimestampMS,
		nullString(result.AuthIndex),
		nullString(result.APIKeyHash),
		nullInt64(result.KeyID),
		nullInt64(result.ProviderID),
		nullString(result.ProviderName),
		nullString(result.Account),
		nullString(result.AuthLabel),
		nullString(result.AuthFile),
		nullString(result.AuthProvider),
		nullString(result.Model),
		nullString(result.Endpoint),
		result.StatusCode,
		nullInt(result.LatencyMS),
		failed,
		success,
		nullString(result.ErrorMessage),
		nullString(result.ActionApplied),
		nullString(result.ActionDetail),
		result.CreatedAtMS,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *Store) UpdateResultAction(ctx context.Context, eventHash, action, detail string) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE probe_results SET action_applied = ?, action_detail = ? WHERE event_hash = ?`,
		nullString(action),
		nullString(detail),
		eventHash,
	)
	return err
}

func (s *Store) InsertActionLog(ctx context.Context, log ActionLog) error {
	success := 0
	if log.Success {
		success = 1
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO probe_action_logs (created_at_ms, auth_index, key_id, action, detail, success, error)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		log.CreatedAtMS,
		nullString(log.AuthIndex),
		nullInt64(log.KeyID),
		log.Action,
		nullString(log.Detail),
		success,
		nullString(log.Error),
	)
	return err
}

func (s *Store) LatestSuccessfulAction(ctx context.Context, authIndex string) (string, bool, error) {
	var action string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT action
		 FROM probe_action_logs
		 WHERE auth_index = ? AND success = 1
		 ORDER BY created_at_ms DESC, id DESC
		 LIMIT 1`,
		strings.TrimSpace(authIndex),
	).Scan(&action)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return action, true, nil
}

func (s *Store) UpdateKeyPriority(ctx context.Context, keyID int64, priority int) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE cpa_auth_detail SET priority = ?, update_at = CURRENT_TIMESTAMP WHERE id = ?`,
		priority,
		keyID,
	)
	return err
}

func (s *Store) UpdateKeyStatus(ctx context.Context, keyID int64, status int) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE cpa_auth_detail SET status = ?, update_at = CURRENT_TIMESTAMP WHERE id = ?`,
		status,
		keyID,
	)
	return err
}

func (s *Store) UpdateKeyExpiration(ctx context.Context, keyID int64, expiresAtMS int64) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE cpa_auth_detail SET expires_at_ms = ?, update_at = CURRENT_TIMESTAMP WHERE id = ?`,
		expiresAtMS,
		keyID,
	)
	return err
}

func (s *Store) ExpireDueKeys(ctx context.Context, now int64, limit int) ([]keyMatch, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT k.id, k.auth_index, k.status, k.priority, k.provider_id,
		        COALESCE(p.provider_name, ''), COALESCE(CASE WHEN json_valid(k.auth_info) THEN json_extract(k.auth_info, '$.file_name') END, ''),
		        k.expires_at_ms, COALESCE(k.probe_policy, '{}'), COALESCE(p.probe_policy, '{}')
		 FROM cpa_auth_detail k
		 LEFT JOIN cpa_provider_info p ON p.provider_id = k.provider_id
		 WHERE k.expires_at_ms IS NOT NULL AND k.expires_at_ms > 0 AND k.expires_at_ms <= ?
		   AND k.status NOT IN (-2, -3)
		 ORDER BY k.expires_at_ms ASC
		 LIMIT ?`,
		now,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]keyMatch, 0)
	for rows.Next() {
		var item keyMatch
		if err := rows.Scan(&item.ID, &item.AuthIndex, &item.Status, &item.Priority, &item.ProviderID, &item.ProviderName, &item.AuthFile, &item.ExpiresAtMS, &item.ProbePolicy, &item.ProviderPolicy); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CountConsecutive(ctx context.Context, authIndex string, success bool) (int64, error) {
	authIndex = strings.TrimSpace(authIndex)
	if authIndex == "" {
		return 0, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT success FROM probe_results
		 WHERE auth_index = ?
		 ORDER BY timestamp_ms DESC, id DESC
		 LIMIT 50`,
		authIndex,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	want := 0
	if success {
		want = 1
	}
	var count int64
	for rows.Next() {
		var value int
		if err := rows.Scan(&value); err != nil {
			return 0, err
		}
		if value != want {
			break
		}
		count++
	}
	return count, rows.Err()
}

func (s *Store) Summary(ctx context.Context, windowSeconds int, enabled bool, serviceStatus string) (Summary, error) {
	if windowSeconds <= 0 {
		windowSeconds = 3600
	}
	since := time.Now().UnixMilli() - int64(windowSeconds)*1000
	summary := Summary{
		WindowSeconds: windowSeconds,
		Enabled:       enabled,
		ServiceStatus: serviceStatus,
	}

	err := s.db.QueryRowContext(
		ctx,
		`SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN failed = 1 THEN 1 ELSE 0 END), 0),
			COUNT(DISTINCT CASE WHEN auth_index IS NOT NULL AND auth_index != '' THEN auth_index END),
			COUNT(DISTINCT CASE WHEN account IS NOT NULL AND account != '' THEN account END),
			AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END),
			COALESCE(MAX(timestamp_ms), 0),
			COALESCE(SUM(CASE WHEN action_applied IS NOT NULL AND action_applied != '' THEN 1 ELSE 0 END), 0)
		 FROM probe_results
		 WHERE timestamp_ms >= ?`,
		since,
	).Scan(
		&summary.TotalProbes,
		&summary.SuccessCount,
		&summary.FailureCount,
		&summary.UniqueKeys,
		&summary.UniqueAccounts,
		&sqlNullFloat{target: &summary.AvgLatencyMS},
		&summary.LastProbeAtMS,
		&summary.ActionsApplied,
	)
	if err != nil {
		return Summary{}, err
	}
	if summary.TotalProbes > 0 {
		summary.SuccessRate = float64(summary.SuccessCount) / float64(summary.TotalProbes)
	}
	return summary, nil
}

func (s *Store) ListResults(ctx context.Context, p ListParams) (PageResult[Result], error) {
	where, args := buildResultWhere(p)
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM probe_results`+where, args...).Scan(&total); err != nil {
		return PageResult[Result]{}, err
	}
	page, pageSize := normalizePage(p.Page, p.PageSize)
	query := `SELECT id, event_hash, request_id, timestamp_ms, auth_index, api_key_hash,
		key_id, provider_id, provider_name, account, auth_label, auth_file, auth_provider,
		model, endpoint, status_code, latency_ms, failed, success, error_message,
		action_applied, action_detail, created_at_ms
		FROM probe_results` + where + ` ORDER BY timestamp_ms DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return PageResult[Result]{}, err
	}
	defer rows.Close()

	items := make([]Result, 0, pageSize)
	for rows.Next() {
		item, err := scanResult(rows)
		if err != nil {
			return PageResult[Result]{}, err
		}
		items = append(items, item)
	}
	return PageResult[Result]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

func (s *Store) ListKeyStats(ctx context.Context, windowSeconds int, search string, page, pageSize int) (PageResult[KeyStat], error) {
	if windowSeconds <= 0 {
		windowSeconds = 3600
	}
	page, pageSize = normalizePage(page, pageSize)
	since := time.Now().UnixMilli() - int64(windowSeconds)*1000

	where := ` WHERE r.timestamp_ms >= ?`
	args := []any{since}
	if strings.TrimSpace(search) != "" {
		like := "%" + strings.TrimSpace(search) + "%"
		where += ` AND (
			COALESCE(r.auth_index, '') LIKE ? OR
			COALESCE(r.account, '') LIKE ? OR
			COALESCE(r.auth_label, '') LIKE ? OR
			COALESCE(r.auth_file, '') LIKE ? OR
			COALESCE(r.provider_name, '') LIKE ?
		)`
		args = append(args, like, like, like, like, like)
	}

	countQuery := `SELECT COUNT(*) FROM (
		SELECT COALESCE(NULLIF(r.auth_index, ''), printf('key:%d', COALESCE(r.key_id, 0))) AS group_key
		FROM probe_results r` + where + `
		GROUP BY group_key
	)`
	var total int64
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return PageResult[KeyStat]{}, err
	}

	query := `
		SELECT
			MAX(r.key_id) AS key_id,
			MAX(r.auth_index) AS auth_index,
			MAX(r.api_key_hash) AS api_key_hash,
			MAX(r.provider_id) AS provider_id,
			MAX(r.provider_name) AS provider_name,
			MAX(r.account) AS account,
			MAX(r.auth_label) AS auth_label,
			MAX(r.auth_file) AS auth_file,
			MAX(r.auth_provider) AS auth_provider,
			COUNT(*) AS total_probes,
			SUM(CASE WHEN r.success = 1 THEN 1 ELSE 0 END) AS success_count,
			SUM(CASE WHEN r.failed = 1 THEN 1 ELSE 0 END) AS failure_count,
			AVG(CASE WHEN r.latency_ms IS NOT NULL THEN r.latency_ms END) AS avg_latency,
			MAX(r.timestamp_ms) AS last_probe_at_ms
		FROM probe_results r` + where + `
		GROUP BY COALESCE(NULLIF(r.auth_index, ''), printf('key:%d', COALESCE(r.key_id, 0)))
		ORDER BY last_probe_at_ms DESC
		LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return PageResult[KeyStat]{}, err
	}
	defer rows.Close()

	// Scan aggregate rows first, then enrich. Nested queries while rows are open
	// deadlock under store.Open's MaxOpenConns(1).
	items := make([]KeyStat, 0, pageSize)
	for rows.Next() {
		var item KeyStat
		var keyID, providerID sql.NullInt64
		var authIndex, apiKeyHash, providerName, account, authLabel, authFile, authProvider sql.NullString
		var avgLatency sql.NullFloat64
		if err := rows.Scan(
			&keyID,
			&authIndex,
			&apiKeyHash,
			&providerID,
			&providerName,
			&account,
			&authLabel,
			&authFile,
			&authProvider,
			&item.TotalProbes,
			&item.SuccessCount,
			&item.FailureCount,
			&avgLatency,
			&item.LastProbeAtMS,
		); err != nil {
			return PageResult[KeyStat]{}, err
		}
		if keyID.Valid {
			v := keyID.Int64
			item.KeyID = &v
		}
		if providerID.Valid {
			v := providerID.Int64
			item.ProviderID = &v
		}
		item.AuthIndex = authIndex.String
		item.APIKeyHash = apiKeyHash.String
		item.ProviderName = providerName.String
		item.Account = account.String
		item.AuthLabel = authLabel.String
		item.AuthFile = authFile.String
		item.AuthProvider = authProvider.String
		if avgLatency.Valid {
			v := int64(avgLatency.Float64)
			item.AvgLatencyMS = &v
		}
		if item.TotalProbes > 0 {
			item.SuccessRate = float64(item.SuccessCount) / float64(item.TotalProbes)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return PageResult[KeyStat]{}, err
	}
	if err := rows.Close(); err != nil {
		return PageResult[KeyStat]{}, err
	}

	for i := range items {
		item := &items[i]
		if item.AuthIndex == "" {
			continue
		}
		if last, ok, err := s.latestResult(ctx, item.AuthIndex); err == nil && ok {
			item.LastStatusCode = last.StatusCode
			item.LastFailed = last.Failed
			item.LastError = last.ErrorMessage
			item.LastAction = last.ActionApplied
		}
		if fails, err := s.CountConsecutive(ctx, item.AuthIndex, false); err == nil {
			item.ConsecutiveFail = fails
		}
		if oks, err := s.CountConsecutive(ctx, item.AuthIndex, true); err == nil {
			item.ConsecutiveOK = oks
		}
		if match, ok, err := s.FindKeyByAuthIndex(ctx, item.AuthIndex); err == nil && ok {
			status := match.Status
			priority := match.Priority
			item.KeyStatus = &status
			item.KeyPriority = &priority
			if item.KeyID == nil {
				id := match.ID
				item.KeyID = &id
			}
			if item.ProviderID == nil && match.ProviderID.Valid {
				v := match.ProviderID.Int64
				item.ProviderID = &v
			}
			if item.ProviderName == "" {
				item.ProviderName = match.ProviderName
			}
		}
	}
	return PageResult[KeyStat]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, nil
}

func (s *Store) ListActions(ctx context.Context, page, pageSize int) (PageResult[ActionLog], error) {
	page, pageSize = normalizePage(page, pageSize)
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM probe_action_logs`).Scan(&total); err != nil {
		return PageResult[ActionLog]{}, err
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, created_at_ms, auth_index, key_id, action, detail, success, error
		 FROM probe_action_logs
		 ORDER BY created_at_ms DESC, id DESC
		 LIMIT ? OFFSET ?`,
		pageSize,
		(page-1)*pageSize,
	)
	if err != nil {
		return PageResult[ActionLog]{}, err
	}
	defer rows.Close()
	items := make([]ActionLog, 0, pageSize)
	for rows.Next() {
		var item ActionLog
		var authIndex, detail, errText sql.NullString
		var keyID sql.NullInt64
		var success int
		if err := rows.Scan(&item.ID, &item.CreatedAtMS, &authIndex, &keyID, &item.Action, &detail, &success, &errText); err != nil {
			return PageResult[ActionLog]{}, err
		}
		item.AuthIndex = authIndex.String
		item.Detail = detail.String
		item.Error = errText.String
		item.Success = success == 1
		if keyID.Valid {
			v := keyID.Int64
			item.KeyID = &v
		}
		items = append(items, item)
	}
	return PageResult[ActionLog]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

func (s *Store) latestResult(ctx context.Context, authIndex string) (Result, bool, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT id, event_hash, request_id, timestamp_ms, auth_index, api_key_hash,
			key_id, provider_id, provider_name, account, auth_label, auth_file, auth_provider,
			model, endpoint, status_code, latency_ms, failed, success, error_message,
			action_applied, action_detail, created_at_ms
		 FROM probe_results
		 WHERE auth_index = ?
		 ORDER BY timestamp_ms DESC, id DESC
		 LIMIT 1`,
		authIndex,
	)
	item, err := scanResult(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Result{}, false, nil
	}
	if err != nil {
		return Result{}, false, err
	}
	return item, true, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanResult(row rowScanner) (Result, error) {
	var item Result
	var requestID, authIndex, apiKeyHash, providerName, account, authLabel, authFile, authProvider, model, endpoint, errorMessage, actionApplied, actionDetail sql.NullString
	var keyID, providerID, latency sql.NullInt64
	var failed, success int
	if err := row.Scan(
		&item.ID,
		&item.EventHash,
		&requestID,
		&item.TimestampMS,
		&authIndex,
		&apiKeyHash,
		&keyID,
		&providerID,
		&providerName,
		&account,
		&authLabel,
		&authFile,
		&authProvider,
		&model,
		&endpoint,
		&item.StatusCode,
		&latency,
		&failed,
		&success,
		&errorMessage,
		&actionApplied,
		&actionDetail,
		&item.CreatedAtMS,
	); err != nil {
		return Result{}, err
	}
	item.RequestID = requestID.String
	item.AuthIndex = authIndex.String
	item.APIKeyHash = apiKeyHash.String
	item.ProviderName = providerName.String
	item.Account = account.String
	item.AuthLabel = authLabel.String
	item.AuthFile = authFile.String
	item.AuthProvider = authProvider.String
	item.Model = model.String
	item.Endpoint = endpoint.String
	item.ErrorMessage = errorMessage.String
	item.ActionApplied = actionApplied.String
	item.ActionDetail = actionDetail.String
	item.Failed = failed == 1
	item.Success = success == 1
	if keyID.Valid {
		v := keyID.Int64
		item.KeyID = &v
	}
	if providerID.Valid {
		v := providerID.Int64
		item.ProviderID = &v
	}
	if latency.Valid {
		v := latency.Int64
		item.LatencyMS = &v
	}
	return item, nil
}

func buildResultWhere(p ListParams) (string, []any) {
	conditions := make([]string, 0, 8)
	args := make([]any, 0, 8)
	if strings.TrimSpace(p.Search) != "" {
		like := "%" + strings.TrimSpace(p.Search) + "%"
		conditions = append(conditions, `(
			COALESCE(auth_index, '') LIKE ? OR
			COALESCE(account, '') LIKE ? OR
			COALESCE(auth_label, '') LIKE ? OR
			COALESCE(auth_file, '') LIKE ? OR
			COALESCE(provider_name, '') LIKE ? OR
			COALESCE(model, '') LIKE ? OR
			COALESCE(error_message, '') LIKE ?
		)`)
		args = append(args, like, like, like, like, like, like, like)
	}
	if strings.TrimSpace(p.AuthIndex) != "" {
		conditions = append(conditions, `auth_index = ?`)
		args = append(args, strings.TrimSpace(p.AuthIndex))
	}
	if p.KeyID != nil {
		conditions = append(conditions, `key_id = ?`)
		args = append(args, *p.KeyID)
	}
	if p.ProviderID != nil {
		conditions = append(conditions, `provider_id = ?`)
		args = append(args, *p.ProviderID)
	}
	if p.Success != nil {
		if *p.Success {
			conditions = append(conditions, `success = 1`)
		} else {
			conditions = append(conditions, `failed = 1`)
		}
	}
	if p.SinceMS != nil {
		conditions = append(conditions, `timestamp_ms >= ?`)
		args = append(args, *p.SinceMS)
	}
	if p.UntilMS != nil {
		conditions = append(conditions, `timestamp_ms <= ?`)
		args = append(args, *p.UntilMS)
	}
	if len(conditions) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		pageSize = 200
	}
	return page, pageSize
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullInt(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

// sqlNullFloat adapts AVG() results into *int64 average latency.
type sqlNullFloat struct {
	target **int64
}

func (s *sqlNullFloat) Scan(value any) error {
	if value == nil {
		*s.target = nil
		return nil
	}
	switch typed := value.(type) {
	case float64:
		v := int64(typed)
		*s.target = &v
		return nil
	case int64:
		v := typed
		*s.target = &v
		return nil
	case []byte:
		var f float64
		if _, err := fmt.Sscan(string(typed), &f); err != nil {
			return err
		}
		v := int64(f)
		*s.target = &v
		return nil
	default:
		return fmt.Errorf("unsupported avg latency type %T", value)
	}
}
