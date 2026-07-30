package charitable

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/httputil"
)

type proxyTestSite struct {
	Key      string
	Name     string
	Category string
	URL      string
}

var proxyTestSites = []proxyTestSite{
	{Key: "chatgpt", Name: "ChatGPT", Category: "global_ai", URL: "https://chatgpt.com/backend-api/codex"},
	{Key: "openai", Name: "OpenAI API", Category: "global_ai", URL: "https://api.openai.com/"},
	{Key: "claude", Name: "Claude API", Category: "global_ai", URL: "https://api.anthropic.com/"},
	{Key: "xai", Name: "xAI API", Category: "global_ai", URL: "https://api.x.ai/"},
	{Key: "grok_cli", Name: "Grok CLI Proxy", Category: "global_ai", URL: "https://cli-chat-proxy.grok.com/"},
	{Key: "gemini", Name: "Gemini API", Category: "global_ai", URL: "https://generativelanguage.googleapis.com/"},
	{Key: "cloudcode", Name: "Google Cloud Code", Category: "global_ai", URL: "https://cloudcode-pa.googleapis.com/"},
	{Key: "youtube", Name: "YouTube", Category: "global_web", URL: "https://www.youtube.com/"},
	{Key: "tiktok", Name: "TikTok", Category: "global_web", URL: "https://www.tiktok.com/"},
	{Key: "github", Name: "GitHub", Category: "global_web", URL: "https://github.com/"},
	{Key: "google", Name: "Google", Category: "global_web", URL: "https://www.google.com/generate_204"},
	{Key: "baidu", Name: "Baidu", Category: "mainland_china", URL: "https://www.baidu.com/"},
	{Key: "bilibili", Name: "Bilibili", Category: "mainland_china", URL: "https://www.bilibili.com/"},
	{Key: "douyin", Name: "Douyin", Category: "mainland_china", URL: "https://www.douyin.com/"},
}

type proxySiteTestResult struct {
	Key        string `json:"key"`
	Name       string `json:"name"`
	Category   string `json:"category"`
	URL        string `json:"url"`
	OK         bool   `json:"ok"`
	StatusCode int    `json:"status_code,omitempty"`
	LatencyMs  int64  `json:"latency_ms"`
	Error      string `json:"error,omitempty"`
}

type proxyConnectivityTestResult struct {
	ID        int64                 `json:"id"`
	ProxyInfo string                `json:"proxy_info,omitempty"`
	ProxyType int                   `json:"proxy_type"`
	Supported bool                  `json:"supported"`
	Error     string                `json:"error,omitempty"`
	Sites     []proxySiteTestResult `json:"sites"`
}

func (h *Handler) handleProxySiteTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) == 0 {
		writeCharitableError(w, http.StatusBadRequest, "ids_required")
		return
	}
	if len(req.IDs) > 100 {
		writeCharitableError(w, http.StatusBadRequest, "probe_limit_exceeded")
		return
	}

	proxies, err := h.store.GetProxiesByIDs(r.Context(), req.IDs)
	if err != nil {
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	byID := make(map[int64]ProxyDetail, len(proxies))
	for _, proxy := range proxies {
		byID[proxy.ID] = proxy
	}

	results := make([]proxyConnectivityTestResult, len(req.IDs))
	sem := make(chan struct{}, 12)
	var wg sync.WaitGroup
	for index, id := range req.IDs {
		proxy, ok := byID[id]
		if !ok {
			results[index] = proxyConnectivityTestResult{ID: id, Error: "proxy_not_found", Sites: []proxySiteTestResult{}}
			continue
		}
		results[index] = testProxySites(r.Context(), proxy, sem, &wg)
	}
	wg.Wait()
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"results": results})
}

func testProxySites(ctx context.Context, proxy ProxyDetail, sem chan struct{}, wg *sync.WaitGroup) proxyConnectivityTestResult {
	result := proxyConnectivityTestResult{
		ID:        proxy.ID,
		ProxyInfo: proxy.ProxyInfo,
		ProxyType: proxy.ProxyType,
		Sites:     make([]proxySiteTestResult, len(proxyTestSites)),
	}
	client, err := proxyHTTPClient(proxy.ProxyValue)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Supported = true
	for index, site := range proxyTestSites {
		index, site := index, site
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			result.Sites[index] = testSite(ctx, client, site)
		}()
	}
	return result
}

func testSite(ctx context.Context, client *http.Client, site proxyTestSite) proxySiteTestResult {
	result := proxySiteTestResult{Key: site.Key, Name: site.Name, Category: site.Category, URL: site.URL}
	requestCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, site.URL, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	req.Header.Set("User-Agent", "cpamc-proxy-connectivity-test/1.0")
	started := time.Now()
	resp, err := client.Do(req)
	result.LatencyMs = time.Since(started).Milliseconds()
	if err != nil {
		result.Error = compactProxyTestError(err)
		return result
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, 1024)
	result.OK = true
	result.StatusCode = resp.StatusCode
	return result
}

func proxyHTTPClient(rawProxy string) (*http.Client, error) {
	proxyURL, err := url.Parse(strings.TrimSpace(rawProxy))
	if err != nil || proxyURL.Scheme == "" || proxyURL.Hostname() == "" {
		return nil, errors.New("proxy_target_unavailable")
	}
	transport := &http.Transport{
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		IdleConnTimeout:       15 * time.Second,
		DisableKeepAlives:     true,
	}
	switch strings.ToLower(proxyURL.Scheme) {
	case "http", "https":
		transport.Proxy = http.ProxyURL(proxyURL)
	case "socks", "socks5", "socks5h":
		transport.DialContext = socks5DialContext(proxyURL)
	default:
		return nil, errors.New("proxy_protocol_not_supported")
	}
	return &http.Client{
		Transport: transport,
		Timeout:   12 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}, nil
}

func socks5DialContext(proxyURL *url.URL) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, _, address string) (net.Conn, error) {
		proxyAddress := proxyURL.Host
		if proxyURL.Port() == "" {
			proxyAddress = net.JoinHostPort(proxyURL.Hostname(), "1080")
		}
		dialer := net.Dialer{Timeout: 8 * time.Second}
		conn, err := dialer.DialContext(ctx, "tcp", proxyAddress)
		if err != nil {
			return nil, err
		}
		if deadline, ok := ctx.Deadline(); ok {
			_ = conn.SetDeadline(deadline)
		} else {
			_ = conn.SetDeadline(time.Now().Add(12 * time.Second))
		}
		if err := socks5Handshake(conn, proxyURL.User, address); err != nil {
			_ = conn.Close()
			return nil, err
		}
		_ = conn.SetDeadline(time.Time{})
		return conn, nil
	}
}

func socks5Handshake(conn net.Conn, userInfo *url.Userinfo, address string) error {
	methods := []byte{0x00}
	if userInfo != nil {
		methods = append(methods, 0x02)
	}
	if _, err := conn.Write(append([]byte{0x05, byte(len(methods))}, methods...)); err != nil {
		return err
	}
	response := make([]byte, 2)
	if _, err := io.ReadFull(conn, response); err != nil {
		return err
	}
	if response[0] != 0x05 || response[1] == 0xff {
		return errors.New("socks5_auth_method_unavailable")
	}
	if response[1] == 0x02 {
		if userInfo == nil {
			return errors.New("socks5_credentials_required")
		}
		username := userInfo.Username()
		password, _ := userInfo.Password()
		if len(username) > 255 || len(password) > 255 {
			return errors.New("socks5_credentials_too_long")
		}
		auth := []byte{0x01, byte(len(username))}
		auth = append(auth, username...)
		auth = append(auth, byte(len(password)))
		auth = append(auth, password...)
		if _, err := conn.Write(auth); err != nil {
			return err
		}
		if _, err := io.ReadFull(conn, response); err != nil {
			return err
		}
		if response[1] != 0x00 {
			return errors.New("socks5_auth_failed")
		}
	}

	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	port, err := net.LookupPort("tcp", portText)
	if err != nil {
		return err
	}
	request := []byte{0x05, 0x01, 0x00}
	if ip := net.ParseIP(host); ip != nil {
		if ipv4 := ip.To4(); ipv4 != nil {
			request = append(request, 0x01)
			request = append(request, ipv4...)
		} else {
			request = append(request, 0x04)
			request = append(request, ip.To16()...)
		}
	} else {
		if len(host) > 255 {
			return errors.New("socks5_host_too_long")
		}
		request = append(request, 0x03, byte(len(host)))
		request = append(request, host...)
	}
	portBytes := make([]byte, 2)
	binary.BigEndian.PutUint16(portBytes, uint16(port))
	request = append(request, portBytes...)
	if _, err := conn.Write(request); err != nil {
		return err
	}
	header := make([]byte, 4)
	if _, err := io.ReadFull(conn, header); err != nil {
		return err
	}
	if header[0] != 0x05 || header[1] != 0x00 {
		return fmt.Errorf("socks5_connect_failed_%d", header[1])
	}
	addressLength := 0
	switch header[3] {
	case 0x01:
		addressLength = 4
	case 0x04:
		addressLength = 16
	case 0x03:
		length := make([]byte, 1)
		if _, err := io.ReadFull(conn, length); err != nil {
			return err
		}
		addressLength = int(length[0])
	default:
		return errors.New("socks5_invalid_address_type")
	}
	_, err = io.CopyN(io.Discard, conn, int64(addressLength+2))
	return err
}

func compactProxyTestError(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "request_timeout"
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 300 {
		return message[:300]
	}
	return message
}
