package proxy

import (
	"strings"
	"testing"
)

func TestNormalizeAcceleratorBase(t *testing.T) {
	t.Parallel()

	base, err := NormalizeAcceleratorBase("https://gh-proxy.com")
	if err != nil {
		t.Fatalf("NormalizeAcceleratorBase() error = %v", err)
	}
	if base != "https://gh-proxy.com/" {
		t.Fatalf("NormalizeAcceleratorBase() = %q", base)
	}
}

func TestNormalizeAcceleratorBaseRejectsInvalid(t *testing.T) {
	t.Parallel()

	cases := []struct {
		input string
	}{
		{"ftp://gh-proxy.com"},
		{"https://user:pass@gh-proxy.com"},
		{"https://gh-proxy.com?q=1"},
		{"https://gh-proxy.com#frag"},
		{""},
	}
	for _, tc := range cases {
		if _, err := NormalizeAcceleratorBase(tc.input); err == nil {
			t.Fatalf("NormalizeAcceleratorBase(%q) should error", tc.input)
		}
	}
}

func TestApplyAcceleratorBasePreservesTokenQuery(t *testing.T) {
	t.Parallel()

	rewritten, err := ApplyAcceleratorBase(
		"https://gh-proxy.com",
		"https://objects.githubusercontent.com/github-production-release-asset/file.zip?token=temp-github-token",
	)
	if err != nil {
		t.Fatalf("ApplyAcceleratorBase() error = %v", err)
	}
	want := "https://gh-proxy.com/https://objects.githubusercontent.com/github-production-release-asset/file.zip?token=temp-github-token"
	if rewritten != want {
		t.Fatalf("ApplyAcceleratorBase() = %q, want %q", rewritten, want)
	}
	if !strings.Contains(rewritten, "token=temp-github-token") {
		t.Fatalf("rewritten URL lost token query: %q", rewritten)
	}
}

func TestApplyAcceleratorBaseSkipsGitHubAPI(t *testing.T) {
	t.Parallel()

	apiURL := "https://api.github.com/repos/owner/repo/releases/latest"
	rewritten, err := ApplyAcceleratorBase("https://gh-proxy.com", apiURL)
	if err != nil {
		t.Fatalf("ApplyAcceleratorBase() error = %v", err)
	}
	if rewritten != apiURL {
		t.Fatalf("ApplyAcceleratorBase() = %q, want original API URL", rewritten)
	}
	if !IsGitHubAcceleratorURL("https://github.com/owner/repo/releases/download/v1/x.zip") {
		t.Fatal("expected github.com release URL to be accelerator-eligible")
	}
	if IsGitHubAcceleratorURL(apiURL) {
		t.Fatal("api.github.com must not be accelerator-eligible")
	}
}

func TestResolveStatusNone(t *testing.T) {
	t.Parallel()

	res := Resolve("", ScopedProxyConfig{Status: StatusNone})
	if res.ProxyURL != "" || res.AcceleratorBase != "" {
		t.Fatalf("Resolve(none) = %#v, want empty", res)
	}
}

func TestResolveStatusCustom(t *testing.T) {
	t.Parallel()

	res := Resolve("", ScopedProxyConfig{Status: StatusCustom, URL: "http://proxy:1080"})
	if res.ProxyURL != "http://proxy:1080" {
		t.Fatalf("Resolve(custom) ProxyURL = %q", res.ProxyURL)
	}
	if res.AcceleratorBase != "" {
		t.Fatalf("Resolve(custom) AcceleratorBase = %q, want empty", res.AcceleratorBase)
	}
}

func TestResolveStatusSystem(t *testing.T) {
	t.Parallel()

	res := Resolve("http://global:8080", ScopedProxyConfig{Status: StatusSystem})
	if res.ProxyURL != "http://global:8080" {
		t.Fatalf("Resolve(system) ProxyURL = %q", res.ProxyURL)
	}
}

func TestResolveStatusAccelerator(t *testing.T) {
	t.Parallel()

	res := Resolve("", ScopedProxyConfig{Status: StatusAccelerator, Accelerator: "https://gh-proxy.com/"})
	if res.AcceleratorBase != "https://gh-proxy.com/" {
		t.Fatalf("Resolve(accelerator) AcceleratorBase = %q", res.AcceleratorBase)
	}
	if res.ProxyURL != "" {
		t.Fatalf("Resolve(accelerator) ProxyURL = %q, want empty", res.ProxyURL)
	}
}

func TestNormalizeScopedProxyConfigClampsStatus(t *testing.T) {
	t.Parallel()

	normalized := NormalizeScopedProxyConfig(ScopedProxyConfig{Status: 99, URL: " http://x "})
	if normalized.Status != StatusNone {
		t.Fatalf("NormalizeScopedProxyConfig() Status = %d, want %d", normalized.Status, StatusNone)
	}
	if normalized.URL != "http://x" {
		t.Fatalf("NormalizeScopedProxyConfig() URL = %q", normalized.URL)
	}
}
