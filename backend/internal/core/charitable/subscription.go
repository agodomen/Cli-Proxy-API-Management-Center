package charitable

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/httputil"
	"gopkg.in/yaml.v3"
)

func (h *Handler) handleClashSubscriptions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		result, err := h.store.ListClashSubscriptions(r.Context(), parseListParams(r))
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		if result.Items == nil {
			result.Items = []ClashSubscription{}
		}
		httpJSON(w, http.StatusOK, result)
	case http.MethodPost:
		var sub ClashSubscription
		if err := json.NewDecoder(r.Body).Decode(&sub); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateSubscriptionInput(h, r, &sub); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Tokens are always server-generated; management clients cannot choose a
		// predictable public subscription URL.
		sub.Token = ""
		if err := h.store.CreateClashSubscription(r.Context(), &sub); err != nil {
			if isSubscriptionInputError(err) {
				writeCharitableError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		httpJSON(w, http.StatusCreated, sub)
	default:
		methodNotAllowedCharitable(w)
	}
}

func (h *Handler) handleClashSubscriptionByID(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r.URL.Path, CharitableRoutesBase+"/proxies/subscriptions/")
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	switch r.Method {
	case http.MethodGet:
		sub, err := h.store.GetClashSubscription(r.Context(), id)
		if err != nil {
			writeCharitableError(w, http.StatusNotFound, "subscription_not_found")
			return
		}
		httpJSON(w, http.StatusOK, sub)
	case http.MethodPut:
		var sub ClashSubscription
		if err := json.NewDecoder(r.Body).Decode(&sub); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateSubscriptionInput(h, r, &sub); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.UpdateClashSubscription(r.Context(), id, &sub); err != nil {
			if err.Error() == "subscription_not_found" {
				writeCharitableError(w, http.StatusNotFound, "subscription_not_found")
				return
			}
			if isSubscriptionInputError(err) {
				writeCharitableError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		httpJSON(w, http.StatusOK, sub)
	case http.MethodDelete:
		if err := h.store.DeleteClashSubscription(r.Context(), id); err != nil {
			writeCharitableError(w, http.StatusNotFound, "subscription_not_found")
			return
		}
		httpJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		methodNotAllowedCharitable(w)
	}
}

func validateSubscriptionInput(h *Handler, r *http.Request, sub *ClashSubscription) error {
	if sub.SubscriptionType == 0 {
		sub.SubscriptionType = ClashSubscriptionTypeNodes
	}
	ids, err := normalizeSubscriptionProxyIDs(sub.ProxyIDs)
	if err != nil {
		return err
	}
	sub.ProxyIDs = ids
	if strings.TrimSpace(sub.EffectiveAt) == "" {
		sub.EffectiveAt = time.Now().UTC().Format("2006-01-02 15:04:05")
	} else if parsed, err := parseSubscriptionInputTime(sub.EffectiveAt); err != nil {
		return errors.New("invalid_effective_at")
	} else {
		sub.EffectiveAt = parsed
	}
	if sub.ExpiresAt != nil && strings.TrimSpace(*sub.ExpiresAt) != "" {
		parsed, err := parseSubscriptionInputTime(*sub.ExpiresAt)
		if err != nil {
			return errors.New("invalid_expires_at")
		}
		value := parsed
		sub.ExpiresAt = &value
		if value <= sub.EffectiveAt {
			return errors.New("expires_at_must_follow_effective_at")
		}
	} else {
		sub.ExpiresAt = nil
	}
	switch sub.SubscriptionType {
	case ClashSubscriptionTypeNodes:
		if len(ids) == 0 {
			return errors.New("subscription_proxy_ids_required")
		}
		sub.ProxyURLs = []string{}
		proxies, err := h.store.GetProxiesByIDs(r.Context(), ids)
		if err != nil {
			return errors.New("request_failed")
		}
		if len(proxies) != len(ids) {
			return errors.New("subscription_proxy_not_found")
		}
	case ClashSubscriptionTypeComposite:
		urls, err := normalizeSubscriptionProxyURLs(sub.ProxyURLs)
		if err != nil {
			return err
		}
		sub.ProxyURLs = urls
		sub.ProxyIDs = []int64{}
		resolved := h.resolveAndImportProxyURLs(r.Context(), urls, "public")
		if len(resolved.Items) == 0 {
			return errors.New("external_subscription_no_nodes")
		}
	default:
		return errors.New("invalid_subscription_type")
	}
	return nil
}

func normalizeSubscriptionProxyURLs(values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, errors.New("subscription_proxy_urls_required")
	}
	if len(values) > 20 {
		return nil, errors.New("subscription_proxy_url_limit_exceeded")
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
			return nil, errors.New("invalid_subscription_proxy_url")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	if len(result) == 0 {
		return nil, errors.New("subscription_proxy_urls_required")
	}
	return result, nil
}

func parseSubscriptionInputTime(value string) (string, error) {
	parsed, err := parseStoredSubscriptionTime(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format("2006-01-02 15:04:05"), nil
}

func isSubscriptionInputError(err error) bool {
	switch err.Error() {
	case "invalid_proxy_id", "subscription_proxy_limit_exceeded", "subscription_proxy_ids_required", "subscription_proxy_not_found", "invalid_subscription_type", "subscription_proxy_urls_required", "subscription_proxy_url_limit_exceeded", "invalid_subscription_proxy_url", "external_subscription_no_nodes", "invalid_effective_at", "invalid_expires_at", "expires_at_must_follow_effective_at":
		return true
	default:
		return false
	}
}

func (h *Handler) handlePublicClashSubscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowedCharitable(w)
		return
	}
	path := strings.TrimPrefix(strings.TrimRight(r.URL.Path, "/"), CharitableRoutesBase+"/subscriptions/")
	if !strings.HasSuffix(path, "/clash") {
		writeClashError(w, http.StatusNotFound, "subscription_not_found")
		return
	}
	token := strings.TrimSuffix(path, "/clash")
	token = strings.Trim(token, "/")
	if token == "" || strings.Contains(token, "/") {
		writeClashError(w, http.StatusNotFound, "subscription_not_found")
		return
	}
	sub, err := h.store.IncrementClashSubscriptionAccess(r.Context(), token, time.Now().UTC())
	if err != nil {
		switch err.Error() {
		case "subscription_not_found":
			writeClashError(w, http.StatusNotFound, "subscription_not_found")
		case "subscription_not_active":
			writeClashError(w, http.StatusForbidden, "subscription_not_active")
		case "subscription_expired":
			writeClashError(w, http.StatusGone, "subscription_expired")
		default:
			writeClashError(w, http.StatusInternalServerError, "request_failed")
		}
		return
	}
	var proxies []ProxyDetail
	if sub.SubscriptionType == ClashSubscriptionTypeComposite {
		for _, sourceURL := range sub.ProxyURLs {
			items, fetchErr := h.fetchProxySubscriptionItems(r.Context(), sourceURL, "public")
			if fetchErr == nil {
				proxies = append(proxies, items...)
			}
		}
		if len(proxies) == 0 {
			writeClashError(w, http.StatusBadGateway, "external_subscription_unavailable")
			return
		}
	} else {
		proxies, err = h.store.GetProxiesByIDs(r.Context(), sub.ProxyIDs)
		if err != nil {
			writeClashError(w, http.StatusInternalServerError, "request_failed")
			return
		}
	}
	config := buildClashConfig(proxies)
	payload, err := yaml.Marshal(config)
	if err != nil {
		writeClashError(w, http.StatusInternalServerError, "clash_render_failed")
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="clash-subscription.yaml"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

func buildClashConfig(proxies []ProxyDetail) map[string]any {
	nodes := make([]map[string]any, 0, len(proxies))
	names := make(map[string]struct{}, len(proxies))
	for _, item := range proxies {
		if item.Status != 1 {
			continue
		}
		node, ok := clashNodeFromProxy(item)
		if !ok {
			continue
		}
		baseName := fmt.Sprint(node["name"])
		name := baseName
		for suffix := 2; ; suffix++ {
			if _, exists := names[name]; !exists {
				break
			}
			name = fmt.Sprintf("%s-%d", baseName, suffix)
		}
		node["name"] = name
		names[name] = struct{}{}
		nodes = append(nodes, node)
	}
	nodeNames := make([]string, 0, len(nodes))
	for _, node := range nodes {
		nodeNames = append(nodeNames, fmt.Sprint(node["name"]))
	}
	group := map[string]any{"name": "节点选择", "type": "select", "proxies": nodeNames}
	if len(nodeNames) == 0 {
		group["proxies"] = []string{"DIRECT"}
	}
	return map[string]any{
		"mixed-port":   7890,
		"allow-lan":    false,
		"mode":         "rule",
		"proxies":      nodes,
		"proxy-groups": []map[string]any{group},
		"rules":        []string{"MATCH,节点选择"},
	}
}

func clashNodeFromProxy(item ProxyDetail) (map[string]any, bool) {
	var param map[string]any
	if json.Unmarshal([]byte(item.Param), &param) == nil {
		if raw, ok := param["clash"].(map[string]any); ok {
			node := make(map[string]any, len(raw)+2)
			for key, value := range raw {
				node[key] = value
			}
			if validClashNode(node) {
				name, _ := node["name"].(string)
				if strings.TrimSpace(name) == "" {
					node["name"] = proxyNodeName(item, fmt.Sprint(node["type"]), fmt.Sprint(node["server"]))
				}
				return node, true
			}
		}
	}
	return clashNodeFromURI(item)
}

func validClashNode(node map[string]any) bool {
	if strings.TrimSpace(fmt.Sprint(node["type"])) == "" || strings.TrimSpace(fmt.Sprint(node["server"])) == "" {
		return false
	}
	port, err := strconv.Atoi(fmt.Sprint(node["port"]))
	return err == nil && port > 0 && port <= 65535
}

func proxyNodeName(item ProxyDetail, kind, server string) string {
	for _, value := range []string{item.Remark, item.ProxyIndex, item.ProxyInfo} {
		if value = strings.TrimSpace(value); value != "" {
			return strings.ReplaceAll(strings.ReplaceAll(value, "\n", " "), "\r", " ")
		}
	}
	return fmt.Sprintf("%s-%d", strings.ToUpper(kind), item.ID)
}

func clashNodeFromURI(item ProxyDetail) (map[string]any, bool) {
	raw := strings.TrimSpace(item.ProxyValue)
	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "vmess://") {
		return clashVMessURI(item, raw)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, false
	}
	if strings.EqualFold(u.Scheme, "ss") && (u.Hostname() == "" || u.User == nil || u.Port() == "") {
		return clashShadowsocksRaw(item, raw)
	}
	if u.Hostname() == "" {
		return nil, false
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber <= 0 || portNumber > 65535 {
		return nil, false
	}
	name := proxyNodeName(item, u.Scheme, u.Hostname())
	base := map[string]any{"name": name, "server": u.Hostname(), "port": portNumber}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		base["type"] = "http"
		if u.Scheme == "https" {
			base["tls"] = true
		}
	case "socks", "socks4", "socks5":
		base["type"] = "socks5"
	default:
		return clashSpecialURI(u, name)
	}
	if u.User != nil {
		base["username"] = u.User.Username()
		if password, ok := u.User.Password(); ok {
			base["password"] = password
		}
	}
	return base, true
}

func clashSpecialURI(u *url.URL, name string) (map[string]any, bool) {
	switch strings.ToLower(u.Scheme) {
	case "trojan":
		if u.User == nil {
			return nil, false
		}
		password := u.User.Username()
		return map[string]any{"name": name, "type": "trojan", "server": u.Hostname(), "port": portFromURL(u), "password": password, "sni": u.Query().Get("sni")}, true
	case "vless":
		if u.User == nil {
			return nil, false
		}
		node := map[string]any{"name": name, "type": "vless", "server": u.Hostname(), "port": portFromURL(u), "uuid": u.User.Username()}
		if u.Query().Get("security") == "tls" || u.Query().Get("type") == "ws" {
			node["tls"] = true
		}
		if path := u.Query().Get("path"); path != "" {
			node["ws-opts"] = map[string]any{"path": path}
		}
		return node, true
	case "ss":
		return clashShadowsocks(u, name)
	default:
		return nil, false
	}
}

func portFromURL(u *url.URL) int {
	port, _ := strconv.Atoi(u.Port())
	if port <= 0 {
		port = 443
	}
	return port
}

func decodeBase64URL(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	for _, encoding := range []*base64.Encoding{base64.RawStdEncoding, base64.StdEncoding, base64.RawURLEncoding, base64.URLEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("invalid_base64")
}

func clashShadowsocks(u *url.URL, name string) (map[string]any, bool) {
	userinfo := u.User.String()
	if !strings.Contains(userinfo, ":") {
		if decoded, err := decodeBase64URL(userinfo); err == nil {
			userinfo = string(decoded)
		}
	}
	parts := strings.SplitN(userinfo, ":", 2)
	if len(parts) != 2 {
		return nil, false
	}
	return map[string]any{"name": name, "type": "ss", "server": u.Hostname(), "port": portFromURL(u), "cipher": parts[0], "password": parts[1]}, true
}

func clashVMessURI(item ProxyDetail, rawURI string) (map[string]any, bool) {
	payload := strings.TrimPrefix(rawURI, "vmess://")
	payload = strings.SplitN(payload, "#", 2)[0]
	decoded, err := decodeBase64URL(payload)
	if err != nil {
		return nil, false
	}
	var raw map[string]any
	if json.Unmarshal(decoded, &raw) != nil {
		return nil, false
	}
	server := strings.TrimSpace(fmt.Sprint(raw["add"]))
	node := map[string]any{
		"name":    proxyNodeName(item, "vmess", server),
		"type":    "vmess",
		"server":  server,
		"port":    raw["port"],
		"uuid":    raw["id"],
		"alterId": raw["aid"],
		"cipher":  raw["scy"],
	}
	if strings.EqualFold(fmt.Sprint(raw["tls"]), "tls") {
		node["tls"] = true
	}
	if network := strings.TrimSpace(fmt.Sprint(raw["net"])); network != "" && network != "<nil>" {
		node["network"] = network
	}
	return node, validClashNode(node)
}

func clashShadowsocksRaw(item ProxyDetail, rawURI string) (map[string]any, bool) {
	payload := strings.TrimPrefix(rawURI, "ss://")
	payload = strings.SplitN(payload, "#", 2)[0]
	decoded, err := decodeBase64URL(payload)
	if err != nil {
		return nil, false
	}
	credentialsAndHost := string(decoded)
	at := strings.LastIndex(credentialsAndHost, "@")
	if at <= 0 || at == len(credentialsAndHost)-1 {
		return nil, false
	}
	credentials := strings.SplitN(credentialsAndHost[:at], ":", 2)
	host, portText, err := net.SplitHostPort(credentialsAndHost[at+1:])
	if len(credentials) != 2 || err != nil {
		return nil, false
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 {
		return nil, false
	}
	return map[string]any{
		"name":     proxyNodeName(item, "ss", host),
		"type":     "ss",
		"server":   host,
		"port":     port,
		"cipher":   credentials[0],
		"password": credentials[1],
	}, true
}

func httpJSON(w http.ResponseWriter, status int, value any) {
	httputil.WriteJSON(w, status, value)
}

func methodNotAllowedCharitable(w http.ResponseWriter) {
	httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
}

func writeClashError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(code))
}
