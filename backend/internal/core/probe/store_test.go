package probe

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/store"
)

func newProbeStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "probe.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ps := NewStore(db.DB())
	if err := ps.EnsureSchema(context.Background()); err != nil {
		t.Fatalf("ensure probe schema: %v", err)
	}
	return ps
}

func TestConfigRoundTrip(t *testing.T) {
	ps := newProbeStore(t)
	ctx := context.Background()

	cfg, err := ps.LoadConfig(ctx)
	if err != nil {
		t.Fatalf("load default config: %v", err)
	}
	if cfg.Enabled {
		t.Fatalf("default config should be disabled")
	}

	next := DefaultConfig()
	next.Enabled = true
	next.WindowSeconds = 1800
	next.FailureThreshold = 5
	if err := ps.SaveConfig(ctx, next); err != nil {
		t.Fatalf("save config: %v", err)
	}

	loaded, err := ps.LoadConfig(ctx)
	if err != nil {
		t.Fatalf("reload config: %v", err)
	}
	if !loaded.Enabled || loaded.WindowSeconds != 1800 || loaded.FailureThreshold != 5 {
		t.Fatalf("unexpected config: %+v", loaded)
	}
}

func TestInsertAndConsecutive(t *testing.T) {
	ps := newProbeStore(t)
	ctx := context.Background()

	now := time.Now().UnixMilli()
	insert := func(hash string, success bool, offset int64) {
		ts := now - offset
		r := Result{
			EventHash:   hash,
			TimestampMS: ts,
			AuthIndex:   "auth-1",
			Success:     success,
			Failed:      !success,
			CreatedAtMS: ts,
		}
		ok, err := ps.InsertResult(ctx, r)
		if err != nil {
			t.Fatalf("insert %s: %v", hash, err)
		}
		if !ok {
			t.Fatalf("insert %s reported skipped", hash)
		}
	}

	insert("h1", false, 4_000)
	insert("h2", false, 3_000)
	insert("h3", true, 2_000)
	insert("h4", true, 1_000)

	fails, err := ps.CountConsecutive(ctx, "auth-1", false)
	if err != nil {
		t.Fatalf("count fails: %v", err)
	}
	if fails != 0 {
		t.Fatalf("expected 0 consecutive fails, got %d", fails)
	}
	oks, err := ps.CountConsecutive(ctx, "auth-1", true)
	if err != nil {
		t.Fatalf("count oks: %v", err)
	}
	if oks != 2 {
		t.Fatalf("expected 2 consecutive oks, got %d", oks)
	}

	// Dedup by event_hash.
	if _, err := ps.InsertResult(ctx, Result{
		EventHash: "h4", TimestampMS: now - 1_000, AuthIndex: "auth-1", Success: true, CreatedAtMS: now - 1_000,
	}); err != nil {
		t.Fatalf("dup insert: %v", err)
	}
	stats, err := ps.ListKeyStats(ctx, 3600, "", 1, 20)
	if err != nil {
		t.Fatalf("list stats: %v", err)
	}
	if stats.TotalItems != 1 {
		t.Fatalf("expected 1 stat row, got %d", stats.TotalItems)
	}
	if stats.Items[0].TotalProbes != 4 {
		t.Fatalf("expected 4 probes, got %d", stats.Items[0].TotalProbes)
	}
}

func TestLatestSuccessfulAction(t *testing.T) {
	ps := newProbeStore(t)
	ctx := context.Background()

	if err := ps.InsertActionLog(ctx, ActionLog{
		CreatedAtMS: 1,
		AuthIndex:   "auth-1",
		Action:      "cpa_offline",
		Success:     true,
	}); err != nil {
		t.Fatalf("insert action: %v", err)
	}
	if err := ps.InsertActionLog(ctx, ActionLog{
		CreatedAtMS: 2,
		AuthIndex:   "auth-1",
		Action:      "cpa_online",
		Success:     false,
	}); err != nil {
		t.Fatalf("insert failed action: %v", err)
	}

	action, ok, err := ps.LatestSuccessfulAction(ctx, "auth-1")
	if err != nil {
		t.Fatalf("latest action: %v", err)
	}
	if !ok || action != "cpa_offline" {
		t.Fatalf("unexpected latest action: %q, %v", action, ok)
	}
}

func TestExpireDueKeysAndPolicyOverrides(t *testing.T) {
	ps := newProbeStore(t)
	ctx := context.Background()
	now := time.Now().UnixMilli()
	_, err := ps.db.ExecContext(ctx, `
		INSERT INTO cpa_auth_detail (
			auth_index, auth_type, auth_value, auth_info, status, priority,
			expires_at_ms, probe_policy, param
		) VALUES (?, 1, ?, '2', 1, 10, ?, ?, '{}')`,
		"expiring-auth",
		"sk-expiring-test",
		now-1,
		`{"priorityBoost":5,"autoCpaAccountEnabled":false}`,
	)
	if err != nil {
		t.Fatalf("insert expiring key: %v", err)
	}

	items, err := ps.ExpireDueKeys(ctx, now, 10)
	if err != nil {
		t.Fatalf("expire due keys: %v", err)
	}
	if len(items) != 1 || items[0].AuthIndex != "expiring-auth" {
		t.Fatalf("unexpected due keys: %+v", items)
	}

	policy := parseKeyPolicy(items[0].ProbePolicy)
	effective, enabled := policy.Apply(DefaultConfig())
	if !enabled || effective.PriorityBoost != 5 || effective.AutoCPAAccountEnabled {
		t.Fatalf("unexpected effective policy: %+v enabled=%v", effective, enabled)
	}
}

func TestDisabledKeyPolicy(t *testing.T) {
	disabled := false
	_, enabled := (KeyPolicy{Enabled: &disabled}).Apply(DefaultConfig())
	if enabled {
		t.Fatal("disabled key policy should exclude the account")
	}
}
