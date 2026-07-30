package charitable

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func openSyncTestDB(t *testing.T) *CharitableStore {
	t.Helper()
	srv, err := store.Open(filepath.Join(t.TempDir(), "charitable.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return NewCharitableStore(srv.DB())
}

func TestSyncServiceProvidersToKeysCreatesProviderWithModels(t *testing.T) {
	ctx := context.Background()
	s := openSyncTestDB(t)

	entries := []SyncEntry{
		{
			BaseURL:      "https://api.example.com",
			APIKey:       "sk-sync-key-1234567890",
			Protocols:    []string{"openai"},
			ProviderName: "Example Provider",
			Models: []SyncModel{
				{Name: "gpt-4.1", Alias: "GPT-4.1"},
				{Name: "gpt-5"},
			},
			TestModel: "gpt-4.1",
		},
	}

	result, err := s.SyncServiceProvidersToKeys(ctx, entries, false)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if result.Total != 1 || result.Synced != 1 || result.Skipped != 0 {
		t.Fatalf("unexpected result %+v", result)
	}

	pv, err := s.findProviderByBaseURL(ctx, "https://api.example.com", 0)
	if err != nil {
		t.Fatalf("find provider: %v", err)
	}
	if pv == nil {
		t.Fatalf("expected provider to be created")
	}
	if pv.ProviderName != "Example Provider" {
		t.Fatalf("provider name = %q", pv.ProviderName)
	}

	var param map[string]any
	if err := json.Unmarshal([]byte(pv.Param), &param); err != nil {
		t.Fatalf("unmarshal param: %v", err)
	}
	models, ok := param["models"].([]any)
	if !ok || len(models) != 2 {
		t.Fatalf("expected 2 models, got %v", param["models"])
	}
	if tm, _ := param["test_model"].(string); tm != "gpt-4.1" {
		t.Fatalf("expected test_model gpt-4.1, got %v", param["test_model"])
	}
}

func TestSyncServiceProvidersToKeysBackfillsModelsOnExistingProvider(t *testing.T) {
	ctx := context.Background()
	s := openSyncTestDB(t)

	// First call uses no models.
	_, err := s.SyncServiceProvidersToKeys(ctx, []SyncEntry{{
		BaseURL: "https://api.example.com",
		APIKey:  "sk-sync-key-1234567890",
	}}, false)
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}

	pv, err := s.findProviderByBaseURL(ctx, "https://api.example.com", 0)
	if err != nil || pv == nil {
		t.Fatalf("find provider: %v err=%v", pv, err)
	}
	if providerHasModels(pv.Param) {
		t.Fatalf("provider should not have models after first sync")
	}

	// Second call now supplies models for the same key (duplicate so 0 new, but backfill provider).
	result, err := s.SyncServiceProvidersToKeys(ctx, []SyncEntry{{
		BaseURL: "https://api.example.com",
		APIKey:  "sk-sync-key-1234567890",
		Models: []SyncModel{
			{Name: "gpt-4o", Alias: "GPT-4o"},
		},
		TestModel: "gpt-4o",
	}}, false)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if result.Synced != 0 || result.UpdatedKeys != 1 || result.Updated != 1 {
		t.Fatalf("expected synced=0 updated_keys=1 updated=1, got %+v", result)
	}

	// Re-fetch the provider after the update.
	pv, err = s.findProviderByBaseURL(ctx, "https://api.example.com", 0)
	if err != nil || pv == nil {
		t.Fatalf("find provider after update: %v err=%v", pv, err)
	}
	if !providerHasModels(pv.Param) {
		t.Fatalf("expected models to be backfilled, param=%q", pv.Param)
	}
	var param map[string]any
	if err := json.Unmarshal([]byte(pv.Param), &param); err != nil {
		t.Fatalf("unmarshal param: %v", err)
	}
	var tm string
	if v, _ := param["test_model"].(string); v != "" {
		tm = v
	}
	if tm != "gpt-4o" {
		t.Fatalf("expected test_model=gpt-4o, got %q", tm)
	}
}

func TestSyncServiceProvidersToKeysDoesNotOverwriteModelsWhenNotForced(t *testing.T) {
	ctx := context.Background()
	s := openSyncTestDB(t)

	// First sync provides models.
	_, err := s.SyncServiceProvidersToKeys(ctx, []SyncEntry{{
		BaseURL: "https://api.example.com",
		APIKey:  "sk-sync-key-1234567890",
		Models: []SyncModel{
			{Name: "gpt-4.1"},
		},
		TestModel: "gpt-4.1",
	}}, false)
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}

	// Second sync supplies different models without forcing.
	_, err = s.SyncServiceProvidersToKeys(ctx, []SyncEntry{{
		BaseURL: "https://api.example.com",
		APIKey:  "sk-sync-key-1234567890",
		Models: []SyncModel{
			{Name: "claude-3-opus"},
		},
		TestModel: "claude-3-opus",
	}}, false)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}

	pv, err := s.findProviderByBaseURL(ctx, "https://api.example.com", 0)
	if err != nil || pv == nil {
		t.Fatalf("find provider: %v err=%v", pv, err)
	}
	var param map[string]any
	if err := json.Unmarshal([]byte(pv.Param), &param); err != nil {
		t.Fatalf("unmarshal param: %v", err)
	}
	models, _ := param["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("expected 1 model, got %v", models)
	}
	first, _ := models[0].(map[string]any)
	if first["name"] != "gpt-4.1" {
		t.Fatalf("expected gpt-4.1 preserved, got %v", first["name"])
	}
}

func TestSyncServiceProvidersToKeysOverwritesDuplicateKey(t *testing.T) {
	ctx := context.Background()
	s := openSyncTestDB(t)

	first := []SyncEntry{{
		BaseURL:      "https://old.example.com",
		APIKey:       "sk-shared-key-1234567890",
		ProviderName: "Old Provider",
		Protocols:    []string{"anthropic"},
	}}
	if _, err := s.SyncServiceProvidersToKeys(ctx, first, true); err != nil {
		t.Fatalf("initial sync: %v", err)
	}

	second := []SyncEntry{{
		BaseURL:      "https://new.example.com",
		APIKey:       "sk-shared-key-1234567890",
		ProviderName: "New Provider",
		Protocols:    []string{"openai"},
	}}
	result, err := s.SyncServiceProvidersToKeys(ctx, second, true)
	if err != nil {
		t.Fatalf("overwrite sync: %v", err)
	}
	if result.Synced != 0 || result.UpdatedKeys != 1 || result.Skipped != 0 {
		t.Fatalf("unexpected overwrite result: %+v", result)
	}

	var providerName, baseURL, authInfo string
	var status int
	if err := s.db.QueryRowContext(ctx, `
		SELECT p.provider_name, p.base_url, k.auth_info, k.status
		FROM cpa_auth_detail k
		JOIN cpa_provider_info p ON p.provider_id = k.provider_id
		WHERE k.auth_index = ?`, mustAuthIndex(t, "sk-shared-key-1234567890")).Scan(
		&providerName, &baseURL, &authInfo, &status,
	); err != nil {
		t.Fatalf("query overwritten key: %v", err)
	}
	if providerName != "New Provider" || baseURL != "https://new.example.com" || status != 1 {
		t.Fatalf("duplicate key was not overwritten: provider=%q base=%q status=%d", providerName, baseURL, status)
	}
	var info map[string]any
	if err := json.Unmarshal([]byte(authInfo), &info); err != nil {
		t.Fatalf("decode auth_info: %v", err)
	}
	if info["api_type"] != float64(2) {
		t.Fatalf("expected overwritten openai api_type, got %#v", info["api_type"])
	}
}

func mustAuthIndex(t *testing.T, value string) string {
	t.Helper()
	index, err := BuildAuthIndex(value, "")
	if err != nil {
		t.Fatalf("build auth index: %v", err)
	}
	return index
}
