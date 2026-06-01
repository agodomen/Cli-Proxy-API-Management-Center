package management

import (
	"net/http"
	"strings"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/config"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/sdk/proxyutil"
	"github.com/gin-gonic/gin"
)

// GetPluginProxy returns the dedicated plugin-store proxy setting and the
// current global proxy-url (for system-proxy UI display).
func (h *Handler) GetPluginProxy(c *gin.Context) {
	if h == nil || h.cfg == nil {
		c.JSON(http.StatusOK, gin.H{
			"plugin-proxy": config.PluginProxyConfig{Status: config.PluginProxyStatusNone},
			"proxy-url":    "",
			"effective":    "",
		})
		return
	}

	h.mu.Lock()
	pluginProxy := config.NormalizePluginProxyConfig(h.cfg.PluginProxy)
	proxyURL := strings.TrimSpace(h.cfg.ProxyURL)
	effective := config.EffectivePluginStoreProxyURL(h.cfg)
	h.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"plugin-proxy": pluginProxy,
		"proxy-url":    proxyURL,
		"effective":    effective,
	})
}

// PutPluginProxy updates plugin-proxy url/status.
// Status: 0=none, 1=custom, 2=system.
// Custom (status=1) requires a valid proxy URL (http/https/socks5/socks5h).
// Switching away from custom keeps the last custom URL.
func (h *Handler) PutPluginProxy(c *gin.Context) {
	if h == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "config unavailable"})
		return
	}

	var body struct {
		Value  *config.PluginProxyConfig `json:"value"`
		URL    *string                   `json:"url"`
		Status *int                      `json:"status"`
	}
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Value == nil && body.URL == nil && body.Status == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	h.mu.Lock()
	current := config.NormalizePluginProxyConfig(h.cfg.PluginProxy)
	next := current

	if body.Value != nil {
		next.URL = body.Value.URL
		next.Status = body.Value.Status
	}
	if body.URL != nil {
		next.URL = *body.URL
	}
	if body.Status != nil {
		next.Status = *body.Status
	}

	normalized := config.NormalizePluginProxyConfig(next)

	// Retain last custom URL when leaving custom so re-selecting custom restores it.
	if normalized.Status != config.PluginProxyStatusCustom && strings.TrimSpace(normalized.URL) == "" {
		normalized.URL = strings.TrimSpace(current.URL)
	}

	if normalized.Status == config.PluginProxyStatusCustom {
		url := strings.TrimSpace(normalized.URL)
		if url == "" {
			h.mu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{"error": "plugin-proxy url is required for custom status"})
			return
		}
		setting, errParse := proxyutil.Parse(url)
		if errParse != nil || setting.Mode != proxyutil.ModeProxy {
			h.mu.Unlock()
			message := "invalid plugin-proxy url"
			if errParse != nil {
				message = errParse.Error()
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": message})
			return
		}
		normalized.URL = url
		normalized.Status = config.PluginProxyStatusCustom
	}

	h.cfg.PluginProxy = normalized
	_ = h.persistLocked(c)
	h.mu.Unlock()
}

// ValidatePluginProxyURL checks a candidate custom plugin-proxy URL without saving.
func (h *Handler) ValidatePluginProxyURL(c *gin.Context) {
	var body struct {
		URL   *string `json:"url"`
		Value *string `json:"value"`
	}
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body", "valid": false})
		return
	}

	raw := ""
	if body.URL != nil {
		raw = *body.URL
	} else if body.Value != nil {
		raw = *body.Value
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plugin-proxy url is required", "valid": false})
		return
	}

	setting, errParse := proxyutil.Parse(raw)
	if errParse != nil || setting.Mode != proxyutil.ModeProxy {
		message := "invalid plugin-proxy url"
		if errParse != nil {
			message = errParse.Error()
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": message, "valid": false})
		return
	}

	c.JSON(http.StatusOK, gin.H{"valid": true, "url": raw})
}
