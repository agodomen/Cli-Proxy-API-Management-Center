// Package upstreamcontract asserts the assumptions the secondary-development
// code makes about the community CLIProxyAPI build it is mirrored against.
//
// Motivation: file-level drift detection (bin/check-upstream-drift.sh) and
// compilation only cover what the compiler can see. The management center also
// depends on things the compiler cannot check — the HTTP paths it calls on a
// CLIProxyAPI instance, and the YAML keys it reads and rewrites in the engine's
// config.yaml. Those break silently at runtime after a community sync.
//
// Every assertion here should name the caller it protects, so a failure tells
// you what to fix rather than just that something moved.
//
// See docs/architecture/backend-extension-architecture.md §6.5
package upstreamcontract

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	gin "github.com/gin-gonic/gin"
	internalapi "github.com/router-for-me/CLIProxyAPI/v7/internal/api"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v7/sdk/access"
	sdkapi "github.com/router-for-me/CLIProxyAPI/v7/sdk/api"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

// managementRoute is one management endpoint the二开 code calls over HTTP on a
// CLIProxyAPI instance (the embedded local engine, or an external CPA upstream).
type managementRoute struct {
	method string
	path   string
	caller string
}

// requiredManagementRoutes lists every upstream management endpoint reached from
// internal/core. Sources were collected by grepping for "/v0/management" and
// keeping only outbound requests — routes that core serves itself (
// /v0/management/cpamc/*, model-prices, model-price-proxy, api-key-aliases,
// local usage queries) are deliberately absent, and the generic
// /v0/management/* pass-through proxy needs no per-path guarantee.
var requiredManagementRoutes = []managementRoute{
	{http.MethodGet, "/v0/management/config", "internal/core/httpapi/server.go, internal/core/probe/cpa_sync.go"},
	{http.MethodPut, "/v0/management/config.yaml", "internal/core/cluster/pusher.go"},
	{http.MethodGet, "/v0/management/auth-files", "internal/core/collector/auth_snapshot.go"},
	{http.MethodPatch, "/v0/management/auth-files/status", "internal/core/probe/manager.go setAuthFileDisabled"},
	{http.MethodGet, "/v0/management/proxy-url", "internal/core/httpapi/server.go"},
	{http.MethodGet, "/v0/management/usage-queue", "internal/core/httpqueue/client.go"},
	{http.MethodPut, "/v0/management/usage-statistics-enabled", "internal/core/httpapi/server.go"},

	// probe/cpa_sync.go PUTs one section per supportedCPAConfigTypes entry.
	{http.MethodPut, "/v0/management/openai-compatibility", "internal/core/probe/cpa_sync.go"},
	{http.MethodPut, "/v0/management/gemini-api-key", "internal/core/probe/cpa_sync.go"},
	{http.MethodPut, "/v0/management/claude-api-key", "internal/core/probe/cpa_sync.go"},
	{http.MethodPut, "/v0/management/codex-api-key", "internal/core/probe/cpa_sync.go"},
	{http.MethodPut, "/v0/management/vertex-api-key", "internal/core/probe/cpa_sync.go"},
}

func TestUpstreamManagementRoutesExist(t *testing.T) {
	routes := upstreamRouteSet(t)

	// Two sentinels, so a broken harness cannot be mistaken for upstream having
	// deleted every endpoint the management center calls.
	//
	// No routes at all: the engine capture broke.
	if len(routes) == 0 {
		t.Fatal("未捕获到任何上游路由：WithEngineConfigurator 的时机或 internal/api.NewServer 的构造方式已变化，需人工复核本测试")
	}
	if _, ok := routes["GET /healthz"]; !ok {
		t.Fatal("未捕获到基础路由 GET /healthz：路由表捕获时机不对，需人工复核本测试")
	}
	// Base routes present but the management group missing: the registration gate
	// changed (upstream requires a management secret; the test config sets one).
	if !hasPrefix(routes, "/v0/management/") {
		t.Fatal("捕获到基础路由但没有任何 /v0/management/* ：上游 management 路由的注册条件已变化（当前条件是存在 management secret），需人工复核本测试")
	}

	for _, want := range requiredManagementRoutes {
		key := want.method + " " + want.path
		if _, ok := routes[key]; !ok {
			t.Errorf("上游已不再提供 %s（调用方：%s）\n可用的同前缀路由：%s",
				key, want.caller, strings.Join(matchingPrefix(routes, want.path), ", "))
		}
	}
}

// upstreamRouteSet builds a community server the same way sdk/cliproxy does and
// returns its gin route table as "METHOD /path" keys. No listener is opened.
//
// Two upstream behaviours this depends on:
//
//  1. Management routes are registered only when a management secret exists
//     (config secret-key, env, or a local password), so the config below sets
//     RemoteManagement.SecretKey. Without it the table has no /v0/management/*
//     entries at all.
//  2. WithEngineConfigurator runs BEFORE routes are registered, and
//     WithRouterConfigurator runs after the base routes but still BEFORE the
//     management group. Neither can read the final table, so we only capture the
//     engine pointer and enumerate after NewServer returns.
func upstreamRouteSet(t *testing.T) map[string]struct{} {
	t.Helper()

	gin.SetMode(gin.TestMode)

	tmpDir := t.TempDir()
	authDir := filepath.Join(tmpDir, "auth")
	if err := os.MkdirAll(authDir, 0o700); err != nil {
		t.Fatalf("MkdirAll(%s) error = %v", authDir, err)
	}

	cfg := &sdkconfig.Config{
		SDKConfig: sdkconfig.SDKConfig{
			APIKeys: []string{"contract-test-key"},
		},
		Port:                   0,
		AuthDir:                authDir,
		LoggingToFile:          false,
		UsageStatisticsEnabled: false,
	}
	// Gates management route registration; see (1) above.
	cfg.RemoteManagement.SecretKey = "contract-test-secret"

	var engine *gin.Engine
	capture := sdkapi.WithEngineConfigurator(func(e *gin.Engine) {
		engine = e
	})

	_ = internalapi.NewServer(
		cfg,
		coreauth.NewManager(nil, nil, nil),
		sdkaccess.NewManager(),
		filepath.Join(tmpDir, "config.yaml"),
		capture,
	)

	if engine == nil {
		t.Fatal("WithEngineConfigurator 未被调用：上游 internal/api.NewServer 的 option 处理已变化")
	}

	out := make(map[string]struct{})
	for _, route := range engine.Routes() {
		out[strings.ToUpper(strings.TrimSpace(route.Method))+" "+route.Path] = struct{}{}
	}
	return out
}

func hasPrefix(routes map[string]struct{}, pathPrefix string) bool {
	for key := range routes {
		if idx := strings.IndexByte(key, ' '); idx >= 0 && strings.HasPrefix(key[idx+1:], pathPrefix) {
			return true
		}
	}
	return false
}

// matchingPrefix lists routes sharing the failing path's parent, which is what
// you need to see when upstream renames or moves an endpoint.
func matchingPrefix(routes map[string]struct{}, path string) []string {
	prefix := path
	if idx := strings.LastIndexByte(path, '/'); idx > 0 {
		prefix = path[:idx]
	}
	var out []string
	for key := range routes {
		if strings.Contains(key, prefix) {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	if len(out) > 12 {
		out = append(out[:12], "...")
	}
	if len(out) == 0 {
		out = []string{"（无）"}
	}
	return out
}
