// Package proxy defines the shared proxy/accelerator types used across all
// backend business modules (plugin-store, model-prices, future consumers).
//
// The canonical type definitions live here in core/proxy so that community
// config code (internal/config) can re-export them without owning the logic.
// When community code is overwritten by upstream sync, the core types remain.
package proxy

import "strings"

// Proxy status values (selection is encoded by status only).
const (
	// StatusNone means no dedicated proxy for this scope.
	StatusNone = 0
	// StatusCustom means use URL as a traditional socks/http/https proxy.
	StatusCustom = 1
	// StatusSystem means reuse the global config proxy-url.
	StatusSystem = 2
	// StatusAccelerator means rewrite remote resource URLs with Accelerator as a web accelerator prefix.
	StatusAccelerator = 3
)

// ScopedProxyConfig is the generic per-module proxy/accelerator configuration.
//
// Status:
//   - 0 (none): direct connection, no proxy or accelerator.
//   - 1 (custom): use URL as a traditional socks/http/https proxy.
//   - 2 (system): reuse the global config proxy-url.
//   - 3 (accelerator): rewrite remote resource URLs as Accelerator + original URL.
type ScopedProxyConfig struct {
	// URL is the last custom proxy URL (traditional proxy only).
	URL string `yaml:"url,omitempty" json:"url"`
	// Accelerator is the web accelerator base used when status=3.
	Accelerator string `yaml:"accelerator,omitempty" json:"accelerator"`
	// Status is 0=none, 1=custom, 2=system, 3=accelerator.
	Status int `yaml:"status,omitempty" json:"status"`
}

// NormalizeScopedProxyConfig returns a normalized scoped-proxy setting.
// Status is clamped to 0 (none), 1 (custom), 2 (system), or 3 (accelerator).
// URL and Accelerator are trimmed; both are always retained so mode switches
// do not lose previously entered values.
func NormalizeScopedProxyConfig(raw ScopedProxyConfig) ScopedProxyConfig {
	out := ScopedProxyConfig{
		URL:         strings.TrimSpace(raw.URL),
		Accelerator: strings.TrimSpace(raw.Accelerator),
	}
	switch raw.Status {
	case StatusCustom:
		out.Status = StatusCustom
	case StatusSystem:
		out.Status = StatusSystem
	case StatusAccelerator:
		out.Status = StatusAccelerator
	default:
		out.Status = StatusNone
	}
	return out
}
