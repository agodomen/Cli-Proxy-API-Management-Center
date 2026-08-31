package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/collector"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/proxy"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func newPluginProxyTestHandler(t *testing.T) http.Handler {
	t.Helper()
	cfg := config.Config{
		DBPath:      filepath.Join(t.TempDir(), "usage.sqlite"),
		CORSOrigins: []string{"*"},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	manager := collector.NewManager(cfg, db)
	return New(cfg, db, manager).Handler()
}

func newPluginProxyTestServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.Config{
		DBPath:      filepath.Join(t.TempDir(), "usage.sqlite"),
		CORSOrigins: []string{"*"},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	manager := collector.NewManager(cfg, db)
	return New(cfg, db, manager)
}

func TestHandlePluginProxyGetDefaults(t *testing.T) {
	handler := newPluginProxyTestHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v0/cpamc/plugin-proxy", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	proxyCfg, ok := resp["plugin-proxy"].(map[string]any)
	if !ok {
		t.Fatalf("plugin-proxy not found: %#v", resp)
	}
	if status, ok := proxyCfg["status"].(float64); !ok || status != 0 {
		t.Fatalf("expected status=0, got %#v", proxyCfg["status"])
	}
}

func TestHandlePluginProxyPutCustom(t *testing.T) {
	handler := newPluginProxyTestHandler(t)

	body := `{"value":{"status":1,"url":"socks5://127.0.0.1:1080"}}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/v0/cpamc/plugin-proxy", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d, body=%s", rec.Code, rec.Body.String())
	}

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/v0/cpamc/plugin-proxy", nil)
	handler.ServeHTTP(rec2, req2)
	var resp map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	proxyCfg, ok := resp["plugin-proxy"].(map[string]any)
	if !ok {
		t.Fatalf("plugin-proxy not found")
	}
	if status, _ := proxyCfg["status"].(float64); status != 1 {
		t.Fatalf("expected status=1, got %#v", proxyCfg["status"])
	}
}

func TestHandlePluginProxyValidateAccelerator(t *testing.T) {
	handler := newPluginProxyTestHandler(t)

	body := `{"status":3,"accelerator":"https://gh-proxy.com"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v0/cpamc/plugin-proxy/validate", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("validate status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if valid, _ := resp["valid"].(bool); !valid {
		t.Fatalf("expected valid=true, got %#v", resp)
	}
}

func TestHandlePluginProxyResolveResolution(t *testing.T) {
	srv := newPluginProxyTestServer(t)

	resolution := srv.ResolvePluginProxyResolution(context.Background())
	if resolution.ProxyURL != "" || resolution.AcceleratorBase != "" {
		t.Fatalf("expected empty resolution, got %#v", resolution)
	}

	scoped := proxy.ScopedProxyConfig{Status: proxy.StatusAccelerator, Accelerator: "https://gh-proxy.com/"}
	if err := srv.savePluginProxy(context.Background(), scoped); err != nil {
		t.Fatalf("save: %v", err)
	}
	resolution = srv.ResolvePluginProxyResolution(context.Background())
	if resolution.AcceleratorBase != "https://gh-proxy.com/" {
		t.Fatalf("expected accelerator base, got %q", resolution.AcceleratorBase)
	}
}

func TestResolvePluginProxySystemUsesLocalEngineProxyURL(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("proxy-url: socks5://127.0.0.1:10808\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg := config.Config{
		DBPath: filepath.Join(dir, "usage.sqlite"),
		LocalEngine: config.LocalEngineConfig{
			Enabled:    true,
			ConfigPath: configPath,
		},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer db.Close()
	server := New(cfg, db, collector.NewManager(cfg, db))
	if err := server.savePluginProxy(context.Background(), proxy.ScopedProxyConfig{Status: proxy.StatusSystem}); err != nil {
		t.Fatalf("save plugin proxy: %v", err)
	}

	resolution := server.ResolvePluginProxyResolution(context.Background())
	if resolution.ProxyURL != "socks5://127.0.0.1:10808" {
		t.Fatalf("proxy URL = %q", resolution.ProxyURL)
	}
}
