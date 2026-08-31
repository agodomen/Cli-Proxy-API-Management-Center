package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// MetaAPIEntry describes a single API path recorded in the cpa_api_detail
// catalog. The registry (metaAPIRegistry below) is the single source of truth;
// on every service startup SyncMetaAPI upserts it into SQLite so the frontend
// debug page can browse and exercise every route.
//
// Maintenance rule (see AGENTS.md §4): whenever a route is added, removed, or
// its path/method/file location changes, update metaAPIRegistry in this file.
type MetaAPIEntry struct {
	ID       string `json:"id"`       // stable unique key (group + path + method)
	Group    string `json:"group"`    // logical module: usage, cluster, charitable ...
	Method   string `json:"method"`   // GET / POST / PUT / DELETE / PATCH / * / ROUTE
	Path     string `json:"path"`     // absolute path (backend) or route path (frontend)
	Side     string `json:"side"`     // "frontend" | "backend"
	Source   string `json:"source"`   // "secondary" | "community"
	FileRef  string `json:"fileRef"`  // repo-relative file path declaring this route
	Desc     string `json:"description"`
}

// metaAPISide constants.
const (
	MetaAPISideFrontend = "frontend"
	MetaAPISideBackend  = "backend"
)

// metaAPISource constants.
const (
	MetaAPISourceSecondary = "secondary"
	MetaAPISourceCommunity = "community"
)

// metaAPIRegistry is the hand-maintained catalog of every API path in the
// project. Backend entries are HTTP endpoints; frontend entries are router
// paths. Only backend entries are exercisable from the debug panel.
//
// KEEP IN SYNC with route registrations — see AGENTS.md §4.
var metaAPIRegistry = []MetaAPIEntry{
	// ── Health / setup / status (secondary) ──
	{ID: "health", Group: "system", Method: "GET", Path: "/health", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Health check"},
	{ID: "status", Group: "system", Method: "GET", Path: "/status", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Service status incl. embedded engine"},
	{ID: "usage-service-info", Group: "system", Method: "GET", Path: "/usage-service/info", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Usage service info"},
	{ID: "usage-service-config", Group: "system", Method: "GET", Path: "/usage-service/config", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Manager config read"},
	{ID: "usage-service-config-put", Group: "system", Method: "PUT", Path: "/usage-service/config", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Manager config update"},
	{ID: "setup", Group: "system", Method: "POST", Path: "/setup", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Initial connection setup"},

	// ── Model prices (secondary) ──
	{ID: "model-prices-get", Group: "model-prices", Method: "GET", Path: "/v0/cpamc/model-prices", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "List model prices"},
	{ID: "model-prices-put", Group: "model-prices", Method: "PUT", Path: "/v0/cpamc/model-prices", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Replace model prices"},
	{ID: "model-prices-sync", Group: "model-prices", Method: "POST", Path: "/v0/cpamc/model-prices/sync", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Sync prices from litellm"},
	{ID: "model-price-proxy-get", Group: "model-prices", Method: "GET", Path: "/v0/cpamc/model-price-proxy", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/model_price_proxy.go", Desc: "Model price proxy config"},
	{ID: "model-price-proxy-put", Group: "model-prices", Method: "PUT", Path: "/v0/cpamc/model-price-proxy", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/model_price_proxy.go", Desc: "Update price proxy config"},
	{ID: "model-price-proxy-validate", Group: "model-prices", Method: "POST", Path: "/v0/cpamc/model-price-proxy/validate", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/model_price_proxy.go", Desc: "Validate price proxy"},

	// ── Plugin proxy & store (secondary) ──
	{ID: "plugin-proxy-get", Group: "plugin", Method: "GET", Path: "/v0/cpamc/plugin-proxy", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/plugin_proxy.go", Desc: "Plugin proxy config"},
	{ID: "plugin-proxy-put", Group: "plugin", Method: "PUT", Path: "/v0/cpamc/plugin-proxy", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/plugin_proxy.go", Desc: "Update plugin proxy"},
	{ID: "plugin-proxy-validate", Group: "plugin", Method: "POST", Path: "/v0/cpamc/plugin-proxy/validate", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/plugin_proxy.go", Desc: "Validate plugin proxy"},
	{ID: "plugin-store-list", Group: "plugin", Method: "GET", Path: "/v0/cpamc/plugin-store", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/plugin_store.go", Desc: "List plugin store"},
	{ID: "plugin-store-install", Group: "plugin", Method: "POST", Path: "/v0/cpamc/plugin-store/:id/install", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/plugin_store.go", Desc: "Install plugin"},

	// ── Cluster (secondary) ──
	{ID: "cluster-get", Group: "cluster", Method: "GET", Path: "/v0/cpamc/cluster", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Cluster status"},
	{ID: "cluster-nodes-get", Group: "cluster", Method: "GET", Path: "/v0/cpamc/cluster/nodes", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "List nodes"},
	{ID: "cluster-nodes-post", Group: "cluster", Method: "POST", Path: "/v0/cpamc/cluster/nodes", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Register node"},
	{ID: "cluster-node-delete", Group: "cluster", Method: "DELETE", Path: "/v0/cpamc/cluster/nodes/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Delete node"},
	{ID: "cluster-node-push", Group: "cluster", Method: "POST", Path: "/v0/cpamc/cluster/nodes/:id/push", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Push to node"},
	{ID: "cluster-node-heartbeat", Group: "cluster", Method: "POST", Path: "/v0/cpamc/cluster/nodes/:id/heartbeat", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Node heartbeat"},
	{ID: "cluster-push", Group: "cluster", Method: "POST", Path: "/v0/cpamc/cluster/push", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Cluster push"},
	{ID: "cluster-home-get", Group: "cluster", Method: "GET", Path: "/v0/cpamc/cluster/home", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Home node"},
	{ID: "cluster-home-put", Group: "cluster", Method: "PUT", Path: "/v0/cpamc/cluster/home", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Set home node"},
	{ID: "cluster-home-push", Group: "cluster", Method: "POST", Path: "/v0/cpamc/cluster/home/push", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Push to home"},
	{ID: "cluster-config-get", Group: "cluster", Method: "GET", Path: "/v0/cpamc/cluster/config", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Cluster config"},
	{ID: "cluster-config-put", Group: "cluster", Method: "PUT", Path: "/v0/cpamc/cluster/config", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/cluster/httpapi.go", Desc: "Update cluster config"},

	// ── API key aliases (secondary) ──
	{ID: "api-key-aliases-get", Group: "api-key-aliases", Method: "GET", Path: "/v0/cpamc/api-key-aliases", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "List aliases"},
	{ID: "api-key-aliases-put", Group: "api-key-aliases", Method: "PUT", Path: "/v0/cpamc/api-key-aliases", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Replace aliases"},
	{ID: "api-key-alias-delete", Group: "api-key-aliases", Method: "DELETE", Path: "/v0/cpamc/api-key-aliases/:hash", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Delete alias"},

	// ── Usage (secondary) ──
	{ID: "usage-list", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Recent usage events"},
	{ID: "usage-realtime-stream", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/realtime/stream", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Realtime usage SSE stream"},
	{ID: "usage-export", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/export", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Export usage CSV"},
	{ID: "usage-summary", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/summary", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Usage summary"},
	{ID: "usage-accounts", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/accounts", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Usage breakdown by account"},
	{ID: "usage-api-keys", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/api-keys", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Usage breakdown by API key"},
	{ID: "usage-realtime", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/realtime", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Usage breakdown realtime"},
	{ID: "usage-models", Group: "usage", Method: "GET", Path: "/v0/cpamc/usage/models", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Usage breakdown by model"},
	{ID: "usage-import", Group: "usage", Method: "POST", Path: "/v0/cpamc/usage/import", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Import usage events"},

	// ── Data cleanup (secondary) ──
	{ID: "data-cleanup-tables", Group: "data-cleanup", Method: "GET", Path: "/v0/cpamc/data-cleanup/tables", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "List cleanup tables"},
	{ID: "data-cleanup-settings-get", Group: "data-cleanup", Method: "GET", Path: "/v0/cpamc/data-cleanup/settings", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Cleanup settings"},
	{ID: "data-cleanup-settings-put", Group: "data-cleanup", Method: "PUT", Path: "/v0/cpamc/data-cleanup/settings", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Update cleanup settings"},
	{ID: "data-cleanup-purge", Group: "data-cleanup", Method: "POST", Path: "/v0/cpamc/data-cleanup/purge", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Purge data"},

	// ── Common params (secondary) ──
	{ID: "common-params-get", Group: "common-params", Method: "GET", Path: "/v0/cpamc/common-params", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/common_params_handler.go", Desc: "Common params"},
	{ID: "common-params-put", Group: "common-params", Method: "PUT", Path: "/v0/cpamc/common-params", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/common_params_handler.go", Desc: "Update common params"},
	{ID: "common-params-refresh-ua", Group: "common-params", Method: "POST", Path: "/v0/cpamc/common-params/refresh-user-agent", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/common_params_handler.go", Desc: "Refresh user agent"},

	// ── Charitable: channels (secondary) ──
	{ID: "char-channels-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/channels", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List channels"},
	{ID: "char-channels-post", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/channels", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Create channel"},
	{ID: "char-channel-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/channels/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Get channel"},
	{ID: "char-channel-put", Group: "charitable", Method: "PUT", Path: "/v0/cpamc/charitable/channels/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update channel"},
	{ID: "char-channel-delete", Group: "charitable", Method: "DELETE", Path: "/v0/cpamc/charitable/channels/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Delete channel"},

	// ── Charitable: providers (secondary) ──
	{ID: "char-providers-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/providers", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List providers"},
	{ID: "char-providers-post", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/providers", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Create provider"},
	{ID: "char-provider-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/providers/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Get provider"},
	{ID: "char-provider-put", Group: "charitable", Method: "PUT", Path: "/v0/cpamc/charitable/providers/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update provider"},
	{ID: "char-provider-delete", Group: "charitable", Method: "DELETE", Path: "/v0/cpamc/charitable/providers/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Delete provider"},
	{ID: "char-provider-full-param", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/providers/:id/full_param", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Provider full param"},
	{ID: "char-provider-param", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/providers/:id/param", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Provider param"},

	// ── Charitable: keys (secondary) ──
	{ID: "char-keys-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/keys", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List keys"},
	{ID: "char-keys-post", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/keys", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Create key"},
	{ID: "char-key-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/keys/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Get key"},
	{ID: "char-key-put", Group: "charitable", Method: "PUT", Path: "/v0/cpamc/charitable/keys/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update key"},
	{ID: "char-key-delete", Group: "charitable", Method: "DELETE", Path: "/v0/cpamc/charitable/keys/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Delete key"},
	{ID: "char-key-full-param", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/keys/:id/full_param", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Key full param"},
	{ID: "char-key-param-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/keys/:id/param", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Key param"},
	{ID: "char-key-param-put", Group: "charitable", Method: "PUT", Path: "/v0/cpamc/charitable/keys/:id/param", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update key param"},
	{ID: "char-keys-batch", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/keys/batch/:action", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Batch key action"},
	{ID: "char-keys-query", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/keys/query", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Query keys"},
	{ID: "char-keys-upsert", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/keys/upsert", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Upsert key"},
	{ID: "char-keys-statuses", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/keys/statuses", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Key status counts"},

	// ── Charitable: proxies (secondary) ──
	{ID: "char-proxies-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/proxies", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List proxies"},
	{ID: "char-proxies-post", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Create proxy"},
	{ID: "char-proxy-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/proxies/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Get proxy"},
	{ID: "char-proxy-put", Group: "charitable", Method: "PUT", Path: "/v0/cpamc/charitable/proxies/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update proxy"},
	{ID: "char-proxy-delete", Group: "charitable", Method: "DELETE", Path: "/v0/cpamc/charitable/proxies/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Delete proxy"},
	{ID: "char-proxies-query", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/query", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Query proxies"},
	{ID: "char-proxies-upsert", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/upsert", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Upsert proxy"},
	{ID: "char-proxies-batch", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/batch/:action", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Batch proxy action"},
	{ID: "char-proxies-probe", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/probe", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Probe proxy"},
	{ID: "char-proxies-site-test", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/site-test", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Proxy site test"},

	// ── Charitable: clash subscriptions (secondary) ──
	{ID: "char-subs-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/proxies/subscriptions", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List subscriptions"},
	{ID: "char-subs-post", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/subscriptions", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Create subscription"},
	{ID: "char-sub-get", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/proxies/subscriptions/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Get subscription"},
	{ID: "char-sub-put", Group: "charitable", Method: "PUT", Path: "/v0/cpamc/charitable/proxies/subscriptions/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update subscription"},
	{ID: "char-sub-delete", Group: "charitable", Method: "DELETE", Path: "/v0/cpamc/charitable/proxies/subscriptions/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Delete subscription"},
	{ID: "char-subs-resolve", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/proxies/subscriptions/resolve-urls", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Resolve subscription URLs"},
	{ID: "char-public-sub", Group: "charitable", Method: "GET", Path: "/v0/cpamc/charitable/subscriptions/:token", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Public clash feed (no auth)"},

	// ── Charitable: debug console (secondary) ──
	{ID: "char-debug-databases", Group: "charitable-debug", Method: "GET", Path: "/v0/cpamc/charitable/debug/databases", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List debug databases"},
	{ID: "char-debug-database", Group: "charitable-debug", Method: "GET", Path: "/v0/cpamc/charitable/debug/databases/:id", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Debug database detail"},
	{ID: "char-debug-query", Group: "charitable-debug", Method: "POST", Path: "/v0/cpamc/charitable/debug/query", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Run SQL query"},
	{ID: "char-debug-key-settings-get", Group: "charitable-debug", Method: "GET", Path: "/v0/cpamc/charitable/debug/key/settings", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Key debug settings"},
	{ID: "char-debug-key-settings-put", Group: "charitable-debug", Method: "PUT", Path: "/v0/cpamc/charitable/debug/key/settings", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Update key debug settings"},
	{ID: "char-debug-key-extract", Group: "charitable-debug", Method: "POST", Path: "/v0/cpamc/charitable/debug/key/extract", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Extract key credentials"},
	{ID: "char-debug-key-models", Group: "charitable-debug", Method: "GET", Path: "/v0/cpamc/charitable/debug/key/models", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "List key provider models"},
	{ID: "char-debug-key-probe", Group: "charitable-debug", Method: "POST", Path: "/v0/cpamc/charitable/debug/key/probe", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Probe key protocols"},
	{ID: "char-debug-key-save", Group: "charitable-debug", Method: "POST", Path: "/v0/cpamc/charitable/debug/key/save", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Save key credential"},

	// ── Charitable: probe (secondary) ──
	{ID: "probe-config-get", Group: "probe", Method: "GET", Path: "/v0/cpamc/charitable/probe/config", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "Probe config"},
	{ID: "probe-config-put", Group: "probe", Method: "PUT", Path: "/v0/cpamc/charitable/probe/config", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "Update probe config"},
	{ID: "probe-status", Group: "probe", Method: "GET", Path: "/v0/cpamc/charitable/probe/status", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "Probe status"},
	{ID: "probe-summary", Group: "probe", Method: "GET", Path: "/v0/cpamc/charitable/probe/summary", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "Probe summary"},
	{ID: "probe-results", Group: "probe", Method: "GET", Path: "/v0/cpamc/charitable/probe/results", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "List probe results"},
	{ID: "probe-stats", Group: "probe", Method: "GET", Path: "/v0/cpamc/charitable/probe/stats", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "Probe key stats"},
	{ID: "probe-actions", Group: "probe", Method: "GET", Path: "/v0/cpamc/charitable/probe/actions", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/probe/handler.go", Desc: "Probe action log"},

	// ── Charitable: sync (secondary) ──
	{ID: "char-sync-sp", Group: "charitable", Method: "POST", Path: "/v0/cpamc/charitable/sync/service-providers", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/charitable/handler.go", Desc: "Sync service providers to keys"},

	// ── Gateway proxy (secondary) ──
	{ID: "gateway-models", Group: "gateway", Method: "GET", Path: "/v1/models", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Model list proxy (gateway mode)"},
	{ID: "gateway-inference", Group: "gateway", Method: "*", Path: "/v1/*", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Inference reverse proxy (gateway mode)"},

	// ── Management proxy to CPA upstream (secondary reverse proxy) ──
	{ID: "mgmt-proxy", Group: "management-proxy", Method: "*", Path: "/v0/management/*", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/server.go", Desc: "Reverse proxy to CPA upstream"},

	// ── Meta API catalog (secondary) ──
	{ID: "meta-api-list", Group: "meta-api", Method: "GET", Path: "/v0/cpamc/meta-api/list", Side: MetaAPISideBackend, Source: MetaAPISourceSecondary, FileRef: "backend/internal/core/httpapi/meta_api_handler.go", Desc: "Project API path catalog + stats"},

	// ── Community CLIProxyAPI protocol paths (community) ──
	{ID: "community-v1-chat", Group: "community-protocol", Method: "POST", Path: "/v1/chat/completions", Side: MetaAPISideBackend, Source: MetaAPISourceCommunity, FileRef: "backend/internal/api", Desc: "Community chat completions (embedded engine)"},
	{ID: "community-v1-responses", Group: "community-protocol", Method: "POST", Path: "/v1/responses", Side: MetaAPISideBackend, Source: MetaAPISourceCommunity, FileRef: "backend/internal/api", Desc: "Community responses endpoint"},
	{ID: "community-v1-models", Group: "community-protocol", Method: "GET", Path: "/v1/models", Side: MetaAPISideBackend, Source: MetaAPISourceCommunity, FileRef: "backend/internal/api", Desc: "Community models list (engine port)"},

	// ── Frontend routes (secondary) ──
	{ID: "fe-ai-providers", Group: "frontend-routes", Method: "ROUTE", Path: "/ai/providers", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "AI providers workbench"},
	{ID: "fe-auth-providers", Group: "frontend-routes", Method: "ROUTE", Path: "/auth/providers", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Auth providers list"},
	{ID: "fe-monitoring", Group: "frontend-routes", Method: "ROUTE", Path: "/monitoring", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Monitoring center"},
	{ID: "fe-model-price", Group: "frontend-routes", Method: "ROUTE", Path: "/model/price", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Model price page"},
	{ID: "fe-realtime-request", Group: "frontend-routes", Method: "ROUTE", Path: "/realtime/request", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Request monitor"},
	{ID: "fe-monitor-inspection", Group: "frontend-routes", Method: "ROUTE", Path: "/monitor/inspection", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Codex inspection"},
	{ID: "fe-system-config", Group: "frontend-routes", Method: "ROUTE", Path: "/system/config", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "System config"},
	{ID: "fe-system-overview", Group: "frontend-routes", Method: "ROUTE", Path: "/system/overview", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "System overview (dashboard)"},
	{ID: "fe-plugin-store", Group: "frontend-routes", Method: "ROUTE", Path: "/plugin/store", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Plugin store page"},
	{ID: "fe-cluster-settings", Group: "frontend-routes", Method: "ROUTE", Path: "/cluster/settings", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Cluster settings"},
	{ID: "fe-service-providers", Group: "frontend-routes", Method: "ROUTE", Path: "/service-providers", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Service providers"},
	{ID: "fe-charitable", Group: "frontend-routes", Method: "ROUTE", Path: "/charitable", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Token center layout"},
	{ID: "fe-charitable-token", Group: "frontend-routes", Method: "ROUTE", Path: "/charitable/token", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Token center page"},
	{ID: "fe-charitable-proxies", Group: "frontend-routes", Method: "ROUTE", Path: "/charitable/proxies", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Proxies page"},
	{ID: "fe-charitable-debug", Group: "frontend-routes", Method: "ROUTE", Path: "/charitable/debug", Side: MetaAPISideFrontend, Source: MetaAPISourceSecondary, FileRef: "frontend/src/external/router/externalRoutes.tsx", Desc: "Debug page"},
}

// metaAPITableName is the SQLite table holding the catalog.
const metaAPITableName = "cpa_api_detail"

// ensureMetaAPITable creates the cpa_api_detail table if absent.
func (s *Store) ensureMetaAPITable() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS ` + metaAPITableName + ` (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		entry_id      TEXT    NOT NULL UNIQUE,
		group_name    TEXT    NOT NULL DEFAULT '',
		method        TEXT    NOT NULL,
		path          TEXT    NOT NULL,
		side          TEXT    NOT NULL,
		source        TEXT    NOT NULL,
		file_ref      TEXT    NOT NULL DEFAULT '',
		description   TEXT    NOT NULL DEFAULT '',
		updated_at_ms INTEGER NOT NULL
	)`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_cpa_api_detail_group ON ` + metaAPITableName + `(group_name)`)
	return err
}

// SyncMetaAPI upserts the in-memory registry into cpa_api_detail so the
// frontend catalog reflects the current codebase on every service startup.
// Rows whose entry_id is no longer in the registry are deleted.
func (s *Store) SyncMetaAPI(ctx context.Context) error {
	if err := s.ensureMetaAPITable(); err != nil {
		return fmt.Errorf("ensure meta api table: %w", err)
	}
	now := time.Now().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	upsert, err := tx.PrepareContext(ctx, `INSERT INTO `+metaAPITableName+`
		(entry_id, group_name, method, path, side, source, file_ref, description, updated_at_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(entry_id) DO UPDATE SET
			group_name=excluded.group_name,
			method=excluded.method,
			path=excluded.path,
			side=excluded.side,
			source=excluded.source,
			file_ref=excluded.file_ref,
			description=excluded.description,
			updated_at_ms=excluded.updated_at_ms`)
	if err != nil {
		return err
	}
	defer upsert.Close()

	for _, entry := range metaAPIRegistry {
		if _, err := upsert.ExecContext(ctx, entry.ID, entry.Group, entry.Method, entry.Path, entry.Side, entry.Source, entry.FileRef, entry.Desc, now); err != nil {
			return err
		}
	}

	// Delete rows no longer present in the registry (keeps catalog in sync).
	registryIDs := make([]any, 0, len(metaAPIRegistry))
	for _, entry := range metaAPIRegistry {
		registryIDs = append(registryIDs, entry.ID)
	}
	placeholders := strings.Repeat("?,", len(registryIDs))
	placeholders = strings.TrimSuffix(placeholders, ",")
	_, err = tx.ExecContext(ctx, `DELETE FROM `+metaAPITableName+` WHERE entry_id NOT IN (`+placeholders+`)`, registryIDs...)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// ListMetaAPI reads the full catalog ordered by group then path.
func (s *Store) ListMetaAPI(ctx context.Context) ([]MetaAPIEntry, error) {
	if err := s.ensureMetaAPITable(); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT entry_id, group_name, method, path, side, source, file_ref, description
		FROM `+metaAPITableName+` ORDER BY group_name, path, method`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]MetaAPIEntry, 0)
	for rows.Next() {
		var entry MetaAPIEntry
		if err := rows.Scan(&entry.ID, &entry.Group, &entry.Method, &entry.Path, &entry.Side, &entry.Source, &entry.FileRef, &entry.Desc); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

// MetaAPIStats summarizes the catalog for the debug UI header.
type MetaAPIStats struct {
	Total     int            `json:"total"`
	BySide    map[string]int `json:"bySide"`
	BySource  map[string]int `json:"bySource"`
	ByGroup   map[string]int `json:"byGroup"`
}

// MetaAPIStats computes catalog statistics.
func (s *Store) MetaAPIStats(ctx context.Context) (MetaAPIStats, error) {
	entries, err := s.ListMetaAPI(ctx)
	if err != nil {
		return MetaAPIStats{}, err
	}
	stats := MetaAPIStats{
		Total:    len(entries),
		BySide:   map[string]int{},
		BySource: map[string]int{},
		ByGroup:  map[string]int{},
	}
	for _, entry := range entries {
		stats.BySide[entry.Side]++
		stats.BySource[entry.Source]++
		stats.ByGroup[entry.Group]++
	}
	return stats, nil
}

// MarshalMetaAPIEntries is a convenience JSON helper for the HTTP layer.
func MarshalMetaAPIEntries(entries []MetaAPIEntry) ([]byte, error) {
	return json.Marshal(entries)
}

// ensure unused import guard does not trigger when sql is only used in methods.
var _ *sql.DB
