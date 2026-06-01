package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/usage"
)

func ptrInt64(value int64) *int64 {
	return &value
}

func TestProxyIndexIsUniqueBusinessKey(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "proxy-unique.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	_, err = store.DB().Exec(`
		INSERT INTO cpa_proxy_detail (proxy_index, proxy_type, proxy_value, proxy_info)
		VALUES ('proxy-business-key', 4, 'socks5://one.example.com:1080', 'socks')
	`)
	if err != nil {
		t.Fatalf("insert first proxy: %v", err)
	}
	_, err = store.DB().Exec(`
		INSERT INTO cpa_proxy_detail (proxy_index, proxy_type, proxy_value, proxy_info)
		VALUES ('proxy-business-key', 4, 'socks5://two.example.com:1080', 'socks')
	`)
	if err == nil {
		t.Fatal("expected duplicate proxy_index to violate unique index")
	}
}

func TestOpenRejectsLegacyDuplicateProxyIndexes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "duplicate-proxy.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE cpa_proxy_detail (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			proxy_index TEXT NOT NULL,
			proxy_type INTEGER DEFAULT 1,
			proxy_value TEXT NOT NULL,
			proxy_info TEXT NOT NULL,
			content TEXT,
			status INTEGER DEFAULT 0,
			priority INTEGER DEFAULT 0,
			param TEXT DEFAULT '{}',
			owner_id INTEGER,
			create_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			update_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			remark TEXT
		);
		INSERT INTO cpa_proxy_detail (proxy_index, proxy_value, proxy_info) VALUES
			('duplicate-index', 'socks5://one.example.com:1080', 'one'),
			('duplicate-index', 'socks5://two.example.com:1080', 'two');
	`)
	if err != nil {
		_ = db.Close()
		t.Fatalf("seed duplicate proxies: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close raw sqlite: %v", err)
	}

	opened, err := Open(path)
	if opened != nil {
		_ = opened.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "resolve duplicates") {
		t.Fatalf("open error = %v, want duplicate business key error", err)
	}
}

func TestStorePersistsAccountSnapshot(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:            "event-1",
			TimestampMS:          1_778_000_000_000,
			Timestamp:            "2026-05-06T00:00:00Z",
			Model:                "gpt-test",
			Endpoint:             "POST /v1/chat/completions",
			AuthIndex:            "auth-1",
			APIKeyHash:           "api-key-hash-1",
			AccountSnapshot:      "alice@example.com",
			AuthLabelSnapshot:    "Alice",
			AuthFileSnapshot:     "alice.json",
			AuthProviderSnapshot: "codex",
			AuthSnapshotAtMS:     1_778_000_000_100,
			CreatedAtMS:          1_778_000_000_200,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	events, err := db.RecentEvents(context.Background(), 10)
	if err != nil {
		t.Fatalf("recent events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1", len(events))
	}
	event := events[0]
	if event.AccountSnapshot != "alice@example.com" {
		t.Fatalf("AccountSnapshot = %q", event.AccountSnapshot)
	}
	if event.AuthLabelSnapshot != "Alice" {
		t.Fatalf("AuthLabelSnapshot = %q", event.AuthLabelSnapshot)
	}
	if event.AuthFileSnapshot != "alice.json" {
		t.Fatalf("AuthFileSnapshot = %q", event.AuthFileSnapshot)
	}
	if event.AuthProviderSnapshot != "codex" {
		t.Fatalf("AuthProviderSnapshot = %q", event.AuthProviderSnapshot)
	}
	if event.AuthSnapshotAtMS != 1_778_000_000_100 {
		t.Fatalf("AuthSnapshotAtMS = %d", event.AuthSnapshotAtMS)
	}
	if event.APIKeyHash != "api-key-hash-1" {
		t.Fatalf("APIKeyHash = %q", event.APIKeyHash)
	}

	payload := usage.BuildPayload(events)
	detail := payload.APIs["POST /v1/chat/completions"].Models["gpt-test"].Details[0]
	if detail.APIKeyHash != "api-key-hash-1" {
		t.Fatalf("payload APIKeyHash = %q", detail.APIKeyHash)
	}
	if detail.AccountSnapshot != "alice@example.com" {
		t.Fatalf("payload AccountSnapshot = %q", detail.AccountSnapshot)
	}
	if detail.AuthProviderSnapshot != "codex" {
		t.Fatalf("payload AuthProviderSnapshot = %q", detail.AuthProviderSnapshot)
	}
}

func TestStorePersistsRequestedAndResolvedModels(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:      "event-dual",
			TimestampMS:    1_778_000_001_000,
			Timestamp:      "2026-05-06T00:00:01Z",
			Model:          "gpt-5.4",
			RequestedModel: "gpt-5.4",
			ResolvedModel:  "gpt-5.5",
			Endpoint:       "POST /v1/chat/completions",
			CreatedAtMS:    1_778_000_001_100,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	events, err := db.RecentEvents(context.Background(), 10)
	if err != nil {
		t.Fatalf("recent events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1", len(events))
	}
	if events[0].RequestedModel != "gpt-5.4" {
		t.Fatalf("RequestedModel roundtrip = %q", events[0].RequestedModel)
	}
	if events[0].ResolvedModel != "gpt-5.5" {
		t.Fatalf("ResolvedModel roundtrip = %q", events[0].ResolvedModel)
	}

	payload := usage.BuildPayload(events)
	detail := payload.APIs["POST /v1/chat/completions"].Models["gpt-5.4"].Details[0]
	if detail.ResolvedModel != "gpt-5.5" {
		t.Fatalf("payload Detail.ResolvedModel = %q", detail.ResolvedModel)
	}
}

func TestStoreUsageSummaryAggregatesEventsWithoutDetails(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:            "summary-success",
			TimestampMS:          1_778_000_003_000,
			Timestamp:            "2026-05-06T00:00:03Z",
			Model:                "gpt-test",
			Endpoint:             "POST /v1/chat/completions",
			AuthIndex:            "auth-1",
			APIKeyHash:           hashA,
			AccountSnapshot:      "alice@example.com",
			AuthProviderSnapshot: "codex",
			InputTokens:          10,
			OutputTokens:         20,
			TotalTokens:          30,
			LatencyMS:            ptrInt64(123),
			RawJSON:              `{"large":"detail"}`,
			CreatedAtMS:          1_778_000_003_100,
		},
		{
			EventHash:            "summary-failure",
			TimestampMS:          1_778_000_004_000,
			Timestamp:            "2026-05-06T00:00:04Z",
			Model:                "gpt-test",
			Endpoint:             "POST /v1/chat/completions",
			AuthIndex:            "auth-2",
			APIKeyHash:           hashB,
			AccountSnapshot:      "bob@example.com",
			AuthProviderSnapshot: "gemini",
			InputTokens:          5,
			ReasoningTokens:      7,
			TotalTokens:          12,
			Failed:               true,
			CreatedAtMS:          1_778_000_004_100,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: hashA, Alias: "Team Alpha"},
	}, nil); err != nil {
		t.Fatalf("upsert api key alias: %v", err)
	}

	summary, err := db.UsageSummary(context.Background(), UsageSummaryFilter{})
	if err != nil {
		t.Fatalf("usage summary: %v", err)
	}
	if summary.TotalRequests != 2 || summary.SuccessCount != 1 || summary.FailureCount != 1 || summary.TotalTokens != 42 {
		t.Fatalf("summary totals = %#v", summary)
	}
	if summary.Tokens.InputTokens != 15 || summary.Tokens.OutputTokens != 20 || summary.Tokens.ReasoningTokens != 7 || summary.Tokens.TotalTokens != 42 {
		t.Fatalf("summary token totals = %#v", summary.Tokens)
	}
	if summary.LatencySumMS != 123 || summary.LatencyCount != 1 || summary.LatencyMS == nil || *summary.LatencyMS != 123 {
		t.Fatalf("summary latency = sum:%d count:%d avg:%v", summary.LatencySumMS, summary.LatencyCount, summary.LatencyMS)
	}
	if len(summary.APIs) != 0 {
		t.Fatalf("summary APIs len = %d, want no detail aggregates", len(summary.APIs))
	}
	if !stringSliceContains(summary.Facets.Providers, "codex") || !stringSliceContains(summary.Facets.Providers, "gemini") {
		t.Fatalf("summary provider facets = %#v", summary.Facets.Providers)
	}
	if !stringSliceContains(summary.Facets.Models, "gpt-test") {
		t.Fatalf("summary model facets = %#v", summary.Facets.Models)
	}
	if !stringSliceContains(summary.Facets.Channels, "codex") || !stringSliceContains(summary.Facets.Channels, "gemini") {
		t.Fatalf("summary channel facets = %#v", summary.Facets.Channels)
	}
	if !facetOptionsContain(summary.Facets.Accounts, "alice@example.com", "alice@example.com") ||
		!facetOptionsContain(summary.Facets.Accounts, "bob@example.com", "bob@example.com") {
		t.Fatalf("summary account facets = %#v", summary.Facets.Accounts)
	}
	if !facetOptionsContain(summary.Facets.APIKeys, hashA, "Team Alpha") ||
		!facetOptionsContain(summary.Facets.APIKeys, hashB, hashB) {
		t.Fatalf("summary api key facets = %#v", summary.Facets.APIKeys)
	}

	startMS := int64(1_778_000_004_000)
	filtered, err := db.UsageSummary(context.Background(), UsageSummaryFilter{StartMS: &startMS})
	if err != nil {
		t.Fatalf("filtered usage summary: %v", err)
	}
	if filtered.TotalRequests != 1 || filtered.SuccessCount != 0 || filtered.FailureCount != 1 || filtered.TotalTokens != 12 {
		t.Fatalf("filtered summary = %#v", filtered)
	}

	apiKeyFiltered, err := db.UsageSummary(context.Background(), UsageSummaryFilter{APIKeyHash: hashA, Status: "success", Search: "alice"})
	if err != nil {
		t.Fatalf("api key filtered usage summary: %v", err)
	}
	if apiKeyFiltered.TotalRequests != 1 || apiKeyFiltered.SuccessCount != 1 || apiKeyFiltered.FailureCount != 0 || apiKeyFiltered.TotalTokens != 30 {
		t.Fatalf("api key filtered summary = %#v", apiKeyFiltered)
	}
}

func TestStoreUsageSummaryFacetsIgnoreSelectedDimensionFilters(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:            "facet-filter-a",
			TimestampMS:          1_778_000_001_000,
			Timestamp:            "2026-05-06T00:00:01Z",
			Provider:             "codex",
			Model:                "gpt-a",
			Endpoint:             "POST /v1/chat/completions",
			Source:               "codex",
			AuthIndex:            "auth-a",
			APIKeyHash:           hashA,
			AccountSnapshot:      "alice@example.com",
			AuthProviderSnapshot: "codex",
			TotalTokens:          10,
		},
		{
			EventHash:            "facet-filter-b",
			TimestampMS:          1_778_000_002_000,
			Timestamp:            "2026-05-06T00:00:02Z",
			Provider:             "gemini",
			Model:                "gpt-b",
			Endpoint:             "POST /v1/chat/completions",
			Source:               "gemini",
			AuthIndex:            "auth-b",
			APIKeyHash:           hashB,
			AccountSnapshot:      "bob@example.com",
			AuthProviderSnapshot: "gemini",
			TotalTokens:          20,
			Failed:               true,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	summary, err := db.UsageSummary(context.Background(), UsageSummaryFilter{
		Account:    "alice@example.com",
		Provider:   "codex",
		Model:      "gpt-a",
		Channel:    "codex",
		APIKeyHash: hashA,
		Status:     "success",
	})
	if err != nil {
		t.Fatalf("filtered usage summary: %v", err)
	}
	if summary.TotalRequests != 1 || summary.TotalTokens != 10 {
		t.Fatalf("filtered summary totals = %#v", summary)
	}
	if !stringSliceContains(summary.Facets.Providers, "codex") || !stringSliceContains(summary.Facets.Providers, "gemini") {
		t.Fatalf("provider facets = %#v, want selected and unselected providers", summary.Facets.Providers)
	}
	if !stringSliceContains(summary.Facets.Models, "gpt-a") || !stringSliceContains(summary.Facets.Models, "gpt-b") {
		t.Fatalf("model facets = %#v, want selected and unselected models", summary.Facets.Models)
	}
	if !stringSliceContains(summary.Facets.Channels, "codex") || !stringSliceContains(summary.Facets.Channels, "gemini") {
		t.Fatalf("channel facets = %#v, want selected and unselected channels", summary.Facets.Channels)
	}
	if !facetOptionsContain(summary.Facets.Accounts, "alice@example.com", "alice@example.com") ||
		!facetOptionsContain(summary.Facets.Accounts, "bob@example.com", "bob@example.com") {
		t.Fatalf("account facets = %#v, want selected and unselected accounts", summary.Facets.Accounts)
	}
	if !facetOptionsContain(summary.Facets.APIKeys, hashA, hashA) ||
		!facetOptionsContain(summary.Facets.APIKeys, hashB, hashB) {
		t.Fatalf("api key facets = %#v, want selected and unselected keys", summary.Facets.APIKeys)
	}
}

func TestStoreUsageSearchUsesFTSAndAPIKeyAlias(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:       "search-alias-a",
			TimestampMS:     1_778_000_001_000,
			Timestamp:       "2026-05-06T00:00:01Z",
			Model:           "gpt-test",
			Endpoint:        "POST /v1/chat/completions",
			APIKeyHash:      hashA,
			AccountSnapshot: "alice@example.com",
			TotalTokens:     10,
		},
		{
			EventHash:       "search-alias-b",
			TimestampMS:     1_778_000_002_000,
			Timestamp:       "2026-05-06T00:00:02Z",
			Model:           "gemini-test",
			Endpoint:        "POST /v1/chat/completions",
			APIKeyHash:      hashB,
			AccountSnapshot: "bob@example.com",
			TotalTokens:     20,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: hashA, Alias: "KongWenpeng"},
	}, nil); err != nil {
		t.Fatalf("upsert alias: %v", err)
	}

	summary, err := db.UsageSummary(context.Background(), UsageSummaryFilter{
		Search:           "KongWenpeng",
		SearchAPIKeyHash: strings.Repeat("f", 64),
	})
	if err != nil {
		t.Fatalf("alias search summary: %v", err)
	}
	if summary.TotalRequests != 1 || summary.TotalTokens != 10 {
		t.Fatalf("alias search summary = %#v", summary)
	}

	summary, err = db.UsageSummary(context.Background(), UsageSummaryFilter{
		Search: "gemini-test",
	})
	if err != nil {
		t.Fatalf("model search summary: %v", err)
	}
	if summary.TotalRequests != 1 || summary.TotalTokens != 20 {
		t.Fatalf("model search summary = %#v", summary)
	}

	summary, err = db.UsageSummary(context.Background(), UsageSummaryFilter{
		Search: "gem",
	})
	if err != nil {
		t.Fatalf("model prefix search summary: %v", err)
	}
	if summary.TotalRequests != 1 || summary.TotalTokens != 20 {
		t.Fatalf("model prefix search summary = %#v", summary)
	}

	summary, err = db.UsageSummary(context.Background(), UsageSummaryFilter{
		Search: "Kong",
	})
	if err != nil {
		t.Fatalf("alias prefix search summary: %v", err)
	}
	if summary.TotalRequests != 1 || summary.TotalTokens != 10 {
		t.Fatalf("alias prefix search summary = %#v", summary)
	}
}

func TestBuildFTSQueryUsesPrefixTokens(t *testing.T) {
	if got := buildFTSQuery(`co code "codex"`); got != `"co"* AND "code"* AND "codex"*` {
		t.Fatalf("fts query = %q", got)
	}
}

func TestStoreUsageBreakdownPagePaginatesAccountGroups(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:       "account-page-alice",
			TimestampMS:     1_778_000_001_000,
			Timestamp:       "2026-05-06T00:00:01Z",
			Model:           "gpt-test",
			Endpoint:        "POST /v1/chat/completions",
			AuthIndex:       "auth-alice",
			AccountSnapshot: "alice@example.com",
			TotalTokens:     10,
		},
		{
			EventHash:       "account-page-bob",
			TimestampMS:     1_778_000_003_000,
			Timestamp:       "2026-05-06T00:00:03Z",
			Model:           "gpt-test",
			Endpoint:        "POST /v1/chat/completions",
			AuthIndex:       "auth-bob",
			AccountSnapshot: "bob@example.com",
			TotalTokens:     30,
		},
		{
			EventHash:       "account-page-carol",
			TimestampMS:     1_778_000_002_000,
			Timestamp:       "2026-05-06T00:00:02Z",
			Model:           "gpt-test",
			Endpoint:        "POST /v1/chat/completions",
			AuthIndex:       "auth-carol",
			AccountSnapshot: "carol@example.com",
			TotalTokens:     20,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	page, err := db.UsageBreakdownPage(context.Background(), UsageBreakdownAccounts, UsageSummaryFilter{}, UsagePageFilter{
		Page:     2,
		PageSize: 1,
	})
	if err != nil {
		t.Fatalf("usage account page: %v", err)
	}
	if page.TotalItems != 3 || page.Page != 2 || page.PageSize != 1 {
		t.Fatalf("pagination = %#v", page)
	}
	if details := collectTestDetails(page.Usage); len(details) != 0 {
		t.Fatalf("account page usage details len = %d, want direct items only", len(details))
	}
	items, ok := page.Items.([]UsageBreakdownPageItem)
	if !ok || len(items) != 1 || items[0].Account != "carol@example.com" || len(items[0].Models) != 1 {
		t.Fatalf("account page items = %#v, want direct carol item", page.Items)
	}
}

func TestStoreUsageBreakdownPageHandlesLargerAccountDataset(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	events := make([]usage.Event, 0, 120)
	for i := range 120 {
		events = append(events, usage.Event{
			EventHash:       fmt.Sprintf("large-account-page-%03d", i),
			TimestampMS:     1_778_000_000_000 + int64(i),
			Timestamp:       time.UnixMilli(1_778_000_000_000 + int64(i)).UTC().Format(time.RFC3339Nano),
			Model:           "gpt-test",
			Endpoint:        "POST /v1/chat/completions",
			AuthIndex:       fmt.Sprintf("auth-%03d", i),
			AccountSnapshot: fmt.Sprintf("account-%03d@example.com", i),
			TotalTokens:     int64(i + 1),
		})
	}
	if _, err := db.InsertEvents(context.Background(), events); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	page, err := db.UsageBreakdownPage(context.Background(), UsageBreakdownAccounts, UsageSummaryFilter{}, UsagePageFilter{
		Page:     5,
		PageSize: 20,
	})
	if err != nil {
		t.Fatalf("usage large account page: %v", err)
	}
	if page.TotalItems != 120 || page.Page != 5 || page.PageSize != 20 {
		t.Fatalf("pagination = %#v", page)
	}
	if details := collectTestDetails(page.Usage); len(details) != 0 {
		t.Fatalf("usage details len = %d, want direct items only", len(details))
	}
}

func TestNormalizeUsagePageFilterCapsPageSize(t *testing.T) {
	page, pageSize := normalizeUsagePageFilter(UsagePageFilter{
		Page:     0,
		PageSize: MaxUsagePageSize + 1,
	})
	if page != 1 || pageSize != MaxUsagePageSize {
		t.Fatalf("normalize page = %d, pageSize = %d", page, pageSize)
	}
}

func TestNormalizeUsageSortKeyUsesWhitelist(t *testing.T) {
	if got := normalizeUsageSortKey("totalTokens"); got != "totalTokens" {
		t.Fatalf("valid sort key = %q", got)
	}
	if got := normalizeUsageSortKey("timestamp_ms desc"); got != defaultUsageSortKey {
		t.Fatalf("invalid sort key = %q, want %q", got, defaultUsageSortKey)
	}
}

func TestStoreUsageBreakdownPageSortsAccountGroupsByTotalCost(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	if err := db.SaveModelPrices(context.Background(), map[string]ModelPrice{
		"expensive-model": {Prompt: 100},
		"cheap-model":     {Prompt: 1},
	}); err != nil {
		t.Fatalf("save model prices: %v", err)
	}
	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:       "cost-sort-expensive",
			TimestampMS:     1_778_000_001_000,
			Timestamp:       "2026-05-06T00:00:01Z",
			Model:           "expensive-model",
			Endpoint:        "POST /v1/chat/completions",
			AccountSnapshot: "high-cost@example.com",
			InputTokens:     10,
			TotalTokens:     10,
		},
		{
			EventHash:       "cost-sort-cheap",
			TimestampMS:     1_778_000_002_000,
			Timestamp:       "2026-05-06T00:00:02Z",
			Model:           "cheap-model",
			Endpoint:        "POST /v1/chat/completions",
			AccountSnapshot: "high-token@example.com",
			InputTokens:     100,
			TotalTokens:     100,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	page, err := db.UsageBreakdownPage(context.Background(), UsageBreakdownAccounts, UsageSummaryFilter{}, UsagePageFilter{
		Page:          1,
		PageSize:      1,
		SortKey:       "totalCost",
		SortDirection: "desc",
	})
	if err != nil {
		t.Fatalf("usage account cost page: %v", err)
	}
	if details := collectTestDetails(page.Usage); len(details) != 0 {
		t.Fatalf("usage details len = %d, want direct items only", len(details))
	}
	items, ok := page.Items.([]UsageBreakdownPageItem)
	if !ok || len(items) != 1 || items[0].Account != "high-cost@example.com" {
		t.Fatalf("cost sorted items = %#v, want high-cost account first", page.Items)
	}
}

func TestStoreUsageBreakdownPagePaginatesApiKeyGroups(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:   "api-key-page-a",
			TimestampMS: 1_778_000_001_000,
			Timestamp:   "2026-05-06T00:00:01Z",
			Model:       "gpt-test",
			Endpoint:    "POST /v1/chat/completions",
			APIKeyHash:  "key-a",
			TotalTokens: 10,
		},
		{
			EventHash:   "api-key-page-b",
			TimestampMS: 1_778_000_002_000,
			Timestamp:   "2026-05-06T00:00:02Z",
			Model:       "gpt-test",
			Endpoint:    "POST /v1/chat/completions",
			APIKeyHash:  "key-b",
			TotalTokens: 20,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	page, err := db.UsageBreakdownPage(context.Background(), UsageBreakdownAPIKeys, UsageSummaryFilter{}, UsagePageFilter{
		Page:     1,
		PageSize: 1,
	})
	if err != nil {
		t.Fatalf("usage api-key page: %v", err)
	}
	if page.TotalItems != 2 {
		t.Fatalf("total items = %d, want 2", page.TotalItems)
	}
	if details := collectTestDetails(page.Usage); len(details) != 0 {
		t.Fatalf("api-key page usage details len = %d, want direct items only", len(details))
	}
	items, ok := page.Items.([]UsageBreakdownPageItem)
	if !ok || len(items) != 1 || items[0].APIKeyHash != "key-b" {
		t.Fatalf("api-key page items = %#v, want direct key-b item", page.Items)
	}
}

func TestStoreUsageBreakdownPagePaginatesRealtimeRows(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:   "realtime-page-old",
			TimestampMS: 1_778_000_001_000,
			Timestamp:   "2026-05-06T00:00:01Z",
			Model:       "gpt-test",
			Endpoint:    "POST /v1/chat/completions",
			TotalTokens: 10,
		},
		{
			EventHash:   "realtime-page-new",
			TimestampMS: 1_778_000_002_000,
			Timestamp:   "2026-05-06T00:00:02Z",
			Model:       "gpt-test",
			Endpoint:    "POST /v1/chat/completions",
			TotalTokens: 20,
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	page, err := db.UsageBreakdownPage(context.Background(), UsageBreakdownRealtime, UsageSummaryFilter{}, UsagePageFilter{
		Page:     2,
		PageSize: 1,
	})
	if err != nil {
		t.Fatalf("usage realtime page: %v", err)
	}
	if page.TotalItems != 2 || page.Page != 2 {
		t.Fatalf("pagination = %#v", page)
	}
	if details := collectTestDetails(page.Usage); len(details) != 0 {
		t.Fatalf("realtime page usage details len = %d, want direct items only", len(details))
	}
	items, ok := page.Items.([]usage.Event)
	if !ok || len(items) != 1 || items[0].EventHash != "realtime-page-old" {
		t.Fatalf("realtime page items = %#v, want direct oldest event", page.Items)
	}
}

func TestStoreUsageBreakdownPagePaginatesModelGroupsWithFilters(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	_, err = db.InsertEvents(context.Background(), []usage.Event{
		{
			EventHash:            "model-page-codex",
			TimestampMS:          1_778_000_001_000,
			Timestamp:            "2026-05-06T00:00:01Z",
			Provider:             "codex",
			Model:                "gpt-test",
			Endpoint:             "POST /v1/chat/completions",
			ResolvedModel:        "gpt-test-resolved",
			InputTokens:          10,
			OutputTokens:         20,
			TotalTokens:          30,
			AuthProviderSnapshot: "codex",
		},
		{
			EventHash:            "model-page-other",
			TimestampMS:          1_778_000_002_000,
			Timestamp:            "2026-05-06T00:00:02Z",
			Provider:             "gemini",
			Model:                "gemini-test",
			Endpoint:             "POST /v1/chat/completions",
			TotalTokens:          40,
			AuthProviderSnapshot: "gemini",
		},
	})
	if err != nil {
		t.Fatalf("insert events: %v", err)
	}

	page, err := db.UsageBreakdownPage(context.Background(), UsageBreakdownModels, UsageSummaryFilter{Provider: "codex"}, UsagePageFilter{
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("usage model page: %v", err)
	}
	if page.TotalItems != 1 || page.Usage.TotalRequests != 1 || page.Usage.TotalTokens != 30 {
		t.Fatalf("model page = %#v", page)
	}
	details := collectTestDetails(page.Usage)
	if len(details) != 1 || details[0].ResolvedModel != "gpt-test-resolved" || details[0].Tokens.TotalTokens != 30 {
		t.Fatalf("model page details = %#v", details)
	}
}

func collectTestDetails(payload usage.Payload) []usage.Detail {
	details := make([]usage.Detail, 0)
	for _, api := range payload.APIs {
		for _, model := range api.Models {
			details = append(details, model.Details...)
		}
	}
	return details
}

func TestStoreAPIKeyAliases(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: hash, Alias: " Alice "},
	}, nil); err != nil {
		t.Fatalf("upsert alias: %v", err)
	}

	aliases, err := db.LoadAPIKeyAliases(context.Background())
	if err != nil {
		t.Fatalf("load aliases: %v", err)
	}
	if len(aliases) != 1 {
		t.Fatalf("len(aliases) = %d, want 1", len(aliases))
	}
	if aliases[0].APIKeyHash != hash || aliases[0].Alias != "Alice" || aliases[0].UpdatedAtMS <= 0 {
		t.Fatalf("alias = %#v", aliases[0])
	}

	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: hash, Alias: "Team A"},
	}, nil); err != nil {
		t.Fatalf("update alias: %v", err)
	}
	aliases, err = db.LoadAPIKeyAliases(context.Background())
	if err != nil {
		t.Fatalf("reload aliases: %v", err)
	}
	if len(aliases) != 1 || aliases[0].Alias != "Team A" {
		t.Fatalf("updated aliases = %#v", aliases)
	}

	const otherHash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: otherHash, Alias: " team a "},
	}, nil); err == nil || err.Error() != "api key alias already exists" {
		t.Fatalf("duplicate alias error = %v", err)
	}
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: hash, Alias: "Alpha"},
		{APIKeyHash: otherHash, Alias: " alpha "},
	}, nil); err == nil || err.Error() != "api key alias already exists" {
		t.Fatalf("batch duplicate alias error = %v", err)
	}

	if err := db.DeleteAPIKeyAlias(context.Background(), hash); err != nil {
		t.Fatalf("delete alias: %v", err)
	}
	aliases, err = db.LoadAPIKeyAliases(context.Background())
	if err != nil {
		t.Fatalf("load after delete: %v", err)
	}
	if len(aliases) != 0 {
		t.Fatalf("aliases after delete = %#v", aliases)
	}
}

func TestStoreAPIKeyAliasesActiveHashesMigration(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	const orphanHash = "1111111111111111111111111111111111111111111111111111111111111111"
	const newHash = "2222222222222222222222222222222222222222222222222222222222222222"
	const activeHash = "3333333333333333333333333333333333333333333333333333333333333333"

	// 历史残留：orphanHash 关联别名 "team-a"（模拟编辑/删除密钥后留下的孤儿映射）。
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: orphanHash, Alias: "team-a"},
		{APIKeyHash: activeHash, Alias: "team-b"},
	}, nil); err != nil {
		t.Fatalf("seed aliases: %v", err)
	}

	// 编辑/重建场景：新 hash 想要复用 "team-a"，且 orphanHash 不在活跃集合。
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: newHash, Alias: "team-a"},
	}, []string{newHash, activeHash}); err != nil {
		t.Fatalf("migrate alias from orphan: %v", err)
	}

	aliases, err := db.LoadAPIKeyAliases(context.Background())
	if err != nil {
		t.Fatalf("load aliases: %v", err)
	}
	hashByAlias := map[string]string{}
	for _, alias := range aliases {
		hashByAlias[alias.Alias] = alias.APIKeyHash
	}
	if hashByAlias["team-a"] != newHash {
		t.Fatalf("team-a should belong to newHash, got %#v", aliases)
	}
	if hashByAlias["team-b"] != activeHash {
		t.Fatalf("team-b should remain on activeHash, got %#v", aliases)
	}
	if _, exists := hashByAlias["team-a"]; !exists || len(aliases) != 2 {
		t.Fatalf("orphan record should be cleaned up, got %#v", aliases)
	}

	// 真冲突场景：被占用方仍在活跃集合中，应拒绝。
	if err := db.UpsertAPIKeyAliases(context.Background(), []APIKeyAlias{
		{APIKeyHash: newHash, Alias: "team-b"},
	}, []string{newHash, activeHash}); err == nil || err.Error() != "api key alias already exists" {
		t.Fatalf("active conflict should be rejected, got err = %v", err)
	}
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func facetOptionsContain(options []usage.FacetOption, value string, label string) bool {
	for _, option := range options {
		if option.Value == value && option.Label == label {
			return true
		}
	}
	return false
}

func TestMigrateProxyDetailSchemaRebuildsLegacyAuthColumns(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "usage.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS cpa_proxy_detail (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			auth_index  TEXT    NOT NULL,
			auth_type   INTEGER DEFAULT 1,
			auth_value  TEXT    NOT NULL DEFAULT '',
			auth_info   TEXT    NOT NULL DEFAULT '1',
			content     TEXT,
			status      INTEGER DEFAULT 0,
			priority    INTEGER DEFAULT 0,
			param       TEXT    DEFAULT '{}',
			owner_id    INTEGER,
			create_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			update_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			remark      TEXT
		)
	`); err != nil {
		t.Fatalf("legacy create table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO cpa_proxy_detail (auth_index, auth_value) VALUES ('legacy-index', 'legacy-proxy')`); err != nil {
		t.Fatalf("legacy insert: %v", err)
	}

	srv, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer srv.Close()

	var count int
	if err := srv.DB().QueryRow(`SELECT COUNT(*) FROM cpa_proxy_detail`).Scan(&count); err != nil {
		t.Fatalf("count proxy rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected legacy proxy rows to be removed during the confirmed empty-table rebuild, got %d", count)
	}

	var columnCount int
	if err := srv.DB().QueryRow(`SELECT COUNT(*) FROM pragma_table_info('cpa_proxy_detail') WHERE name = 'proxy_index'`).Scan(&columnCount); err != nil {
		t.Fatalf("inspect proxy schema: %v", err)
	}
	if columnCount != 1 {
		t.Fatalf("expected proxy_index column after migration")
	}
}

func TestOpenDropsDeprecatedAPIKeyDetailTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE cpa_api_key_detail (id INTEGER PRIMARY KEY, api_key TEXT NOT NULL)`); err != nil {
		_ = db.Close()
		t.Fatalf("create deprecated table: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	srv, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	var count int
	if err := srv.DB().QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'cpa_api_key_detail'`).Scan(&count); err != nil {
		t.Fatalf("query deprecated table: %v", err)
	}
	if count != 0 {
		t.Fatalf("deprecated table count = %d, want 0", count)
	}
}

func TestMigrateAuthInfoJSONPreservesExistingRows(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE cpa_auth_detail (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			auth_index TEXT NOT NULL,
			auth_type INTEGER DEFAULT 1,
			auth_value TEXT NOT NULL DEFAULT '',
			auth_info TEXT NOT NULL DEFAULT '1',
			content TEXT,
			status INTEGER DEFAULT 0,
			priority INTEGER DEFAULT 0,
			param TEXT DEFAULT '{}',
			provider_id INTEGER,
			owner_id INTEGER,
			create_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			update_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			remark TEXT
		);
		INSERT INTO cpa_auth_detail (auth_index, auth_type, auth_value, auth_info)
		VALUES ('legacy-auth-index', 1, 'sk-legacy', '6');
	`); err != nil {
		_ = db.Close()
		t.Fatalf("prepare legacy auth row: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	srv, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	defer srv.Close()

	var raw string
	if err := srv.DB().QueryRow(`SELECT auth_info FROM cpa_auth_detail WHERE auth_index = 'legacy-auth-index'`).Scan(&raw); err != nil {
		t.Fatalf("read migrated auth_info: %v", err)
	}
	var info struct {
		SchemaVersion  int      `json:"schema_version"`
		CredentialType string   `json:"credential_type"`
		APIType        int      `json:"api_type"`
		Protocols      []string `json:"protocols"`
	}
	if err := json.Unmarshal([]byte(raw), &info); err != nil {
		t.Fatalf("auth_info is not JSON: %v", err)
	}
	if info.SchemaVersion != 1 || info.CredentialType != "api_key" || info.APIType != 6 {
		t.Fatalf("unexpected migrated auth_info: %+v", info)
	}
	if len(info.Protocols) != 2 || info.Protocols[0] != "openai" || info.Protocols[1] != "anthropic" {
		t.Fatalf("unexpected migrated protocols: %#v", info.Protocols)
	}
}

func TestSeedCharitableCatalogMigratesLegacyRowsIdempotently(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE cpa_channel_info (
			channel_id INTEGER PRIMARY KEY AUTOINCREMENT,
			channel_name TEXT NOT NULL,
			status INTEGER DEFAULT 1,
			param TEXT DEFAULT '{}',
			url TEXT,
			create_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			update_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE cpa_provider_info (
			provider_id INTEGER PRIMARY KEY AUTOINCREMENT,
			provider_name TEXT NOT NULL,
			channel_id INTEGER,
			status INTEGER DEFAULT 1,
			base_url TEXT NOT NULL,
			param TEXT DEFAULT '{}',
			create_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			update_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		INSERT INTO cpa_channel_info (channel_id, channel_name, status) VALUES (1, 'legacy-one', -1);
		INSERT INTO cpa_channel_info (channel_id, channel_name, status) VALUES (7, 'custom-channel', 1);
		INSERT INTO cpa_provider_info (provider_name, channel_id, status, base_url, param)
		VALUES ('custom-codex', 7, -2, 'https://chatgpt.com/backend-api/codex/', '{"keep":true}');
	`); err != nil {
		_ = db.Close()
		t.Fatalf("prepare legacy charitable tables: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy sqlite: %v", err)
	}

	srv, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}

	for _, table := range []string{"cpa_channel_info", "cpa_provider_info"} {
		var count int
		if err := srv.DB().QueryRow("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = 'description'", table).Scan(&count); err != nil {
			_ = srv.Close()
			t.Fatalf("inspect %s description column: %v", table, err)
		}
		if count != 1 {
			_ = srv.Close()
			t.Fatalf("%s description column count = %d", table, count)
		}
	}
	for _, column := range []string{"protocol_type", "cpa_config_type"} {
		var count int
		if err := srv.DB().QueryRow("SELECT COUNT(*) FROM pragma_table_info('cpa_provider_info') WHERE name = ?", column).Scan(&count); err != nil {
			_ = srv.Close()
			t.Fatalf("inspect provider %s column: %v", column, err)
		}
		if count != 1 {
			_ = srv.Close()
			t.Fatalf("provider %s column count = %d", column, count)
		}
	}
	var protocolType, cpaConfigType string
	if err := srv.DB().QueryRow(`SELECT protocol_type, cpa_config_type FROM cpa_provider_info WHERE provider_name='custom-codex'`).Scan(&protocolType, &cpaConfigType); err != nil {
		_ = srv.Close()
		t.Fatalf("read provider integration defaults: %v", err)
	}
	if protocolType != "openai_compatible" || cpaConfigType != "openai-compatibility" {
		_ = srv.Close()
		t.Fatalf("provider integration defaults = (%q, %q)", protocolType, cpaConfigType)
	}

	wantChannels := map[int64]string{1: "内置渠道商", 2: "官方渠道商", 3: "第三方渠道商", 7: "custom-channel"}
	for id, wantName := range wantChannels {
		var name string
		var status int
		if err := srv.DB().QueryRow(`SELECT channel_name, status FROM cpa_channel_info WHERE channel_id=?`, id).Scan(&name, &status); err != nil {
			_ = srv.Close()
			t.Fatalf("read channel %d: %v", id, err)
		}
		if name != wantName || status != 1 {
			_ = srv.Close()
			t.Fatalf("channel %d = (%q, %d), want (%q, 1)", id, name, status, wantName)
		}
	}

	var codexCount int
	if err := srv.DB().QueryRow(`
		SELECT COUNT(*) FROM cpa_provider_info
		WHERE lower(rtrim(trim(base_url), '/')) = 'https://chatgpt.com/backend-api/codex'
	`).Scan(&codexCount); err != nil {
		_ = srv.Close()
		t.Fatalf("count codex providers: %v", err)
	}
	if codexCount != 1 {
		_ = srv.Close()
		t.Fatalf("codex provider count = %d, want 1", codexCount)
	}

	var providerName, param string
	var channelID int64
	var status int
	if err := srv.DB().QueryRow(`SELECT provider_name, channel_id, status, param FROM cpa_provider_info WHERE base_url=?`, "https://chatgpt.com/backend-api/codex/").Scan(&providerName, &channelID, &status, &param); err != nil {
		_ = srv.Close()
		t.Fatalf("read existing codex provider: %v", err)
	}
	if providerName != "custom-codex" || channelID != 7 || status != -2 || param != `{"keep":true}` {
		_ = srv.Close()
		t.Fatalf("existing provider was overwritten: name=%q channel=%d status=%d param=%s", providerName, channelID, status, param)
	}

	var providerCount int
	if err := srv.DB().QueryRow(`SELECT COUNT(*) FROM cpa_provider_info`).Scan(&providerCount); err != nil {
		_ = srv.Close()
		t.Fatalf("count providers: %v", err)
	}
	if providerCount != 7 {
		_ = srv.Close()
		t.Fatalf("provider count = %d, want 7", providerCount)
	}
	if err := srv.Close(); err != nil {
		t.Fatalf("close migrated store: %v", err)
	}

	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatalf("reopen migrated store: %v", err)
	}
	defer reopened.Close()
	var reopenedCount int
	if err := reopened.DB().QueryRow(`SELECT COUNT(*) FROM cpa_provider_info`).Scan(&reopenedCount); err != nil {
		t.Fatalf("count providers after reopen: %v", err)
	}
	if reopenedCount != providerCount {
		t.Fatalf("provider count after reopen = %d, want %d", reopenedCount, providerCount)
	}
}
