package charitable

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/httputil"
	"gopkg.in/yaml.v3"
)

type proxyImportIssue struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
}

type proxyImportResult struct {
	Total   int                `json:"total"`
	Created int                `json:"created"`
	Skipped int                `json:"skipped"`
	Failed  int                `json:"failed"`
	Issues  []proxyImportIssue `json:"issues"`
	Items   []ProxyDetail      `json:"items"`
}

func (h *Handler) handleProxyBatchImport(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Content string `json:"content"`
		Privacy string `json:"privacy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	items, err := parseProxyImportContent(request.Content, request.Privacy)
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, err.Error())
		return
	}
	result := h.importProxyItems(r.Context(), items)
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) importProxyItems(ctx context.Context, items []ProxyDetail) proxyImportResult {
	result := proxyImportResult{Total: len(items), Issues: []proxyImportIssue{}, Items: []ProxyDetail{}}
	resolvedIDs := make(map[int64]struct{}, len(items))
	for index := range items {
		if err := validateProxyInput(&items[index]); err != nil {
			result.Failed++
			result.Issues = append(result.Issues, proxyImportIssue{Index: index + 1, Message: err.Error()})
			continue
		}
		existing, getErr := h.store.GetProxyByIndex(ctx, items[index].ProxyIndex)
		if getErr == nil {
			result.Skipped++
			if _, seen := resolvedIDs[existing.ID]; !seen {
				resolvedIDs[existing.ID] = struct{}{}
				result.Items = append(result.Items, existing)
			}
			continue
		}
		if getErr.Error() != "proxy_not_found" {
			result.Failed++
			result.Issues = append(result.Issues, proxyImportIssue{Index: index + 1, Message: getErr.Error()})
			continue
		}
		if err := h.store.CreateProxy(ctx, &items[index]); err != nil {
			if err.Error() == "proxy_index_conflict" {
				result.Skipped++
				existing, getErr := h.store.GetProxyByIndex(ctx, items[index].ProxyIndex)
				if getErr == nil {
					if _, seen := resolvedIDs[existing.ID]; !seen {
						resolvedIDs[existing.ID] = struct{}{}
						result.Items = append(result.Items, existing)
					}
				}
				continue
			}
			result.Failed++
			result.Issues = append(result.Issues, proxyImportIssue{Index: index + 1, Message: err.Error()})
			continue
		}
		result.Created++
		resolvedIDs[items[index].ID] = struct{}{}
		result.Items = append(result.Items, items[index])
	}
	return result
}

type proxyURLResolveIssue struct {
	URL     string `json:"url"`
	Message string `json:"message"`
}

type proxyURLResolveResult struct {
	URLs    []string               `json:"urls"`
	Items   []ProxyDetail          `json:"items"`
	Created int                    `json:"created"`
	Skipped int                    `json:"skipped"`
	Failed  int                    `json:"failed"`
	Issues  []proxyURLResolveIssue `json:"issues"`
}

func (h *Handler) handleResolveClashSubscriptionURLs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowedCharitable(w)
		return
	}
	var request struct {
		URLs    []string `json:"urls"`
		Privacy string   `json:"privacy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	urls, err := normalizeSubscriptionProxyURLs(request.URLs)
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, err.Error())
		return
	}
	result := h.resolveAndImportProxyURLs(r.Context(), urls, request.Privacy)
	if len(result.Items) == 0 {
		writeCharitableError(w, http.StatusBadGateway, "external_subscription_no_nodes")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) resolveAndImportProxyURLs(ctx context.Context, urls []string, privacy string) proxyURLResolveResult {
	result := proxyURLResolveResult{URLs: urls, Items: []ProxyDetail{}, Issues: []proxyURLResolveIssue{}}
	parsedItems := make([]ProxyDetail, 0)
	for _, sourceURL := range urls {
		items, err := h.fetchProxySubscriptionItems(ctx, sourceURL, privacy)
		if err != nil {
			result.Failed++
			result.Issues = append(result.Issues, proxyURLResolveIssue{URL: sourceURL, Message: err.Error()})
			continue
		}
		parsedItems = append(parsedItems, items...)
	}
	imported := h.importProxyItems(ctx, parsedItems)
	result.Items = imported.Items
	result.Created = imported.Created
	result.Skipped = imported.Skipped
	result.Failed += imported.Failed
	return result
}

func (h *Handler) fetchProxySubscriptionItems(ctx context.Context, sourceURL, privacy string) ([]ProxyDetail, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, errors.New("external_subscription_invalid_request")
	}
	request.Header.Set("User-Agent", "cpamc-clash-subscription/1.0")
	client := h.subscriptionClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("external_subscription_fetch_failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("external_subscription_http_%d", response.StatusCode)
	}
	const maxBodySize = 10 << 20
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxBodySize+1))
	if err != nil {
		return nil, errors.New("external_subscription_read_failed")
	}
	if len(payload) > maxBodySize {
		return nil, errors.New("external_subscription_too_large")
	}
	items, err := parseProxyImportContent(string(payload), privacy)
	if err != nil {
		return nil, errors.New("external_subscription_parse_failed")
	}
	return items, nil
}

func parseProxyImportContent(content, privacy string) ([]ProxyDetail, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errors.New("proxy_import_content_required")
	}
	privacy = strings.ToLower(strings.TrimSpace(privacy))
	if privacy != "local" && privacy != "personal" && privacy != "public" {
		privacy = "public"
	}
	proxyInfo := fmt.Sprintf(`{"privacy":%q}`, privacy)

	if nodes := parseClashImportNodes(content, proxyInfo); len(nodes) > 0 {
		if len(nodes) > 1000 {
			return nil, errors.New("proxy_import_limit_exceeded")
		}
		return nodes, nil
	}
	lines := proxyImportLines(content)
	if len(lines) == 0 {
		return nil, errors.New("proxy_import_no_nodes")
	}
	if len(lines) > 1000 {
		return nil, errors.New("proxy_import_limit_exceeded")
	}
	items := make([]ProxyDetail, 0, len(lines))
	for _, line := range lines {
		remark := ""
		if parsed, err := url.Parse(line); err == nil && parsed.Fragment != "" {
			remark = parsed.Fragment
		}
		items = append(items, ProxyDetail{
			ProxyValue: line,
			ProxyType:  DetectProxyType(line),
			ProxyInfo:  proxyInfo,
			Status:     1,
			Param:      "{}",
			Remark:     remark,
		})
	}
	return items, nil
}

func parseClashImportNodes(content, proxyInfo string) []ProxyDetail {
	var root struct {
		Proxies []map[string]any `yaml:"proxies"`
	}
	if yaml.Unmarshal([]byte(content), &root) != nil || len(root.Proxies) == 0 {
		return nil
	}
	items := make([]ProxyDetail, 0, len(root.Proxies))
	for _, node := range root.Proxies {
		typeValue, _ := node["type"].(string)
		serverValue, _ := node["server"].(string)
		typeName := strings.ToLower(strings.TrimSpace(typeValue))
		server := strings.TrimSpace(serverValue)
		port, hasPort := node["port"]
		if typeName == "" || server == "" || !hasPort || port == nil {
			continue
		}
		rawNode, err := json.Marshal(node)
		if err != nil {
			continue
		}
		rawParam, _ := json.Marshal(map[string]any{"clash": node})
		name, _ := node["name"].(string)
		items = append(items, ProxyDetail{
			ProxyType: proxyTypeFromClash(typeName),
			ProxyInfo: proxyInfo,
			Content:   string(rawNode),
			Status:    1,
			Param:     string(rawParam),
			Remark:    strings.TrimSpace(name),
		})
	}
	return items
}

func proxyImportLines(content string) []string {
	lines := make([]string, 0)
	for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.Contains(line, "://") {
			lines = append(lines, line)
		}
	}
	if len(lines) > 0 {
		return lines
	}
	if decoded, err := decodeProxyImportBase64(content); err == nil {
		for _, line := range strings.Split(string(decoded), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "://") {
				lines = append(lines, line)
			}
		}
	}
	return lines
}

func decodeProxyImportBase64(content string) ([]byte, error) {
	content = strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, content)
	for _, decoder := range []*base64.Encoding{base64.RawStdEncoding, base64.StdEncoding, base64.RawURLEncoding, base64.URLEncoding} {
		if decoded, err := decoder.DecodeString(content); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("invalid_base64")
}

func proxyTypeFromClash(value string) int {
	switch value {
	case "vmess":
		return ProxyTypeVMess
	case "vless":
		return ProxyTypeVLESS
	case "socks", "socks4", "socks5":
		return ProxyTypeSOCKS
	case "http", "https":
		return ProxyTypeHTTP
	case "trojan":
		return ProxyTypeTrojan
	case "ss":
		return ProxyTypeShadowsocks
	case "ssr":
		return ProxyTypeShadowsocksR
	case "hysteria", "hysteria2":
		return ProxyTypeHysteria
	case "tuic":
		return ProxyTypeTUIC
	case "wireguard":
		return ProxyTypeWireGuard
	default:
		return ProxyTypeUnknown
	}
}
