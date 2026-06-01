package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanupTableDaysAndAll(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now().UnixMilli()
	oldTS := now - 40*24*60*60*1000
	recentTS := now - 2*24*60*60*1000

	insert := func(eventHash string, ts int64) {
		t.Helper()
		_, err := db.DB().Exec(`
			INSERT INTO usage_events (
				request_id, event_hash, timestamp_ms, timestamp, model, created_at_ms
			) VALUES (?, ?, ?, ?, ?, ?)
		`, eventHash, eventHash, ts, "t", "gpt", now)
		if err != nil {
			t.Fatalf("insert %s: %v", eventHash, err)
		}
	}
	insert("old-event", oldTS)
	insert("recent-event", recentTS)

	// also seed dead letter / probe tables
	_, err = db.DB().Exec(`INSERT INTO dead_letter_events(payload, error, created_at_ms) VALUES ('{}', 'x', ?)`, oldTS)
	if err != nil {
		t.Fatalf("insert dead letter: %v", err)
	}
	_, err = db.DB().Exec(`
		CREATE TABLE IF NOT EXISTS probe_results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_hash TEXT NOT NULL UNIQUE,
			timestamp_ms INTEGER NOT NULL,
			failed INTEGER NOT NULL DEFAULT 0,
			success INTEGER NOT NULL DEFAULT 0,
			created_at_ms INTEGER NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("create probe_results: %v", err)
	}
	_, err = db.DB().Exec(`
		INSERT INTO probe_results(event_hash, timestamp_ms, created_at_ms)
		VALUES ('p1', ?, ?)
	`, oldTS, now)
	if err != nil {
		t.Fatalf("insert probe: %v", err)
	}

	tables, err := db.ListCleanupTables(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(tables) != 4 {
		t.Fatalf("tables = %d, want 4", len(tables))
	}
	var usageInfo *CleanupTableInfo
	for i := range tables {
		if tables[i].ID == CleanupTableUsageEvents {
			usageInfo = &tables[i]
		}
	}
	if usageInfo == nil {
		t.Fatal("usage_events missing")
	}
	if usageInfo.TotalRows != 2 {
		t.Fatalf("usage total = %d", usageInfo.TotalRows)
	}
	if usageInfo.EstimatedDeletable["days_30"] != 1 {
		t.Fatalf("days_30 estimate = %d, want 1", usageInfo.EstimatedDeletable["days_30"])
	}

	result, err := db.CleanupTable(context.Background(), CleanupRequest{
		Table: CleanupTableUsageEvents,
		Mode:  "days",
		Days:  30,
	})
	if err != nil {
		t.Fatalf("cleanup days: %v", err)
	}
	if result.Deleted != 1 || result.Remaining != 1 {
		t.Fatalf("days result = %+v", result)
	}

	// FTS should retain only remaining event
	var ftsCount int64
	if err := db.DB().QueryRow(`SELECT COUNT(*) FROM usage_events_fts`).Scan(&ftsCount); err != nil {
		t.Fatalf("fts count: %v", err)
	}
	if ftsCount != 1 {
		t.Fatalf("fts count = %d, want 1", ftsCount)
	}

	allResult, err := db.CleanupTable(context.Background(), CleanupRequest{
		Table: CleanupTableUsageEvents,
		Mode:  "all",
	})
	if err != nil {
		t.Fatalf("cleanup all: %v", err)
	}
	if allResult.Deleted != 1 || allResult.Remaining != 0 {
		t.Fatalf("all result = %+v", allResult)
	}
	if err := db.DB().QueryRow(`SELECT COUNT(*) FROM usage_events_fts`).Scan(&ftsCount); err != nil {
		t.Fatalf("fts count after all: %v", err)
	}
	if ftsCount != 0 {
		t.Fatalf("fts count after all = %d", ftsCount)
	}
}

func TestCleanupRejectsUnsupportedTable(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.CleanupTable(context.Background(), CleanupRequest{Table: "settings", Mode: "all"})
	if err == nil {
		t.Fatal("expected error for settings")
	}
}

func TestCleanupSettingsPersist(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	saved, err := db.SaveCleanupSettings(context.Background(), CleanupSettings{
		Tables: map[string]CleanupTablePreference{
			string(CleanupTableUsageEvents):  {Mode: "days", Days: 366},
			string(CleanupTableProbeResults): {Mode: "custom", Days: 45},
		},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.Tables[string(CleanupTableUsageEvents)].Days != 366 {
		t.Fatalf("usage pref = %+v", saved.Tables[string(CleanupTableUsageEvents)])
	}

	// verify settings row key
	raw, ok, err := db.LoadSetting(context.Background(), settingDataCleanKey)
	if err != nil || !ok || raw == "" {
		t.Fatalf("load setting raw: ok=%v err=%v raw=%q", ok, err, raw)
	}

	loaded, err := db.LoadCleanupSettings(context.Background())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Tables[string(CleanupTableUsageEvents)].Mode != "days" || loaded.Tables[string(CleanupTableUsageEvents)].Days != 366 {
		t.Fatalf("loaded usage = %+v", loaded.Tables[string(CleanupTableUsageEvents)])
	}
	if loaded.Tables[string(CleanupTableProbeResults)].Mode != "custom" || loaded.Tables[string(CleanupTableProbeResults)].Days != 45 {
		t.Fatalf("loaded probe = %+v", loaded.Tables[string(CleanupTableProbeResults)])
	}

	// defaults for unspecified tables remain present
	if loaded.Tables[string(CleanupTableDeadLetterEvents)].Mode != "days" {
		t.Fatalf("default dead letter = %+v", loaded.Tables[string(CleanupTableDeadLetterEvents)])
	}
}

func TestCleanupDayPresetsIncludeRequestedValues(t *testing.T) {
	want := map[int]bool{366: true, 180: true, 90: true, 30: true, 17: true, 7: true, 3: true}
	for _, days := range cleanupDayPresets {
		delete(want, days)
	}
	if len(want) != 0 {
		t.Fatalf("missing presets: %v", want)
	}
}
