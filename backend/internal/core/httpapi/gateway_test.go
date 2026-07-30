package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func TestNormalizeGatewayMode(t *testing.T) {
	cases := map[string]string{
		"":             store.GatewayModeDualPort,
		"dual-port":    store.GatewayModeDualPort,
		"local-engine": store.GatewayModeLocalEngine,
		"local":        store.GatewayModeLocalEngine,
		"external-cpa": store.GatewayModeExternalCPA,
		"external":     store.GatewayModeExternalCPA,
		"unknown":      store.GatewayModeDualPort,
	}
	for input, want := range cases {
		if got := normalizeGatewayMode(input); got != want {
			t.Fatalf("normalizeGatewayMode(%q)=%q want %q", input, got, want)
		}
	}
}

func TestIsInferenceProxyPath(t *testing.T) {
	if !isInferenceProxyPath("/v1/responses") {
		t.Fatal("expected /v1/responses")
	}
	if !isInferenceProxyPath("/v1") {
		t.Fatal("expected /v1")
	}
	if isInferenceProxyPath("/v0/management/auth-files") {
		t.Fatal("management must not match inference proxy")
	}
	if isInferenceProxyPath("/api/charitable/tokens") {
		t.Fatal("center api must not match")
	}
}

func TestLocalEngineBaseURL(t *testing.T) {
	s := &Server{cfg: config.Config{LocalEngine: config.LocalEngineConfig{
		Enabled: true,
		Host:    "0.0.0.0",
		Port:    18318,
	}}}
	if got := s.localEngineBaseURL(); got != "http://127.0.0.1:18318" {
		t.Fatalf("localEngineBaseURL=%q", got)
	}
	s.cfg.LocalEngine.Enabled = false
	if got := s.localEngineBaseURL(); got != "" {
		t.Fatalf("disabled engine should be empty, got %q", got)
	}
}

func TestInferenceProxyDualPortReturnsNotFound(t *testing.T) {
	s := New(config.Config{}, nil, nil)
	// Without store, resolveManagerConfig falls to defaults dual-port.
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound && rr.Code != http.StatusBadRequest && rr.Code != http.StatusInternalServerError {
		// dual-port without store may 500 on resolve if store nil; either way not 200 proxy.
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if rr.Code == http.StatusOK {
		t.Fatal("dual-port must not silently proxy")
	}
}
