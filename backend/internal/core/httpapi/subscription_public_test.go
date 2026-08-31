package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/charitable"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/collector"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func TestPublicClashSubscriptionRequestScope(t *testing.T) {
	token := "0123456789abcdef0123456789abcdef0123456789abcdef"
	for _, path := range []string{
		"/v0/cpamc/charitable/subscriptions/" + token + "/clash",
		"/v0/cpamc/charitable/subscriptions/" + token + "/clash/",
	} {
		if !isPublicClashSubscriptionRequest(httptest.NewRequest(http.MethodGet, path, nil)) {
			t.Fatalf("expected public GET path: %s", path)
		}
	}
	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v0/cpamc/charitable/subscriptions/" + token + "/clash"},
		{http.MethodGet, "/v0/cpamc/charitable/subscriptions/short/clash"},
		{http.MethodGet, "/v0/cpamc/charitable/proxies/subscriptions"},
		{http.MethodGet, "/v0/cpamc/charitable/subscriptions/" + token + "/other"},
	} {
		if isPublicClashSubscriptionRequest(httptest.NewRequest(tc.method, tc.path, nil)) {
			t.Fatalf("unexpected public request: %s %s", tc.method, tc.path)
		}
	}
}

func TestPublicClashSubscriptionBypassesOnlyManagementAuthentication(t *testing.T) {
	cfg := config.Config{DBPath: filepath.Join(t.TempDir(), "subscription.sqlite"), CORSOrigins: []string{"*"}}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.SaveSetup(context.Background(), store.Setup{
		CPAUpstreamURL: "http://127.0.0.1:18318",
		ManagementKey:  "management-key",
	}); err != nil {
		t.Fatalf("save setup: %v", err)
	}
	charitableStore := charitable.NewCharitableStore(db.DB())
	proxy := charitable.ProxyDetail{
		ProxyValue: "http://proxy.example.com:8080",
		ProxyType:  charitable.ProxyTypeHTTP,
		ProxyInfo:  `{"privacy":"public"}`,
		Status:     1,
		Param:      `{"clash":{"name":"edge","type":"http","server":"proxy.example.com","port":8080}}`,
	}
	if err := charitableStore.CreateProxy(context.Background(), &proxy); err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	sub := charitable.ClashSubscription{
		ProxyIDs:    []int64{proxy.ID},
		EffectiveAt: time.Now().UTC().Add(-time.Minute).Format("2006-01-02 15:04:05"),
	}
	if err := charitableStore.CreateClashSubscription(context.Background(), &sub); err != nil {
		t.Fatalf("create subscription: %v", err)
	}

	handler := New(cfg, db, collector.NewManager(cfg, db)).Handler()
	publicResponse := httptest.NewRecorder()
	handler.ServeHTTP(publicResponse, httptest.NewRequest(
		http.MethodGet,
		"/v0/cpamc/charitable/subscriptions/"+sub.Token+"/clash",
		nil,
	))
	if publicResponse.Code != http.StatusOK {
		t.Fatalf("public feed status = %d, body=%s", publicResponse.Code, publicResponse.Body.String())
	}

	adminResponse := httptest.NewRecorder()
	handler.ServeHTTP(adminResponse, httptest.NewRequest(http.MethodGet, "/v0/cpamc/charitable/proxies/subscriptions", nil))
	if adminResponse.Code != http.StatusUnauthorized {
		t.Fatalf("admin route without key status = %d, want 401", adminResponse.Code)
	}
}
