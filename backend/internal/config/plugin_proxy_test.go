package config

import (
	"os"
	"path/filepath"
	"testing"
)

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
			name: "status 2 system keeps url and accelerator",
			in:   PluginProxyConfig{Status: 2, URL: " http://u:p@127.0.0.1:8080 ", Accelerator: " https://gh-proxy.com "},
			want: PluginProxyConfig{URL: "http://u:p@127.0.0.1:8080", Accelerator: "https://gh-proxy.com", Status: PluginProxyStatusSystem},
		},
		{
			name: "status 3 accelerator trims accelerator field",
			in:   PluginProxyConfig{Status: 3, Accelerator: " https://gh-proxy.com ", URL: "socks5://127.0.0.1:1080"},
			want: PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Accelerator: "https://gh-proxy.com", Status: PluginProxyStatusAccelerator},
		},
		{
			name: "invalid status clamps to none",
			in:   PluginProxyConfig{Status: 9, URL: "socks5://127.0.0.1:1080", Accelerator: "https://gh-proxy.com"},
			want: PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Accelerator: "https://gh-proxy.com", Status: PluginProxyStatusNone},
		},
		{
			name: "none retains both urls",
			in:   PluginProxyConfig{Status: 0, URL: "socks5://127.0.0.1:1080", Accelerator: "https://gh-proxy.com"},
			want: PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Accelerator: "https://gh-proxy.com", Status: PluginProxyStatusNone},
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

func TestLoadConfigNormalizesPluginProxy(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yaml")
	data := []byte("plugin-proxy:\n  url: ' socks5://127.0.0.1:1080 '\n  accelerator: ' https://gh-proxy.com '\n  status: 9\n")
	if errWrite := os.WriteFile(configPath, data, 0o600); errWrite != nil {
		t.Fatalf("WriteFile() error = %v", errWrite)
	}

	cfg, errLoad := LoadConfig(configPath)
	if errLoad != nil {
		t.Fatalf("LoadConfig() error = %v", errLoad)
	}
	want := PluginProxyConfig{
		URL:         "socks5://127.0.0.1:1080",
		Accelerator: "https://gh-proxy.com",
		Status:      PluginProxyStatusNone,
	}
	if cfg.PluginProxy != want {
		t.Fatalf("PluginProxy = %#v, want %#v", cfg.PluginProxy, want)
	}
}

func TestParseConfigBytesNormalizesPluginProxy(t *testing.T) {
	cfg, errParse := ParseConfigBytes([]byte("plugin-proxy:\n  url: ' socks5://127.0.0.1:1080 '\n  status: 1\n"))
	if errParse != nil {
		t.Fatalf("ParseConfigBytes() error = %v", errParse)
	}
	want := PluginProxyConfig{URL: "socks5://127.0.0.1:1080", Status: PluginProxyStatusCustom}
	if cfg.PluginProxy != want {
		t.Fatalf("PluginProxy = %#v, want %#v", cfg.PluginProxy, want)
	}
}

func TestEffectivePluginStoreProxyURL(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	cfg.ProxyURL = "http://system-proxy:8080"
	cfg.PluginProxy = PluginProxyConfig{Status: PluginProxyStatusNone, URL: "socks5://custom:1080", Accelerator: "https://gh-proxy.com/"}
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

	cfg.PluginProxy.Status = PluginProxyStatusAccelerator
	cfg.PluginProxy.Accelerator = "https://gh-proxy.com/"
	if got := EffectivePluginStoreProxyURL(cfg); got != "" {
		t.Fatalf("accelerator status effective proxy = %q, want empty", got)
	}

	if got := EffectivePluginStoreProxyURL(nil); got != "" {
		t.Fatalf("nil config effective = %q, want empty", got)
	}
}

func TestEffectivePluginStoreAcceleratorBase(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	cfg.ProxyURL = "http://system:1"
	cfg.PluginProxy = PluginProxyConfig{Status: PluginProxyStatusNone, URL: "socks5://custom:1080", Accelerator: "https://gh-proxy.com/"}
	if got := EffectivePluginStoreAcceleratorBase(cfg); got != "" {
		t.Fatalf("none accelerator = %q", got)
	}
	cfg.PluginProxy.Status = PluginProxyStatusCustom
	if got := EffectivePluginStoreAcceleratorBase(cfg); got != "" {
		t.Fatalf("custom accelerator = %q", got)
	}
	cfg.PluginProxy.Status = PluginProxyStatusAccelerator
	if got := EffectivePluginStoreAcceleratorBase(cfg); got != "https://gh-proxy.com/" {
		t.Fatalf("accelerator base = %q", got)
	}
	if got := EffectivePluginStoreProxyURL(cfg); got != "" {
		t.Fatalf("accelerator should not use traditional proxy, got %q", got)
	}
}
