package charitable

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/store"
)

func openTestDB(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "charitable.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestCharitableStoreCRUD(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	// Create channel
	ch := &Channel{ChannelName: "test-channel", Description: "test description", Param: `{"key":"value"}`, URL: "https://example.com"}
	if err := s.CreateChannel(ctx, ch); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if ch.ChannelID == 0 {
		t.Fatalf("expected channel ID")
	}

	// Get channel
	got, err := s.GetChannel(ctx, ch.ChannelID)
	if err != nil {
		t.Fatalf("get channel: %v", err)
	}
	if got.ChannelName != "test-channel" || got.Description != "test description" {
		t.Fatalf("channel = %+v", got)
	}

	// Update channel
	ch.ChannelName = "updated-channel"
	if err := s.UpdateChannel(ctx, ch.ChannelID, ch); err != nil {
		t.Fatalf("update channel: %v", err)
	}
	got, _ = s.GetChannel(ctx, ch.ChannelID)
	if got.ChannelName != "updated-channel" {
		t.Fatalf("updated name = %q", got.ChannelName)
	}

	// Delete channel (soft delete: status → -1)
	if err := s.DeleteChannel(ctx, ch.ChannelID); err != nil {
		t.Fatalf("delete channel: %v", err)
	}
	// GetChannel still returns the row (no status filter), but ListChannels excludes it
	got, _ = s.GetChannel(ctx, ch.ChannelID)
	if got.Status != -1 {
		t.Fatalf("status = %d, want -1 after soft delete", got.Status)
	}
	result, _ := s.ListChannels(ctx, ListParams{})
	if result.TotalItems != 3 {
		t.Fatalf("total = %d, want 3 preset channels after soft delete", result.TotalItems)
	}

	// Create provider
	pv := &Provider{ProviderName: "test-provider", Description: "test provider", ChannelID: &ch.ChannelID, BaseURL: "https://api.test", Param: `{}`}
	if err := s.CreateProvider(ctx, pv); err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if pv.ProviderID == 0 {
		t.Fatalf("expected provider ID")
	}

	// Create key
	expiresAtMS := int64(1798761600000)
	key := &APIKey{APIKey: "sk-test-key-123", APIType: 2, Status: 1, Priority: 0, ExpiresAtMS: &expiresAtMS, ProbePolicy: `{"renewExpiryOnSuccess":true}`, Param: `{}`, ProviderID: &pv.ProviderID}
	if err := s.CreateKey(ctx, key); err != nil {
		t.Fatalf("create key: %v", err)
	}
	if key.ID == 0 {
		t.Fatalf("expected key ID")
	}

	// Get key
	gotKey, err := s.GetKey(ctx, key.ID)
	if err != nil {
		t.Fatalf("get key: %v", err)
	}
	if gotKey.APIKey != "sk-test-key-123" {
		t.Fatalf("key value = %q", gotKey.APIKey)
	}
	if gotKey.ExpiresAtMS == nil || *gotKey.ExpiresAtMS != expiresAtMS || gotKey.ProbePolicy != key.ProbePolicy {
		t.Fatalf("strategy fields = %+v", gotKey)
	}

	// Update key param
	if err := s.UpdateKeyParam(ctx, key.ID, `{"model":"gpt-4"}`); err != nil {
		t.Fatalf("update key param: %v", err)
	}
	gotKey, _ = s.GetKey(ctx, key.ID)
	if gotKey.Param != `{"model":"gpt-4"}` {
		t.Fatalf("key param = %q", gotKey.Param)
	}

	// Batch delete
	n, err := s.BatchDeleteKeys(ctx, []int64{key.ID})
	if err != nil {
		t.Fatalf("batch delete: %v", err)
	}
	if n != 1 {
		t.Fatalf("deleted = %d, want 1", n)
	}
	_, err = s.GetKey(ctx, key.ID)
	if err == nil {
		t.Fatalf("expected not found after batch delete")
	}
}

func TestCharitableStoreGetKeyFullParam(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	ch := &Channel{ChannelName: "ch", Param: `{"channel":"param"}`}
	if err := s.CreateChannel(ctx, ch); err != nil {
		t.Fatalf("create channel: %v", err)
	}

	pv := &Provider{ProviderName: "pv", ChannelID: &ch.ChannelID, BaseURL: "https://api.test", Param: `{"provider":"param"}`}
	if err := s.CreateProvider(ctx, pv); err != nil {
		t.Fatalf("create provider: %v", err)
	}

	key := &APIKey{APIKey: "sk-key", APIType: 2, Status: 1, Priority: 0, Param: `{"key":"param"}`, ProviderID: &pv.ProviderID}
	if err := s.CreateKey(ctx, key); err != nil {
		t.Fatalf("create key: %v", err)
	}

	merged, _, err := s.GetKeyFullParam(ctx, key.ID)
	if err != nil {
		t.Fatalf("full param: %v", err)
	}
	if merged["channel"] != "param" || merged["provider"] != "param" || merged["key"] != "param" {
		t.Fatalf("merged = %#v", merged)
	}
}

func TestCharitableStoreListPagination(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	for i := range 5 {
		ch := &Channel{ChannelName: "ch-" + string(rune('0'+i))}
		if err := s.CreateChannel(ctx, ch); err != nil {
			t.Fatalf("create channel %d: %v", i, err)
		}
	}

	result, err := s.ListChannels(ctx, ListParams{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if result.TotalItems != 8 || result.Page != 1 || result.PageSize != 2 || len(result.Items) != 2 {
		t.Fatalf("pagination = %#v", result)
	}
}

func TestCharitableStoreNotFound(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	if _, err := s.GetChannel(ctx, 999); err == nil {
		t.Fatalf("expected not found")
	}
	if _, err := s.GetProvider(ctx, 999); err == nil {
		t.Fatalf("expected not found")
	}
	if _, err := s.GetKey(ctx, 999); err == nil {
		t.Fatalf("expected not found")
	}
}

func TestCharitableStoreValidation(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	if err := s.CreateChannel(ctx, &Channel{ChannelName: "", Param: "{}"}); err != nil {
		t.Fatalf("expected success for empty name (validation is at handler level)")
	}
	if err := s.CreateProvider(ctx, &Provider{ProviderName: "", BaseURL: "bad", Param: "{}"}); err != nil {
		t.Fatalf("expected success for empty name (validation is at handler level)")
	}
	if err := s.CreateKey(ctx, &APIKey{APIKey: "short", APIType: 0, Param: "{}"}); err != nil {
		t.Fatalf("expected success for short key (validation is at handler level)")
	}
}

func TestCharitableStoreBatchToggleKeys(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	var ids []int64
	for i := range 3 {
		k := &APIKey{APIKey: "sk-key-" + string(rune('0'+i)), APIType: 2, Status: 1, Param: "{}"}
		if err := s.CreateKey(ctx, k); err != nil {
			t.Fatalf("create key %d: %v", i, err)
		}
		ids = append(ids, k.ID)
	}

	n, err := s.BatchToggleKeys(ctx, ids, 0)
	if err != nil {
		t.Fatalf("batch toggle: %v", err)
	}
	if n != 3 {
		t.Fatalf("updated = %d, want 3", n)
	}

	k, _ := s.GetKey(ctx, ids[0])
	if k.Status != 0 {
		t.Fatalf("status = %d, want 0", k.Status)
	}
}

func TestCharitableStoreListKeysWithFilters(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	pv := &Provider{ProviderName: "pv", BaseURL: "https://api.test", Param: "{}"}
	if err := s.CreateProvider(ctx, pv); err != nil {
		t.Fatalf("create provider: %v", err)
	}

	k1 := &APIKey{APIKey: "sk-alpha-1234567890", APIType: 2, Status: 1, Priority: 5, Param: "{}", ProviderID: &pv.ProviderID}
	k2 := &APIKey{APIKey: "sk-beta-1234567890", APIType: 3, Status: 0, Priority: 9, Param: "{}", ProviderID: &pv.ProviderID}
	if err := s.CreateKey(ctx, k1); err != nil {
		t.Fatalf("create key 1: %v", err)
	}
	if err := s.CreateKey(ctx, k2); err != nil {
		t.Fatalf("create key 2: %v", err)
	}

	// Filter by provider_id
	result, err := s.ListKeys(ctx, ListParams{ProviderID: &pv.ProviderID})
	if err != nil {
		t.Fatalf("list by provider: %v", err)
	}
	if result.TotalItems != 2 {
		t.Fatalf("total = %d, want 2", result.TotalItems)
	}

	// Filter by status
	status0 := 0
	result, err = s.ListKeys(ctx, ListParams{Status: &status0})
	if err != nil {
		t.Fatalf("list by status: %v", err)
	}
	if result.TotalItems != 1 {
		t.Fatalf("total = %d, want 1", result.TotalItems)
	}
	if result.Items[0].APIKey != "sk-beta-1234567890" {
		t.Fatalf("key = %q", result.Items[0].APIKey)
	}

	// Filter by priority
	priority9 := 9
	result, err = s.ListKeys(ctx, ListParams{Priority: &priority9})
	if err != nil {
		t.Fatalf("list by priority: %v", err)
	}
	if result.TotalItems != 1 {
		t.Fatalf("total = %d, want 1", result.TotalItems)
	}
	if result.Items[0].APIKey != "sk-beta-1234567890" {
		t.Fatalf("key = %q", result.Items[0].APIKey)
	}

	// Filter by api_type (modulus)
	apiType2 := 2
	result, err = s.ListKeys(ctx, ListParams{APIType: &apiType2})
	if err != nil {
		t.Fatalf("list by api_type: %v", err)
	}
	if result.TotalItems != 1 {
		t.Fatalf("total = %d, want 1", result.TotalItems)
	}
	if result.Items[0].APIKey != "sk-alpha-1234567890" {
		t.Fatalf("key = %q", result.Items[0].APIKey)
	}

	// Filter by search
	result, err = s.ListKeys(ctx, ListParams{Search: "alpha"})
	if err != nil {
		t.Fatalf("list by search: %v", err)
	}
	if result.TotalItems != 1 {
		t.Fatalf("total = %d, want 1", result.TotalItems)
	}

	// Filter by multiple provider_ids
	pv2 := &Provider{ProviderName: "pv-cache", BaseURL: "https://cache.test", Param: "{}"}
	if err := s.CreateProvider(ctx, pv2); err != nil {
		t.Fatalf("create provider 2: %v", err)
	}
	k3 := &APIKey{APIKey: "sk-cache-1234567890", APIType: 2, Status: 1, Priority: 1, Param: "{}", ProviderID: &pv2.ProviderID}
	if err := s.CreateKey(ctx, k3); err != nil {
		t.Fatalf("create key 3: %v", err)
	}
	result, err = s.ListKeys(ctx, ListParams{ProviderIDs: []int64{pv.ProviderID, pv2.ProviderID}})
	if err != nil {
		t.Fatalf("list by provider_ids: %v", err)
	}
	if result.TotalItems != 3 {
		t.Fatalf("total = %d, want 3", result.TotalItems)
	}
}

func TestCharitableStoreListKeysWithStatusDomain(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	for _, item := range []struct {
		key    string
		status int
	}{
		{key: "sk-valid-domain-1234567890", status: 200},
		{key: "sk-unknown-domain-1234567890", status: 0},
		{key: "sk-invalid-domain-1234567890", status: -401},
		{key: "sk-disabled-domain-1234567890", status: -2},
	} {
		key := &APIKey{APIKey: item.key, APIType: 2, Status: item.status, Param: "{}"}
		if err := s.CreateKey(ctx, key); err != nil {
			t.Fatalf("create key status %d: %v", item.status, err)
		}
	}

	for _, test := range []struct {
		domain string
		want   int64
	}{
		{domain: "valid", want: 1},
		{domain: "unknown", want: 1},
		{domain: "invalid", want: 2},
		{domain: "expired", want: 1},
		{domain: "disabled", want: 1},
	} {
		result, err := s.ListKeys(ctx, ListParams{StatusDomain: test.domain})
		if err != nil {
			t.Fatalf("list status domain %s: %v", test.domain, err)
		}
		if result.TotalItems != test.want {
			t.Fatalf("status domain %s total=%d, want %d", test.domain, result.TotalItems, test.want)
		}
	}
}

func TestCharitableStoreListKeyStatusCounts(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	provider := &Provider{ProviderName: "status-count-pv", BaseURL: "https://status-count.test", Param: "{}"}
	if err := s.CreateProvider(ctx, provider); err != nil {
		t.Fatalf("create provider: %v", err)
	}
	other := &Provider{ProviderName: "status-count-other", BaseURL: "https://status-count-other.test", Param: "{}"}
	if err := s.CreateProvider(ctx, other); err != nil {
		t.Fatalf("create other provider: %v", err)
	}

	for _, item := range []struct {
		key        string
		status     int
		providerID *int64
	}{
		{key: "sk-status-count-200", status: 200, providerID: &provider.ProviderID},
		{key: "sk-status-count-200b", status: 200, providerID: &provider.ProviderID},
		{key: "sk-status-count-0", status: 0, providerID: &provider.ProviderID},
		{key: "sk-status-count-401", status: -401, providerID: &provider.ProviderID},
		{key: "sk-status-count-other", status: 200, providerID: &other.ProviderID},
	} {
		key := &APIKey{APIKey: item.key, APIType: 2, Status: item.status, Param: "{}", ProviderID: item.providerID}
		if err := s.CreateKey(ctx, key); err != nil {
			t.Fatalf("create key %s: %v", item.key, err)
		}
	}

	items, err := s.ListKeyStatusCounts(ctx, ListParams{ProviderID: &provider.ProviderID, StatusDomain: "valid"})
	if err != nil {
		t.Fatalf("list status counts: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("status count rows = %d, want 3: %+v", len(items), items)
	}
	got := map[int]int64{}
	for _, item := range items {
		got[item.Status] = item.Count
	}
	if got[200] != 2 || got[0] != 1 || got[-401] != 1 {
		t.Fatalf("unexpected status counts: %+v", got)
	}
}

func TestCharitableStoreGetKeyByFileName(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	first := &APIKey{
		AuthType:  3,
		AuthValue: `{"type":"codex","access_token":"old"}`,
		AuthInfo:  `{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":[],"file_name":"alice.codex.json"}`,
		Status:    1,
		Param:     "{}",
		AuthIndex: "auth-alice-old",
	}
	if err := s.CreateKey(ctx, first); err != nil {
		t.Fatalf("create first: %v", err)
	}

	// Later row with same file_name should win by update_at/id.
	second := &APIKey{
		AuthType:  3,
		AuthValue: `{"type":"codex","access_token":"new"}`,
		AuthInfo:  `{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":[],"file_name":"Alice.Codex.json"}`,
		Status:    1,
		Param:     "{}",
		AuthIndex: "auth-alice-new",
	}
	if err := s.CreateKey(ctx, second); err != nil {
		t.Fatalf("create second: %v", err)
	}

	got, err := s.GetKeyByFileName(ctx, "alice.codex.json")
	if err != nil {
		t.Fatalf("get by file name: %v", err)
	}
	if got.AuthIndex != "auth-alice-new" {
		t.Fatalf("auth_index=%s, want auth-alice-new", got.AuthIndex)
	}

	if _, err := s.GetKeyByFileName(ctx, "missing.json"); err == nil || err.Error() != "key_not_found" {
		t.Fatalf("missing file err=%v, want key_not_found", err)
	}
}

func TestCharitableStoreListKeysWithCredentialKind(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	apiKey := &APIKey{
		APIKey:  "sk-api-key-filter-1234567890",
		APIType: 2,
		Status:  1,
		Param:   "{}",
	}
	if err := s.CreateKey(ctx, apiKey); err != nil {
		t.Fatalf("create api key: %v", err)
	}

	oauth := &APIKey{
		AuthType:  3,
		AuthValue: `{"type":"codex","access_token":"tok","disabled":false}`,
		AuthInfo:  `{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":[],"file_name":"codex-main.json"}`,
		Status:    1,
		Param:     "{}",
		AuthIndex: "codex-main",
	}
	if err := s.CreateKey(ctx, oauth); err != nil {
		t.Fatalf("create auth-file key: %v", err)
	}

	// API Key with file_name should still count as auth-file for filtering parity with UI.
	namedAPI := &APIKey{
		APIKey:   "sk-named-file-1234567890",
		APIType:  2,
		Status:   1,
		Param:    "{}",
		AuthInfo: `{"schema_version":1,"credential_type":"api_key","api_type":2,"protocols":[],"file_name":"named-api.json"}`,
	}
	if err := s.CreateKey(ctx, namedAPI); err != nil {
		t.Fatalf("create named api key: %v", err)
	}

	authFiles, err := s.ListKeys(ctx, ListParams{CredentialKind: "auth_file"})
	if err != nil {
		t.Fatalf("list auth_file: %v", err)
	}
	if authFiles.TotalItems != 2 {
		t.Fatalf("auth_file total=%d, want 2", authFiles.TotalItems)
	}

	apiKeys, err := s.ListKeys(ctx, ListParams{CredentialKind: "api_key"})
	if err != nil {
		t.Fatalf("list api_key: %v", err)
	}
	if apiKeys.TotalItems != 1 {
		t.Fatalf("api_key total=%d, want 1", apiKeys.TotalItems)
	}

	// Search still works together with credential_kind.
	search, err := s.ListKeys(ctx, ListParams{CredentialKind: "auth_file", Search: "codex-main"})
	if err != nil {
		t.Fatalf("list auth_file search: %v", err)
	}
	if search.TotalItems != 1 {
		t.Fatalf("auth_file search total=%d, want 1", search.TotalItems)
	}
}

func TestCharitableStoreListChannelsWithSearch(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	s.CreateChannel(ctx, &Channel{ChannelName: "alpha-channel"})
	s.CreateChannel(ctx, &Channel{ChannelName: "beta-channel"})
	s.CreateChannel(ctx, &Channel{ChannelName: "alpha-relay"})

	result, err := s.ListChannels(ctx, ListParams{Search: "alpha"})
	if err != nil {
		t.Fatalf("list with search: %v", err)
	}
	if result.TotalItems != 2 {
		t.Fatalf("total = %d, want 2", result.TotalItems)
	}
}

func TestCharitableStoreChannelStatusFilterAndUpdate(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	channel := &Channel{ChannelName: "status-channel", Status: 0, Param: "{}"}
	if err := s.CreateChannelWithStatus(ctx, channel); err != nil {
		t.Fatalf("create: %v", err)
	}
	status := 0
	result, err := s.ListChannels(ctx, ListParams{Status: &status})
	if err != nil || result.TotalItems != 1 {
		t.Fatalf("filter status: result=%#v err=%v", result, err)
	}
	channel.Status = -2
	if err := s.UpdateChannel(ctx, channel.ChannelID, channel); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := s.GetChannel(ctx, channel.ChannelID)
	if err != nil || got.Status != -2 {
		t.Fatalf("updated status = %d, err=%v", got.Status, err)
	}
}

func TestCharitableStoreListProvidersWithChannelFilter(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	ch1 := &Channel{ChannelName: "ch1"}
	ch2 := &Channel{ChannelName: "ch2"}
	s.CreateChannel(ctx, ch1)
	s.CreateChannel(ctx, ch2)

	s.CreateProvider(ctx, &Provider{ProviderName: "pv1", ChannelID: &ch1.ChannelID, BaseURL: "https://a.test", Param: "{}"})
	s.CreateProvider(ctx, &Provider{ProviderName: "pv2", ChannelID: &ch2.ChannelID, BaseURL: "https://b.test", Param: "{}"})

	result, err := s.ListProviders(ctx, ListParams{ChannelID: &ch1.ChannelID})
	if err != nil {
		t.Fatalf("list by channel: %v", err)
	}
	if result.TotalItems != 1 {
		t.Fatalf("total = %d, want 1", result.TotalItems)
	}
	if result.Items[0].ProviderName != "pv1" {
		t.Fatalf("provider = %q", result.Items[0].ProviderName)
	}
}

func TestCharitableStoreProviderBaseURLAndStatusFilters(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	provider := &Provider{ProviderName: "custom", Status: -2, BaseURL: "https://edge.example.com/v1", Param: "{}"}
	if err := s.CreateProviderWithStatus(ctx, provider); err != nil {
		t.Fatalf("create: %v", err)
	}
	status := -2
	result, err := s.ListProviders(ctx, ListParams{Status: &status, BaseURL: "edge.example"})
	if err != nil || result.TotalItems != 1 {
		t.Fatalf("filter provider: result=%#v err=%v", result, err)
	}
}

func TestCharitableStoreDeleteProviderSoftDelete(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	pv := &Provider{ProviderName: "pv", BaseURL: "https://api.test", Param: "{}"}
	if err := s.CreateProvider(ctx, pv); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.DeleteProvider(ctx, pv.ProviderID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// Should not be found (list filters status=1)
	result, _ := s.ListProviders(ctx, ListParams{})
	if result.TotalItems != 7 {
		t.Fatalf("total = %d, want 7 preset providers after soft delete", result.TotalItems)
	}
}

func TestCharitableStoreGetKeyFullParamNoProvider(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	key := &APIKey{APIKey: "sk-lone-key-1234567890", APIType: 2, Status: 1, Param: `{"solo":"value"}`}
	if err := s.CreateKey(ctx, key); err != nil {
		t.Fatalf("create key: %v", err)
	}

	merged, _, err := s.GetKeyFullParam(ctx, key.ID)
	if err != nil {
		t.Fatalf("full param: %v", err)
	}
	if merged["solo"] != "value" {
		t.Fatalf("merged = %#v", merged)
	}
	if len(merged) != 1 {
		t.Fatalf("merged len = %d, want 1", len(merged))
	}
}
