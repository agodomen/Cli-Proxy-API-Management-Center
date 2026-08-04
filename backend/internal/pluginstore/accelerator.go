package pluginstore

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// githubAcceleratorHosts are absolute http/https hosts whose resources can be
// fetched through a web accelerator prefix (for example https://gh-proxy.com/).
// This covers GitHub releases, raw content, archive downloads, and Gist raw
// files. GitHub REST API (api.github.com) is excluded to avoid shared-IP rate
// limits that break release metadata lookups during install.
var githubAcceleratorHosts = map[string]struct{}{
	"github.com":                                {},
	"www.github.com":                            {},
	"raw.githubusercontent.com":                 {},
	"gist.github.com":                           {},
	"gist.githubusercontent.com":                {},
	"codeload.github.com":                       {},
	"objects.githubusercontent.com":             {},
	"media.githubusercontent.com":               {},
	"cloud.githubusercontent.com":               {},
	"camo.githubusercontent.com":                {},
	"user-images.githubusercontent.com":         {},
	"private-user-images.githubusercontent.com": {},
	"release-assets.githubusercontent.com":      {},
	"github-releases.githubusercontent.com":     {},
	"github-cloud.githubusercontent.com":        {},
	"github.githubassets.com":                   {},
}

// NormalizeAcceleratorBase validates and normalizes a web accelerator base URL.
// The result always ends with a single trailing slash so callers can safely
// concatenate the original absolute resource URL.
func NormalizeAcceleratorBase(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("accelerator url is required")
	}
	parsed, errParse := url.Parse(raw)
	if errParse != nil {
		return "", fmt.Errorf("invalid accelerator url: %w", errParse)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("invalid accelerator url: scheme must be http or https")
	}
	if parsed.User != nil {
		return "", fmt.Errorf("invalid accelerator url: credentials are not allowed")
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("invalid accelerator url: host is required")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("invalid accelerator url: query and fragment are not allowed")
	}
	// Reject accidental path that already embeds a full URL; the accelerator
	// base should be a pure prefix endpoint.
	path := parsed.EscapedPath()
	if strings.Contains(path, "://") {
		return "", fmt.Errorf("invalid accelerator url: path must not embed a full URL")
	}
	parsed.Scheme = scheme
	parsed.Host = strings.ToLower(parsed.Host)
	if path == "" || path == "/" {
		parsed.Path = "/"
		parsed.RawPath = ""
	} else if !strings.HasSuffix(path, "/") {
		if parsed.RawPath != "" {
			parsed.RawPath += "/"
		} else {
			parsed.Path += "/"
		}
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

// IsGitHubAcceleratorURL reports whether requestURL points at a GitHub-hosted
// resource that can be rewritten through a web accelerator.
// api.github.com is intentionally excluded: public accelerators share egress
// IPs and commonly hit GitHub REST API secondary rate limits (403), which
// breaks release metadata lookups used by plugin install.
func IsGitHubAcceleratorURL(requestURL string) bool {
	requestURL = strings.TrimSpace(requestURL)
	if requestURL == "" {
		return false
	}
	parsed, errParse := url.Parse(requestURL)
	if errParse != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return false
	}
	if host == "api.github.com" {
		return false
	}
	if _, ok := githubAcceleratorHosts[host]; ok {
		return true
	}
	// Catch additional githubusercontent / githubassets subdomains.
	// Do not match bare api.github.com (handled above) or arbitrary *.github.com
	// API-like hosts; only www/github.com content hosts are listed explicitly.
	if strings.HasSuffix(host, ".githubusercontent.com") ||
		strings.HasSuffix(host, ".githubassets.com") {
		return true
	}
	return false
}

// ApplyAcceleratorBase rewrites GitHub resource URLs by prefixing acceleratorBase.
// Non-GitHub URLs and already-rewritten URLs are returned unchanged.
func ApplyAcceleratorBase(acceleratorBase, requestURL string) (string, error) {
	base, errBase := NormalizeAcceleratorBase(acceleratorBase)
	if errBase != nil {
		return "", errBase
	}
	requestURL = strings.TrimSpace(requestURL)
	if requestURL == "" {
		return "", fmt.Errorf("request url is required")
	}
	if strings.HasPrefix(requestURL, base) {
		return requestURL, nil
	}
	if !IsGitHubAcceleratorURL(requestURL) {
		return requestURL, nil
	}
	parsed, errParse := url.Parse(requestURL)
	if errParse != nil {
		return "", fmt.Errorf("invalid request url: %w", errParse)
	}
	if parsed.User != nil {
		// Keep auth validation elsewhere; do not send credential-bearing URLs
		// through a public web accelerator.
		return requestURL, nil
	}
	// gh-proxy style services expect the full original absolute URL after the base.
	return base + requestURL, nil
}

// AcceleratorHostFromBase returns the host of a normalized accelerator base.
// Used by tests and diagnostics.
func AcceleratorHostFromBase(acceleratorBase string) (string, error) {
	base, errBase := NormalizeAcceleratorBase(acceleratorBase)
	if errBase != nil {
		return "", errBase
	}
	parsed, errParse := url.Parse(base)
	if errParse != nil {
		return "", errParse
	}
	host, _, errSplit := net.SplitHostPort(parsed.Host)
	if errSplit != nil {
		host = parsed.Host
	}
	return strings.ToLower(host), nil
}
