package charitable

import (
	"context"
	"encoding/base64"
	"testing"
)

func TestDetectProxyType(t *testing.T) {
	cases := map[string]int{
		"vmess://abc":         ProxyTypeVMess,
		"vless://abc":         ProxyTypeVLESS,
		"socks5://127.0.0.1":  ProxyTypeSOCKS,
		"socks4://127.0.0.1":  ProxyTypeSOCKS,
		"socks://127.0.0.1":   ProxyTypeSOCKS,
		"http://127.0.0.1":    ProxyTypeHTTP,
		"https://127.0.0.1":   ProxyTypeHTTP,
		"trojan://abc":        ProxyTypeTrojan,
		"ss://abc":            ProxyTypeShadowsocks,
		"ssr://abc":           ProxyTypeShadowsocksR,
		"hysteria://abc":      ProxyTypeHysteria,
		"hy2://abc":           ProxyTypeHysteria,
		"tuic://abc":          ProxyTypeTUIC,
		"naive+https://abc":   ProxyTypeNaiveProxy,
		"juicity://abc":       ProxyTypeJuicity,
		"overtls://abc":       ProxyTypeOvertls,
		"wireguard://abc":     ProxyTypeWireGuard,
		"wg://abc":            ProxyTypeWireGuard,
		"freedom://abc":       ProxyTypeFreedom,
		"blackhole://abc":     ProxyTypeBlackhole,
		"dokodemo-door://abc": ProxyTypeDokodemoDoor,
		"unknown://abc":       ProxyTypeUnknown,
	}
	for input, want := range cases {
		if got := DetectProxyType(input); got != want {
			t.Fatalf("DetectProxyType(%q) = %d, want %d", input, got, want)
		}
	}
}

func TestProxyCRUDUsesProxyNativeFields(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	proxy := &ProxyDetail{
		ProxyValue: "socks5://user:pass@127.0.0.1:1080",
		ProxyInfo:  "local socks",
		// Unknown means auto-detect from proxy_value at persistence time.
		ProxyType: ProxyTypeUnknown,
		Status:    1,
		Priority:  10,
		Param:     "{}",
	}
	if err := s.CreateProxy(ctx, proxy); err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	if proxy.ID == 0 || proxy.ProxyIndex == "" {
		t.Fatalf("expected proxy ID and index, got %+v", proxy)
	}
	if proxy.ProxyType != ProxyTypeSOCKS {
		t.Fatalf("proxy type = %d, want SOCKS", proxy.ProxyType)
	}

	got, err := s.GetProxy(ctx, proxy.ID)
	if err != nil {
		t.Fatalf("get proxy: %v", err)
	}
	if got.ProxyValue != proxy.ProxyValue || got.ProxyInfo != "local socks" {
		t.Fatalf("got proxy = %+v", got)
	}

	result, err := s.ListProxies(ctx, ListParams{ProxyType: &proxy.ProxyType})
	if err != nil {
		t.Fatalf("list proxies: %v", err)
	}
	if result.TotalItems != 1 || len(result.Items) != 1 {
		t.Fatalf("unexpected list result %+v", result)
	}
}

func TestProxyProbeTarget(t *testing.T) {
	vmessPayload := base64.RawStdEncoding.EncodeToString([]byte(`{"add":"vmess.example.com","port":"8443"}`))
	tests := []struct {
		name    string
		value   string
		want    string
		wantErr string
	}{
		{name: "http default port", value: "http://proxy.example.com", want: "proxy.example.com:80"},
		{name: "https default port", value: "https://proxy.example.com", want: "proxy.example.com:443"},
		{name: "socks explicit port", value: "socks5://user:pass@127.0.0.1:1080", want: "127.0.0.1:1080"},
		{name: "ipv6", value: "trojan://token@[2001:db8::1]:9443", want: "[2001:db8::1]:9443"},
		{name: "vmess json", value: "vmess://" + vmessPayload, want: "vmess.example.com:8443"},
		{name: "missing port", value: "vless://token@proxy.example.com", wantErr: "proxy_port_unavailable"},
		{name: "unprobeable", value: "blackhole://local", wantErr: "proxy_target_unavailable"},
		{name: "invalid", value: "not-a-proxy-uri", wantErr: "proxy_target_unavailable"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := proxyProbeTarget(tt.value)
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("proxyProbeTarget(%q) error = %v, want %q", tt.value, err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("proxyProbeTarget(%q): %v", tt.value, err)
			}
			if got != tt.want {
				t.Fatalf("proxyProbeTarget(%q) = %q, want %q", tt.value, got, tt.want)
			}
		})
	}
}

func TestProxyBatchStoreOperations(t *testing.T) {
	srv := openTestDB(t)
	ctx := context.Background()
	s := NewCharitableStore(srv.DB())

	proxies := []*ProxyDetail{
		{ProxyValue: "http://one.example.com:8080", ProxyInfo: "one", Status: 1, Param: "{}"},
		{ProxyValue: "socks5://two.example.com:1080", ProxyInfo: "two", Status: 1, Param: "{}"},
		{ProxyValue: "trojan://token@three.example.com:443", ProxyInfo: "three", Status: 1, Param: "{}"},
	}
	for _, proxy := range proxies {
		if err := s.CreateProxy(ctx, proxy); err != nil {
			t.Fatalf("create proxy: %v", err)
		}
	}

	got, err := s.GetProxiesByIDs(ctx, []int64{proxies[0].ID, proxies[2].ID})
	if err != nil {
		t.Fatalf("get proxies by IDs: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d proxies, want 2", len(got))
	}

	deleted, err := s.BatchDeleteProxies(ctx, []int64{proxies[0].ID, proxies[2].ID})
	if err != nil {
		t.Fatalf("batch delete proxies: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("deleted %d proxies, want 2", deleted)
	}
	result, err := s.ListProxies(ctx, ListParams{})
	if err != nil {
		t.Fatalf("list proxies: %v", err)
	}
	if result.TotalItems != 1 || len(result.Items) != 1 || result.Items[0].ID != proxies[1].ID {
		t.Fatalf("unexpected proxies after batch delete: %+v", result)
	}
}
