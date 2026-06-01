package config

import "testing"

func TestNormalizePluginProxyConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   PluginProxyConfig
		want PluginProxyConfig
	}{
		{
			name: "empty defaults to none",
			in:   PluginProxyConfig{},
			want: PluginProxyConfig{Status: PluginProxyStatusNone},
		},
		{
			name: "status 1 custom trims url",
			in:   PluginProxyConfig{Status: 1, URL: " socks5://127.0.0.1:1080 "},
			want: PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Status: PluginProxyStatusCustom},
		},
		{
			name: "status 2 system keeps url",
			in:   PluginProxyConfig{Status: 2, URL: " http://u:p@127.0.0.1:8080 "},
			want: PluginProxyConfig{URL: "http://u:p@127.0.0.1:8080", Status: PluginProxyStatusSystem},
		},
		{
			name: "invalid status clamps to none",
			in:   PluginProxyConfig{Status: 9, URL: "socks5://127.0.0.1:1080"},
			want: PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Status: PluginProxyStatusNone},
		},
		{
			name: "none retains custom url",
			in:   PluginProxyConfig{Status: 0, URL: "socks5://127.0.0.1:1080"},
			want: PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Status: PluginProxyStatusNone},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := NormalizePluginProxyConfig(tt.in)
			if got != tt.want {
				t.Fatalf("NormalizePluginProxyConfig() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestEffectivePluginStoreProxyURL(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	cfg.ProxyURL = "http://system-proxy:8080"
	cfg.PluginProxy = PluginProxyConfig{Status: PluginProxyStatusNone, URL: "socks5://custom:1080"}
	if got := EffectivePluginStoreProxyURL(cfg); got != "" {
		t.Fatalf("none status effective = %q, want empty", got)
	}

	cfg.PluginProxy.Status = PluginProxyStatusSystem
	if got := EffectivePluginStoreProxyURL(cfg); got != "http://system-proxy:8080" {
		t.Fatalf("system status effective = %q, want system proxy", got)
	}

	cfg.PluginProxy.Status = PluginProxyStatusCustom
	cfg.PluginProxy.URL = "socks5://custom:1080"
	if got := EffectivePluginStoreProxyURL(cfg); got != "socks5://custom:1080" {
		t.Fatalf("custom status effective = %q, want custom proxy", got)
	}

	if got := EffectivePluginStoreProxyURL(nil); got != "" {
		t.Fatalf("nil config effective = %q, want empty", got)
	}
}
