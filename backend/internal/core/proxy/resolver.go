// Package proxy provides the unified proxy/accelerator resolution layer shared
// across all backend business modules (plugin-store, model-prices, future
// consumers).
//
// Each business module owns a ScopedProxyConfig field (defined in this package).
// This package resolves that field into a concrete HTTP client and/or
// accelerator URL, so call sites never deal with status integers or proxy
// transport plumbing.
package proxy

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/proxyutil"
)

// Resolution is the resolved result of a ScopedProxyConfig.
//
// ProxyURL is the traditional socks/http/https proxy to set on an http.Client
// (empty means no traditional proxy). AcceleratorBase is the web accelerator
// prefix for URL rewriting (empty means no rewriting). Only one of the two is
// active for a given status: none/accelerator leave ProxyURL empty; custom/
// system leave AcceleratorBase empty.
type Resolution struct {
	ProxyURL        string
	AcceleratorBase string
}

// DynamicHTTPDoer resolves the current scoped proxy for every request. This
// lets management settings take effect without rebuilding the embedded engine.
type DynamicHTTPDoer struct {
	resolve func() Resolution
}

// NewDynamicHTTPDoer creates a request client backed by a live resolver.
func NewDynamicHTTPDoer(resolve func() Resolution) *DynamicHTTPDoer {
	return &DynamicHTTPDoer{resolve: resolve}
}

// Do implements httpfetch.Doer without adding a dependency from community
// plugin-store packages back into internal/core.
func (client *DynamicHTTPDoer) Do(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	resolution := Resolution{}
	if client != nil && client.resolve != nil {
		resolution = client.resolve()
	}
	request := req.Clone(req.Context())
	if strings.TrimSpace(resolution.AcceleratorBase) != "" {
		rewritten, errRewrite := ApplyAcceleratorBase(resolution.AcceleratorBase, request.URL.String())
		if errRewrite != nil {
			return nil, errRewrite
		}
		parsed, errParse := request.URL.Parse(rewritten)
		if errParse != nil {
			return nil, errParse
		}
		request.URL = parsed
	}
	httpClient := BuildHTTPClient(resolution, 0)
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return httpClient.Do(request)
}

// Resolve resolves a ScopedProxyConfig against a global proxy URL.
// system status falls back to globalProxyURL; other statuses are self-contained.
func Resolve(globalProxyURL string, scoped ScopedProxyConfig) Resolution {
	normalized := NormalizeScopedProxyConfig(scoped)
	switch normalized.Status {
	case StatusSystem:
		return Resolution{ProxyURL: strings.TrimSpace(globalProxyURL)}
	case StatusCustom:
		return Resolution{ProxyURL: strings.TrimSpace(normalized.URL)}
	case StatusAccelerator:
		return Resolution{AcceleratorBase: strings.TrimSpace(normalized.Accelerator)}
	default:
		return Resolution{}
	}
}

// BuildHTTPClient creates an *http.Client configured for the given resolution.
// timeout zero means no timeout (caller-managed, e.g. via context). When an
// accelerator base is set the returned client is a plain direct client; the
// caller is responsible for rewriting URLs via RewriteAcceleratorURL.
func BuildHTTPClient(res Resolution, timeout time.Duration) *http.Client {
	client := &http.Client{Timeout: timeout}
	if proxyURL := strings.TrimSpace(res.ProxyURL); proxyURL != "" {
		transport, _, errBuild := proxyutil.BuildHTTPTransport(proxyURL)
		if errBuild == nil && transport != nil {
			client.Transport = transport
		}
	}
	return client
}

// RewriteAcceleratorURL returns the accelerator-prefixed URL for the given
// original URL. If acceleratorBase is empty the original URL is returned as-is.
func RewriteAcceleratorURL(acceleratorBase, originalURL string) string {
	base := strings.TrimSpace(acceleratorBase)
	if base == "" {
		return originalURL
	}
	return base + "/" + originalURL
}
