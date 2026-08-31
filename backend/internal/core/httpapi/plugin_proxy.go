package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	coreproxy "github.com/router-for-me/CLIProxyAPI/v7/internal/core/proxy"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/proxyutil"
)

const pluginProxySettingKey = "plugin_proxy_v1"

// pluginProxyResponse is the JSON shape returned by the plugin-proxy endpoints.
// It mirrors the community handler's response so the frontend can reuse the
// same Select-driven UI component.
type pluginProxyResponse struct {
	Proxy       coreproxy.ScopedProxyConfig `json:"plugin-proxy"`
	ProxyURL    string                      `json:"proxy-url"`
	Effective   string                      `json:"effective"`
	Accelerator string                      `json:"accelerator"`
}

// loadPluginProxy loads the scoped proxy config from the settings table.
// Returns a zero-value config (status=none) when no setting is stored.
func (s *Server) loadPluginProxy(ctx context.Context) pluginProxyResponse {
	scoped := coreproxy.ScopedProxyConfig{Status: coreproxy.StatusNone}
	proxyURL := ""
	if s.store != nil {
		if raw, ok, err := s.store.LoadSetting(ctx, pluginProxySettingKey); err == nil && ok {
			var parsed coreproxy.ScopedProxyConfig
			if errJSON := json.Unmarshal([]byte(raw), &parsed); errJSON == nil {
				scoped = coreproxy.NormalizeScopedProxyConfig(parsed)
			}
		}
		proxyURL = s.resolveCPAProxyURL(ctx)
	}
	resolution := coreproxy.Resolve(proxyURL, scoped)
	return pluginProxyResponse{
		Proxy:       scoped,
		ProxyURL:    proxyURL,
		Effective:   resolution.ProxyURL,
		Accelerator: resolution.AcceleratorBase,
	}
}

// savePluginProxy persists the scoped proxy config to the settings table.
func (s *Server) savePluginProxy(ctx context.Context, scoped coreproxy.ScopedProxyConfig) error {
	if s.store == nil {
		return errors.New("store unavailable")
	}
	normalized := coreproxy.NormalizeScopedProxyConfig(scoped)
	raw, err := json.Marshal(normalized)
	if err != nil {
		return err
	}
	return s.store.SaveSetting(ctx, pluginProxySettingKey, string(raw))
}

// resolvePluginProxyResolution resolves the effective proxy/accelerator for
// plugin-store list/install clients. It combines the locally-stored scoped
// proxy with the CPA upstream global proxy-url (for system status).
func (s *Server) resolvePluginProxyResolution(ctx context.Context) coreproxy.Resolution {
	scoped := coreproxy.ScopedProxyConfig{Status: coreproxy.StatusNone}
	if s.store != nil {
		if raw, ok, err := s.store.LoadSetting(ctx, pluginProxySettingKey); err == nil && ok {
			var parsed coreproxy.ScopedProxyConfig
			if errJSON := json.Unmarshal([]byte(raw), &parsed); errJSON == nil {
				scoped = coreproxy.NormalizeScopedProxyConfig(parsed)
			}
		}
	}
	globalProxyURL := ""
	if scoped.Status == coreproxy.StatusSystem {
		globalProxyURL = s.resolveCPAProxyURL(ctx)
	}
	return coreproxy.Resolve(globalProxyURL, scoped)
}

// ResolvePluginProxyResolution is the exported accessor for the effective
// plugin-store proxy/accelerator. It allows community plugin-store handlers
// to use the core-managed proxy config without duplicating resolution logic.
func (s *Server) ResolvePluginProxyResolution(ctx context.Context) coreproxy.Resolution {
	return s.resolvePluginProxyResolution(ctx)
}

// handlePluginProxy handles GET/PUT /v0/management/cpamc/plugin-proxy and
// POST /v0/management/cpamc/plugin-proxy/validate.
func (s *Server) handlePluginProxy(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")

	switch {
	case path == cpamcBase+"/plugin-proxy" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.loadPluginProxy(r.Context()))

	case path == cpamcBase+"/plugin-proxy" && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		var body struct {
			Value       *coreproxy.ScopedProxyConfig `json:"value"`
			URL         *string                      `json:"url"`
			Accelerator *string                      `json:"accelerator"`
			Status      *int                         `json:"status"`
		}
		if errDecode := json.NewDecoder(r.Body).Decode(&body); errDecode != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid body"))
			return
		}
		if body.Value == nil && body.URL == nil && body.Accelerator == nil && body.Status == nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid body"))
			return
		}

		current := s.loadPluginProxy(r.Context()).Proxy
		next := current
		if body.Value != nil {
			next.URL = body.Value.URL
			next.Accelerator = body.Value.Accelerator
			next.Status = body.Value.Status
		}
		if body.URL != nil {
			next.URL = *body.URL
		}
		if body.Accelerator != nil {
			next.Accelerator = *body.Accelerator
		}
		if body.Status != nil {
			next.Status = *body.Status
		}

		normalized := coreproxy.NormalizeScopedProxyConfig(next)
		// Retain last values independently so mode switches do not lose input.
		if strings.TrimSpace(normalized.URL) == "" {
			normalized.URL = strings.TrimSpace(current.URL)
		}
		if strings.TrimSpace(normalized.Accelerator) == "" {
			normalized.Accelerator = strings.TrimSpace(current.Accelerator)
		}

		switch normalized.Status {
		case coreproxy.StatusCustom:
			url := strings.TrimSpace(normalized.URL)
			if url == "" {
				writeError(w, http.StatusBadRequest, errors.New("plugin-proxy url is required for custom status"))
				return
			}
			setting, errParse := proxyutil.Parse(url)
			if errParse != nil || setting.Mode != proxyutil.ModeProxy {
				message := "invalid plugin-proxy url"
				if errParse != nil {
					message = errParse.Error()
				}
				writeError(w, http.StatusBadRequest, errors.New(message))
				return
			}
			normalized.URL = url
			normalized.Status = coreproxy.StatusCustom
		case coreproxy.StatusAccelerator:
			baseRaw := strings.TrimSpace(normalized.Accelerator)
			if baseRaw == "" {
				writeError(w, http.StatusBadRequest, errors.New("plugin-proxy accelerator is required for accelerator status"))
				return
			}
			base, errNormalize := coreproxy.NormalizeAcceleratorBase(baseRaw)
			if errNormalize != nil {
				writeError(w, http.StatusBadRequest, errNormalize)
				return
			}
			normalized.Accelerator = base
			normalized.Status = coreproxy.StatusAccelerator
		}

		if errSave := s.savePluginProxy(r.Context(), normalized); errSave != nil {
			writeError(w, http.StatusInternalServerError, errSave)
			return
		}
		writeJSON(w, http.StatusOK, s.loadPluginProxy(r.Context()))

	case path == cpamcBase+"/plugin-proxy/validate" && r.Method == http.MethodPost:
		var body struct {
			URL         *string `json:"url"`
			Value       *string `json:"value"`
			Accelerator *string `json:"accelerator"`
			Status      *int    `json:"status"`
		}
		if errBind := json.NewDecoder(r.Body).Decode(&body); errBind != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body", "valid": false})
			return
		}

		raw := ""
		if body.Accelerator != nil {
			raw = *body.Accelerator
		} else if body.URL != nil {
			raw = *body.URL
		} else if body.Value != nil {
			raw = *body.Value
		}
		raw = strings.TrimSpace(raw)
		if raw == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "plugin-proxy url is required", "valid": false})
			return
		}

		status := coreproxy.StatusCustom
		if body.Status != nil {
			status = *body.Status
		}

		if status == coreproxy.StatusAccelerator {
			base, errNormalize := coreproxy.NormalizeAcceleratorBase(raw)
			if errNormalize != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": errNormalize.Error(), "valid": false})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"valid": true, "accelerator": base, "status": coreproxy.StatusAccelerator})
			return
		}

		setting, errParse := proxyutil.Parse(raw)
		if errParse != nil || setting.Mode != proxyutil.ModeProxy {
			message := "invalid plugin-proxy url"
			if errParse != nil {
				message = errParse.Error()
			}
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": message, "valid": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"valid": true, "url": raw, "status": coreproxy.StatusCustom})

	default:
		methodNotAllowed(w)
	}
}
