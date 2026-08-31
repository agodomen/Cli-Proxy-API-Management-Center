package charitable

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	corestore "github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func openSubscriptionTestStore(t *testing.T) *CharitableStore {
	t.Helper()
	db, err := corestore.Open(t.TempDir() + "/subscription.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewCharitableStore(db.DB())
}

func TestClashNodeFromEncodedURIs(t *testing.T) {
	vmessJSON := `{"v":"2","ps":"encoded-node","add":"vmess.example.com","port":"443","id":"12345678-1234-1234-1234-123456789abc","aid":"0","scy":"auto","net":"ws","tls":"tls"}`
	vmessURI := "vmess://" + base64.RawStdEncoding.EncodeToString([]byte(vmessJSON))
	node, ok := clashNodeFromURI(ProxyDetail{ID: 1, ProxyValue: vmessURI, Remark: "vmess-node"})
	if !ok || node["type"] != "vmess" || node["server"] != "vmess.example.com" {
		t.Fatalf("unexpected vmess node: ok=%v node=%+v", ok, node)
	}

	ssPayload := base64.RawStdEncoding.EncodeToString([]byte("aes-256-gcm:secret@ss.example.com:8388"))
	node, ok = clashNodeFromURI(ProxyDetail{ID: 2, ProxyValue: "ss://" + ssPayload, Remark: "ss-node"})
	if !ok || node["type"] != "ss" || node["server"] != "ss.example.com" || node["port"] != 8388 {
		t.Fatalf("unexpected shadowsocks node: ok=%v node=%+v", ok, node)
	}
}

func createSubscriptionTestProxy(t *testing.T, store *CharitableStore) ProxyDetail {
	t.Helper()
	proxy := ProxyDetail{
		ProxyValue: "http://alice:secret@proxy.example.com:8080",
		ProxyType:  ProxyTypeHTTP,
		ProxyInfo:  `{"privacy":"personal"}`,
		Status:     1,
		Param:      `{"clash":{"type":"http","server":"proxy.example.com","port":8080,"username":"alice","password":"secret"}}`,
		Remark:     "test-node",
	}
	if err := store.CreateProxy(context.Background(), &proxy); err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	return proxy
}

func TestClashSubscriptionCRUDAndPublicFeed(t *testing.T) {
	store := openSubscriptionTestStore(t)
	proxy := createSubscriptionTestProxy(t, store)
	now := time.Now().UTC()
	effective := now.Add(-time.Hour).Format("2006-01-02 15:04:05")
	expires := now.Add(time.Hour).Format("2006-01-02 15:04:05")
	sub := ClashSubscription{ProxyIDs: []int64{proxy.ID}, EffectiveAt: effective, ExpiresAt: &expires}
	if err := store.CreateClashSubscription(context.Background(), &sub); err != nil {
		t.Fatalf("create subscription: %v", err)
	}
	if len(sub.Token) != 48 {
		t.Fatalf("token length = %d, want 48", len(sub.Token))
	}

	handler := NewHandler(store)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	req := httptest.NewRequest(http.MethodGet, "/v0/cpamc/charitable/subscriptions/"+sub.Token+"/clash", nil)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("feed status = %d, body=%s", res.Code, res.Body.String())
	}
	for _, want := range []string{"proxies:", "name: test-node", "server: proxy.example.com", "MATCH,节点选择"} {
		if !strings.Contains(res.Body.String(), want) {
			t.Fatalf("feed missing %q:\n%s", want, res.Body.String())
		}
	}
	got, err := store.GetClashSubscription(context.Background(), sub.ID)
	if err != nil {
		t.Fatalf("get subscription: %v", err)
	}
	if got.AccessCount != 1 {
		t.Fatalf("access count = %d, want 1", got.AccessCount)
	}

	updatedExpiry := now.Add(2 * time.Hour).Format("2006-01-02 15:04:05")
	updated := ClashSubscription{ProxyIDs: []int64{proxy.ID}, EffectiveAt: effective, ExpiresAt: &updatedExpiry}
	if err := store.UpdateClashSubscription(context.Background(), sub.ID, &updated); err != nil {
		t.Fatalf("update subscription: %v", err)
	}
	if updated.AccessCount != 1 || updated.Token != sub.Token {
		t.Fatalf("update lost managed fields: %+v", updated)
	}
	if err := store.DeleteClashSubscription(context.Background(), sub.ID); err != nil {
		t.Fatalf("delete subscription: %v", err)
	}
}

func TestPublicClashSubscriptionConfirmsTimeWindow(t *testing.T) {
	store := openSubscriptionTestStore(t)
	proxy := createSubscriptionTestProxy(t, store)
	handler := NewHandler(store)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	now := time.Now().UTC()

	future := now.Add(time.Hour).Format("2006-01-02 15:04:05")
	sub := ClashSubscription{ProxyIDs: []int64{proxy.ID}, EffectiveAt: future}
	if err := store.CreateClashSubscription(context.Background(), &sub); err != nil {
		t.Fatalf("create future subscription: %v", err)
	}
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/v0/cpamc/charitable/subscriptions/"+sub.Token+"/clash", nil))
	if res.Code != http.StatusForbidden {
		t.Fatalf("future subscription status = %d, want 403", res.Code)
	}

	past := now.Add(-2 * time.Hour).Format("2006-01-02 15:04:05")
	expired := now.Add(-time.Hour).Format("2006-01-02 15:04:05")
	sub = ClashSubscription{ProxyIDs: []int64{proxy.ID}, EffectiveAt: past, ExpiresAt: &expired}
	if err := store.CreateClashSubscription(context.Background(), &sub); err != nil {
		t.Fatalf("create expired subscription: %v", err)
	}
	res = httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/v0/cpamc/charitable/subscriptions/"+sub.Token+"/clash", nil))
	if res.Code != http.StatusGone {
		t.Fatalf("expired subscription status = %d, want 410", res.Code)
	}
}

func TestSubscriptionTypeValidation(t *testing.T) {
	store := openSubscriptionTestStore(t)
	handler := NewHandler(store)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	for _, body := range []string{
		`{"subscription_type":2,"proxy_ids":[],"effective_at":"2026-08-18T00:00:00Z"}`,
		`{"subscription_type":3,"proxy_urls":[],"effective_at":"2026-08-18T00:00:00Z"}`,
		`{"subscription_type":4,"proxy_ids":[1],"effective_at":"2026-08-18T00:00:00Z"}`,
	} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v0/cpamc/charitable/proxies/subscriptions", strings.NewReader(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %s returned %d, want 400: %s", body, response.Code, response.Body.String())
		}
	}
}

func TestCompositeSubscriptionImportsAndCombinesMultipleClashURLs(t *testing.T) {
	store := openSubscriptionTestStore(t)
	handler := NewHandler(store)
	handler.subscriptionClient = clashSubscriptionTestClient(func(r *http.Request) string {
		server := "edge-one.example.com"
		if r.URL.Path == "/two" {
			server = "edge-two.example.com"
		}
		return "proxies:\n  - name: shared-edge\n    type: http\n    server: " + server + "\n    port: 8080\n"
	})
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	payload, err := json.Marshal(ClashSubscription{
		SubscriptionType: ClashSubscriptionTypeComposite,
		ProxyURLs:        []string{"https://subscriptions.example/one", "https://subscriptions.example/two"},
		EffectiveAt:      time.Now().UTC().Add(-time.Minute).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("marshal subscription: %v", err)
	}
	createResponse := httptest.NewRecorder()
	mux.ServeHTTP(createResponse, httptest.NewRequest(http.MethodPost, "/v0/cpamc/charitable/proxies/subscriptions", strings.NewReader(string(payload))))
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body=%s", createResponse.Code, createResponse.Body.String())
	}
	var sub ClashSubscription
	if err := json.Unmarshal(createResponse.Body.Bytes(), &sub); err != nil {
		t.Fatalf("decode subscription: %v", err)
	}
	if sub.SubscriptionType != ClashSubscriptionTypeComposite || len(sub.ProxyURLs) != 2 || len(sub.ProxyIDs) != 0 {
		t.Fatalf("unexpected composite subscription: %+v", sub)
	}
	proxies, err := store.ListProxies(context.Background(), ListParams{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("list imported proxies: %v", err)
	}
	if proxies.TotalItems != 2 {
		t.Fatalf("imported proxy count = %d, want 2", proxies.TotalItems)
	}

	feedResponse := httptest.NewRecorder()
	mux.ServeHTTP(feedResponse, httptest.NewRequest(http.MethodGet, "/v0/cpamc/charitable/subscriptions/"+sub.Token+"/clash", nil))
	if feedResponse.Code != http.StatusOK {
		t.Fatalf("feed status = %d, body=%s", feedResponse.Code, feedResponse.Body.String())
	}
	for _, want := range []string{"server: edge-one.example.com", "server: edge-two.example.com", "name: shared-edge-2"} {
		if !strings.Contains(feedResponse.Body.String(), want) {
			t.Fatalf("composite feed missing %q:\n%s", want, feedResponse.Body.String())
		}
	}
}
