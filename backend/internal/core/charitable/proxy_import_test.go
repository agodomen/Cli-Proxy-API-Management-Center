package charitable

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type subscriptionRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn subscriptionRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func clashSubscriptionTestClient(render func(*http.Request) string) *http.Client {
	return &http.Client{Transport: subscriptionRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(render(request))),
			Request:    request,
		}, nil
	})}
}

func TestParseProxyImportContentLinesAndBase64(t *testing.T) {
	content := "# comment\nss://example-one#node-1\n\nhttp://user:pass@example.com:8080\n"
	items, err := parseProxyImportContent(content, "personal")
	if err != nil {
		t.Fatalf("parse lines: %v", err)
	}
	if len(items) != 2 || items[0].ProxyType != ProxyTypeShadowsocks || items[1].ProxyType != ProxyTypeHTTP {
		t.Fatalf("unexpected line items: %+v", items)
	}
	if items[0].ProxyInfo != `{"privacy":"personal"}` {
		t.Fatalf("unexpected proxy info: %s", items[0].ProxyInfo)
	}

	encoded := base64.StdEncoding.EncodeToString([]byte("vless://id@example.com:443\ntrojan://password@example.net:443"))
	items, err = parseProxyImportContent(encoded, "public")
	if err != nil {
		t.Fatalf("parse base64: %v", err)
	}
	if len(items) != 2 || items[0].ProxyType != ProxyTypeVLESS || items[1].ProxyType != ProxyTypeTrojan {
		t.Fatalf("unexpected base64 items: %+v", items)
	}
}

func TestParseProxyImportContentClashYAML(t *testing.T) {
	content := `proxies:
  - name: edge-one
    type: vmess
    server: edge.example.com
    port: 443
    uuid: 12345678-1234-1234-1234-123456789abc
    tls: true
  - name: edge-two
    type: socks5
    server: socks.example.com
    port: 1080
`
	items, err := parseProxyImportContent(content, "local")
	if err != nil {
		t.Fatalf("parse clash yaml: %v", err)
	}
	if len(items) != 2 || items[0].ProxyType != ProxyTypeVMess || items[1].ProxyType != ProxyTypeSOCKS {
		t.Fatalf("unexpected clash items: %+v", items)
	}
	if items[0].Remark != "edge-one" || items[0].Param == "{}" {
		t.Fatalf("clash metadata not preserved: %+v", items[0])
	}
}

func TestProxyBatchImportSkipsDuplicateNodes(t *testing.T) {
	store := openSubscriptionTestStore(t)
	handler := NewHandler(store)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	body := `{"content":"http://user:pass@proxy.example.com:8080\nhttp://user:pass@proxy.example.com:8080","privacy":"public"}`
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(
		http.MethodPost,
		"/v0/cpamc/charitable/proxies/batch/import",
		strings.NewReader(body),
	))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	var result proxyImportResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if result.Total != 2 || result.Created != 1 || result.Skipped != 1 || result.Failed != 0 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	if len(result.Items) != 1 || result.Items[0].ID == 0 {
		t.Fatalf("resolved items = %+v, want one persisted node", result.Items)
	}
}

func TestResolveClashSubscriptionURLsImportsAndReturnsExistingNodes(t *testing.T) {
	store := openSubscriptionTestStore(t)
	handler := NewHandler(store)
	handler.subscriptionClient = clashSubscriptionTestClient(func(_ *http.Request) string {
		return "proxies:\n  - name: imported-edge\n    type: http\n    server: edge.example.com\n    port: 8080\n"
	})
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	body := `{"urls":["https://subscriptions.example/clash"],"privacy":"public"}`

	resolve := func() proxyURLResolveResult {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(
			http.MethodPost,
			"/v0/cpamc/charitable/proxies/subscriptions/resolve-urls",
			strings.NewReader(body),
		))
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
		}
		var result proxyURLResolveResult
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatalf("decode result: %v", err)
		}
		return result
	}

	first := resolve()
	if first.Created != 1 || first.Skipped != 0 || len(first.Items) != 1 {
		t.Fatalf("first resolve = %+v", first)
	}
	second := resolve()
	if second.Created != 0 || second.Skipped != 1 || len(second.Items) != 1 || second.Items[0].ID != first.Items[0].ID {
		t.Fatalf("second resolve = %+v, first = %+v", second, first)
	}
}

func TestListProxiesUsesMultiTermFuzzySearch(t *testing.T) {
	store := openSubscriptionTestStore(t)
	for _, item := range []ProxyDetail{
		{ProxyValue: "http://alpha.example.com:8080", ProxyType: ProxyTypeHTTP, ProxyInfo: "europe edge", Status: 1, Param: "{}", Remark: "primary alpha"},
		{ProxyValue: "http://beta.example.com:8080", ProxyType: ProxyTypeHTTP, ProxyInfo: "asia edge", Status: 1, Param: "{}", Remark: "secondary beta"},
	} {
		item := item
		if err := store.CreateProxy(context.Background(), &item); err != nil {
			t.Fatalf("create proxy: %v", err)
		}
	}

	result, err := store.ListProxies(context.Background(), ListParams{Search: "alpha europe", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("fuzzy search: %v", err)
	}
	if result.TotalItems != 1 || result.Items[0].Remark != "primary alpha" {
		t.Fatalf("fuzzy result = %+v", result)
	}
	result, err = store.ListProxies(context.Background(), ListParams{Search: "%", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("literal wildcard search: %v", err)
	}
	if result.TotalItems != 0 {
		t.Fatalf("literal wildcard matched %d rows, want 0", result.TotalItems)
	}
}
