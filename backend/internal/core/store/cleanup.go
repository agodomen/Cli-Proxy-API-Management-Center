package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CleanupTableID identifies a log-like table that supports manual retention cleanup.
type CleanupTableID string

const (
	CleanupTableUsageEvents      CleanupTableID = "usage_events"
	CleanupTableDeadLetterEvents CleanupTableID = "dead_letter_events"
	CleanupTableProbeResults     CleanupTableID = "probe_results"
	CleanupTableProbeActionLogs  CleanupTableID = "probe_action_logs"
)

// CleanupTableInfo describes a cleanup-eligible table and current volume stats.
type CleanupTableInfo struct {
	ID                 CleanupTableID   `json:"id"`
	Name               string           `json:"name"`
	Category           string           `json:"category"`
	TimeColumn         string           `json:"timeColumn"`
	TotalRows          int64            `json:"totalRows"`
	OldestTimestampMS  *int64           `json:"oldestTimestampMs,omitempty"`
	NewestTimestampMS  *int64           `json:"newestTimestampMs,omitempty"`
	EstimatedDeletable map[string]int64 `json:"estimatedDeletable"`
}

// CleanupRequest is the payload for a manual cleanup operation.
type CleanupRequest struct {
	Table CleanupTableID `json:"table"`
	// Mode: "all" deletes every row; "days" deletes rows older than Days.
	Mode string `json:"mode"`
	Days int    `json:"days,omitempty"`
}

// CleanupResult is returned after a cleanup operation completes.
type CleanupResult struct {
	Table     CleanupTableID `json:"table"`
	Mode      string         `json:"mode"`
	Days      int            `json:"days,omitempty"`
	CutoffMS  *int64         `json:"cutoffMs,omitempty"`
	Deleted   int64          `json:"deleted"`
	Remaining int64          `json:"remaining"`
}

type cleanupTableMeta struct {
	id         CleanupTableID
	name       string
	category   string
	timeColumn string
}

var cleanupTableCatalog = []cleanupTableMeta{
	{
		id:         CleanupTableUsageEvents,
		name:       "usage_events",
		category:   "request_logs",
		timeColumn: "timestamp_ms",
	},
	{
		id:         CleanupTableDeadLetterEvents,
		name:       "dead_letter_events",
		category:   "request_logs",
		timeColumn: "created_at_ms",
	},
	{
		id:         CleanupTableProbeResults,
		name:       "probe_results",
		category:   "probe_logs",
		timeColumn: "timestamp_ms",
	},
	{
		id:         CleanupTableProbeActionLogs,
		name:       "probe_action_logs",
		category:   "probe_logs",
		timeColumn: "created_at_ms",
	},
}

var cleanupDayPresets = []int{366, 180, 90, 30, 17, 7, 3}

func lookupCleanupTable(id CleanupTableID) (cleanupTableMeta, bool) {
	for _, item := range cleanupTableCatalog {
		if item.id == id {
			return item, true
		}
	}
	return cleanupTableMeta{}, false
}

func cleanupCutoffMS(days int, nowMS int64) int64 {
	return nowMS - int64(days)*24*60*60*1000
}

func (s *Store) ListCleanupTables(ctx context.Context) ([]CleanupTableInfo, error) {
	nowMS := time.Now().UnixMilli()
	out := make([]CleanupTableInfo, 0, len(cleanupTableCatalog))
	for _, meta := range cleanupTableCatalog {
		info, err := s.inspectCleanupTable(ctx, meta, nowMS)
		if err != nil {
			// Probe tables may not exist until probe schema is initialized.
			if isMissingTableError(err) {
				info = CleanupTableInfo{
					ID:                 meta.id,
					Name:               meta.name,
					Category:           meta.category,
					TimeColumn:         meta.timeColumn,
					TotalRows:          0,
					EstimatedDeletable: map[string]int64{"all": 0},
				}
				for _, days := range cleanupDayPresets {
					info.EstimatedDeletable[fmt.Sprintf("days_%d", days)] = 0
				}
				out = append(out, info)
				continue
			}
			return nil, err
		}
		out = append(out, info)
	}
	return out, nil
}

func (s *Store) inspectCleanupTable(ctx context.Context, meta cleanupTableMeta, nowMS int64) (CleanupTableInfo, error) {
	info := CleanupTableInfo{
		ID:                 meta.id,
		Name:               meta.name,
		Category:           meta.category,
		TimeColumn:         meta.timeColumn,
		EstimatedDeletable: map[string]int64{},
	}

	var total int64
	if err := s.db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s`, meta.name)).Scan(&total); err != nil {
		return info, err
	}
	info.TotalRows = total
	info.EstimatedDeletable["all"] = total

	var oldest sql.NullInt64
	var newest sql.NullInt64
	if err := s.db.QueryRowContext(
		ctx,
		fmt.Sprintf(`SELECT MIN(%s), MAX(%s) FROM %s`, meta.timeColumn, meta.timeColumn, meta.name),
	).Scan(&oldest, &newest); err != nil {
		return info, err
	}
	if oldest.Valid {
		value := oldest.Int64
		info.OldestTimestampMS = &value
	}
	if newest.Valid {
		value := newest.Int64
		info.NewestTimestampMS = &value
	}

	for _, days := range cleanupDayPresets {
		cutoff := cleanupCutoffMS(days, nowMS)
		var count int64
		if err := s.db.QueryRowContext(
			ctx,
			fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s > 0 AND %s < ?`, meta.name, meta.timeColumn, meta.timeColumn),
			cutoff,
		).Scan(&count); err != nil {
			return info, err
		}
		info.EstimatedDeletable[fmt.Sprintf("days_%d", days)] = count
	}
	return info, nil
}

func (s *Store) CleanupTable(ctx context.Context, req CleanupRequest) (CleanupResult, error) {
	meta, ok := lookupCleanupTable(req.Table)
	if !ok {
		return CleanupResult{}, fmt.Errorf("unsupported cleanup table: %s", req.Table)
	}

	mode := strings.TrimSpace(strings.ToLower(req.Mode))
	result := CleanupResult{
		Table: meta.id,
		Mode:  mode,
		Days:  req.Days,
	}

	var (
		deleted int64
		err     error
	)
	switch mode {
	case "all":
		deleted, err = s.deleteCleanupRows(ctx, meta, nil)
	case "days", "custom_days", "custom":
		if req.Days <= 0 {
			return CleanupResult{}, errors.New("days must be greater than 0")
		}
		cutoff := cleanupCutoffMS(req.Days, time.Now().UnixMilli())
		result.CutoffMS = &cutoff
		deleted, err = s.deleteCleanupRows(ctx, meta, &cutoff)
	default:
		return CleanupResult{}, fmt.Errorf("unsupported cleanup mode: %s", req.Mode)
	}
	if err != nil {
		return CleanupResult{}, err
	}
	result.Deleted = deleted

	remaining, err := s.countCleanupRows(ctx, meta)
	if err != nil {
		return CleanupResult{}, err
	}
	result.Remaining = remaining
	return result, nil
}

func (s *Store) countCleanupRows(ctx context.Context, meta cleanupTableMeta) (int64, error) {
	var count int64
	err := s.db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s`, meta.name)).Scan(&count)
	if err != nil {
		if isMissingTableError(err) {
			return 0, nil
		}
		return 0, err
	}
	return count, nil
}

func (s *Store) deleteCleanupRows(ctx context.Context, meta cleanupTableMeta, cutoffMS *int64) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	// Keep FTS in sync for usage_events. There is intentionally no delete trigger yet.
	if meta.id == CleanupTableUsageEvents {
		if cutoffMS == nil {
			if _, err := tx.ExecContext(ctx, `DELETE FROM usage_events_fts`); err != nil && !isMissingTableError(err) {
				return 0, err
			}
		} else {
			if _, err := tx.ExecContext(
				ctx,
				`DELETE FROM usage_events_fts
				 WHERE event_id IN (
					SELECT id FROM usage_events
					WHERE timestamp_ms > 0 AND timestamp_ms < ?
				 )`,
				*cutoffMS,
			); err != nil && !isMissingTableError(err) {
				return 0, err
			}
		}
	}

	var res sql.Result
	if cutoffMS == nil {
		res, err = tx.ExecContext(ctx, fmt.Sprintf(`DELETE FROM %s`, meta.name))
	} else {
		res, err = tx.ExecContext(
			ctx,
			fmt.Sprintf(`DELETE FROM %s WHERE %s > 0 AND %s < ?`, meta.name, meta.timeColumn, meta.timeColumn),
			*cutoffMS,
		)
	}
	if err != nil {
		if isMissingTableError(err) {
			return 0, nil
		}
		return 0, err
	}
	deleted, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return deleted, nil
}

func isMissingTableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table")
}

const settingDataCleanKey = "setting.data.clean"

// CleanupTablePreference stores the last selected cleanup scope for one table.
type CleanupTablePreference struct {
	Mode string `json:"mode"` // all | days | custom
	Days int    `json:"days,omitempty"`
}

// CleanupSettings is persisted in settings under key setting.data.clean.
type CleanupSettings struct {
	Tables      map[string]CleanupTablePreference `json:"tables"`
	UpdatedAtMS int64                             `json:"updatedAtMs,omitempty"`
}

func defaultCleanupSettings() CleanupSettings {
	tables := make(map[string]CleanupTablePreference, len(cleanupTableCatalog))
	for _, meta := range cleanupTableCatalog {
		tables[string(meta.id)] = CleanupTablePreference{Mode: "days", Days: 30}
	}
	return CleanupSettings{Tables: tables}
}

func normalizeCleanupSettings(raw CleanupSettings) CleanupSettings {
	out := defaultCleanupSettings()
	if raw.Tables == nil {
		out.UpdatedAtMS = raw.UpdatedAtMS
		return out
	}
	for id, pref := range raw.Tables {
		if _, ok := lookupCleanupTable(CleanupTableID(id)); !ok {
			continue
		}
		mode := strings.TrimSpace(strings.ToLower(pref.Mode))
		switch mode {
		case "all":
			out.Tables[id] = CleanupTablePreference{Mode: "all"}
		case "custom", "custom_days":
			days := pref.Days
			if days <= 0 {
				days = 30
			}
			out.Tables[id] = CleanupTablePreference{Mode: "custom", Days: days}
		case "days", "":
			days := pref.Days
			if days <= 0 {
				// accept legacy days_N encoded only via days field
				days = 30
			}
			// normalize known presets keep mode=days
			out.Tables[id] = CleanupTablePreference{Mode: "days", Days: days}
		default:
			// allow values like days_30 from older frontend snapshots
			if strings.HasPrefix(mode, "days_") {
				var days int
				if _, err := fmt.Sscanf(mode, "days_%d", &days); err == nil && days > 0 {
					out.Tables[id] = CleanupTablePreference{Mode: "days", Days: days}
					continue
				}
			}
			out.Tables[id] = CleanupTablePreference{Mode: "days", Days: 30}
		}
	}
	out.UpdatedAtMS = raw.UpdatedAtMS
	return out
}

func (s *Store) LoadCleanupSettings(ctx context.Context) (CleanupSettings, error) {
	raw, ok, err := s.LoadSetting(ctx, settingDataCleanKey)
	if err != nil {
		return CleanupSettings{}, err
	}
	if !ok || strings.TrimSpace(raw) == "" {
		return defaultCleanupSettings(), nil
	}
	var parsed CleanupSettings
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return defaultCleanupSettings(), nil
	}
	return normalizeCleanupSettings(parsed), nil
}

func (s *Store) SaveCleanupSettings(ctx context.Context, settings CleanupSettings) (CleanupSettings, error) {
	normalized := normalizeCleanupSettings(settings)
	normalized.UpdatedAtMS = time.Now().UnixMilli()
	payload, err := json.Marshal(normalized)
	if err != nil {
		return CleanupSettings{}, err
	}
	if err := s.SaveSetting(ctx, settingDataCleanKey, string(payload)); err != nil {
		return CleanupSettings{}, err
	}
	return normalized, nil
}

func (s *Store) UpsertCleanupTablePreference(ctx context.Context, table CleanupTableID, pref CleanupTablePreference) (CleanupSettings, error) {
	if _, ok := lookupCleanupTable(table); !ok {
		return CleanupSettings{}, fmt.Errorf("unsupported cleanup table: %s", table)
	}
	current, err := s.LoadCleanupSettings(ctx)
	if err != nil {
		return CleanupSettings{}, err
	}
	if current.Tables == nil {
		current.Tables = map[string]CleanupTablePreference{}
	}
	current.Tables[string(table)] = pref
	return s.SaveCleanupSettings(ctx, current)
}
