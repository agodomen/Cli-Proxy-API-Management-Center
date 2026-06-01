package charitable

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
)

func TestProxyTestSitesContainRequiredEndpoints(t *testing.T) {
	required := []string{
		"https://cli-chat-proxy.grok.com/",
		"https://api.x.ai/",
		"https://cloudcode-pa.googleapis.com/",
		"https://generativelanguage.googleapis.com/",
		"https://api.anthropic.com/",
		"https://api.openai.com/",
		"https://chatgpt.com/backend-api/codex",
	}
	available := make(map[string]bool, len(proxyTestSites))
	for _, site := range proxyTestSites {
		available[site.URL] = true
	}
	for _, endpoint := range required {
		if !available[endpoint] {
			t.Fatalf("required proxy test endpoint missing: %s", endpoint)
		}
	}
}

func TestProxyHTTPClientConfiguresHTTPProxy(t *testing.T) {
	client, err := proxyHTTPClient("http://user:pass@proxy.example:8080")
	if err != nil {
		t.Fatalf("proxyHTTPClient: %v", err)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy == nil {
		t.Fatal("HTTP proxy transport is not configured")
	}
	target, _ := url.Parse("https://target.example/test")
	proxyURL, err := transport.Proxy(&http.Request{URL: target})
	if err != nil {
		t.Fatalf("resolve proxy: %v", err)
	}
	if proxyURL.String() != "http://user:pass@proxy.example:8080" {
		t.Fatalf("proxy URL = %q", proxyURL.String())
	}
}

func TestProxyHTTPClientProtocolSupport(t *testing.T) {
	for _, raw := range []string{
		"http://127.0.0.1:8080",
		"https://127.0.0.1:8443",
		"socks5://127.0.0.1:1080",
		"socks://user:pass@127.0.0.1:1080",
	} {
		if _, err := proxyHTTPClient(raw); err != nil {
			t.Errorf("proxyHTTPClient(%q): %v", raw, err)
		}
	}
	for _, raw := range []string{"", "not-a-uri", "vmess://token@example.com:443", "trojan://token@example.com:443"} {
		if _, err := proxyHTTPClient(raw); err == nil {
			t.Errorf("proxyHTTPClient(%q) unexpectedly succeeded", raw)
		}
	}
}

func TestProxySiteTestMarksUnsupportedProtocol(t *testing.T) {
	var wg sync.WaitGroup
	result := testProxySites(context.Background(), ProxyDetail{
		ID:         42,
		ProxyType:  ProxyTypeTrojan,
		ProxyValue: "trojan://token@example.com:443",
	}, make(chan struct{}, 1), &wg)
	wg.Wait()
	if result.Supported {
		t.Fatal("unsupported proxy marked as supported")
	}
	if !strings.Contains(result.Error, "not_supported") {
		t.Fatalf("error = %q", result.Error)
	}
	if len(result.Sites) != len(proxyTestSites) {
		t.Fatalf("sites = %d, want %d", len(result.Sites), len(proxyTestSites))
	}
}
