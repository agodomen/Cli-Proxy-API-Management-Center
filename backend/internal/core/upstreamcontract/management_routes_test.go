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
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/api/handlers"
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
	{http.MethodGet, "/v0/management/auth-files/status", "internal/core/probe/manager.go"},
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

	// A collapsed route table means the capture mechanism broke, not that
	// upstream removed everything. Fail with that distinction stated.
	if len(routes) == 0 {
		t.Fatal("未捕获到任何上游路由：WithRouterConfigurator 的时机或 internal/api.NewServer 的构造方式已变化，需人工复核本测试")
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
// returns its gin route table as "METHOD /path" keys.
//
// WithRouterConfigurator is documented as running after the default routes are
// registered, and internal/api.NewServer invokes it before returning, so the
// captured engine already has the full table. No listener is opened.
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

	var engine *gin.Engine
	capture := sdkapi.WithRouterConfigurator(func(e *gin.Engine, _ *handlers.BaseAPIHandler, _ *sdkconfig.Config) {
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
		t.Fatal("WithRouterConfigurator 未被调用：上游 internal/api.NewServer 的 option 处理已变化")
	}

	out := make(map[string]struct{})
	for _, route := range engine.Routes() {
		out[strings.ToUpper(strings.TrimSpace(route.Method))+" "+route.Path] = struct{}{}
	}
	return out
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
