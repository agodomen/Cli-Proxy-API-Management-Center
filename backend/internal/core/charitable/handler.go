package charitable

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/httputil"
)

// ── Handler ──

type Handler struct {
	store   *CharitableStore
	console *SQLConsole
}

func NewHandler(store *CharitableStore) *Handler {
	return NewHandlerWithConsole(store, nil)
}

func NewHandlerWithConsole(store *CharitableStore, console *SQLConsole) *Handler {
	return &Handler{store: store, console: console}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/charitable/channels", h.handleChannels)
	mux.HandleFunc("/api/charitable/channels/", h.handleChannelByID)
	mux.HandleFunc("/api/charitable/providers", h.handleProviders)
	mux.HandleFunc("/api/charitable/providers/", h.handleProviderByID)
	mux.HandleFunc("/api/charitable/keys/batch/", h.handleKeyBatch)
	mux.HandleFunc("/api/charitable/keys/query", h.handleKeyQuery)
	mux.HandleFunc("/api/charitable/keys/upsert", h.handleKeyUpsert)
	mux.HandleFunc("/api/charitable/keys/statuses", h.handleKeyStatusCounts)
	mux.HandleFunc("/api/charitable/keys", h.handleKeys)
	mux.HandleFunc("/api/charitable/keys/", h.handleKeyByID)
	mux.HandleFunc("/api/charitable/proxies", h.handleProxies)
	mux.HandleFunc("/api/charitable/proxies/query", h.handleProxyQuery)
	mux.HandleFunc("/api/charitable/proxies/upsert", h.handleProxyUpsert)
	mux.HandleFunc("/api/charitable/proxies/batch/", h.handleProxyBatch)
	mux.HandleFunc("/api/charitable/proxies/probe", h.handleProxyProbe)
	mux.HandleFunc("/api/charitable/proxies/site-test", h.handleProxySiteTest)
	mux.HandleFunc("/api/charitable/proxies/", h.handleProxyByID)

	// SQL debug console
	mux.HandleFunc("/api/charitable/debug/databases", h.handleDebugDatabases)
	mux.HandleFunc("/api/charitable/debug/databases/", h.handleDebugDatabaseByID)
	mux.HandleFunc("/api/charitable/debug/query", h.handleDebugQuery)

	// Key debug console
	mux.HandleFunc("/api/charitable/debug/key/settings", h.handleKeyDebugSettings)
	mux.HandleFunc("/api/charitable/debug/key/extract", h.handleKeyDebugExtract)
	mux.HandleFunc("/api/charitable/debug/key/models", h.handleKeyDebugModels)
	mux.HandleFunc("/api/charitable/debug/key/probe", h.handleKeyDebugProbe)
	mux.HandleFunc("/api/charitable/debug/key/save", h.handleKeyDebugSave)

	// Service-provider sync
	mux.HandleFunc("/api/charitable/sync/service-providers", h.handleSyncServiceProviders)
}

// ── Channel Handlers ──

func (h *Handler) handleChannels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		p := parseListParams(r)
		result, err := h.store.ListChannels(r.Context(), p)
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		if result.Items == nil {
			result.Items = []Channel{}
		}
		httputil.WriteJSON(w, http.StatusOK, result)
	case http.MethodPost:
		c := Channel{Status: 1}
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateChannelInput(&c); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.CreateChannelWithStatus(r.Context(), &c); err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		httputil.WriteJSON(w, http.StatusOK, c)
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

func (h *Handler) handleChannelByID(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r.URL.Path, "/api/charitable/channels/")
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := h.store.GetChannel(r.Context(), id)
		if err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, c)
	case http.MethodPut:
		var c Channel
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateChannelInput(&c); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.UpdateChannel(r.Context(), id, &c); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, c)
	case http.MethodDelete:
		if err := h.store.DeleteChannel(r.Context(), id); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

// ── Provider Handlers ──

func (h *Handler) handleProviders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		p := parseListParams(r)
		result, err := h.store.ListProviders(r.Context(), p)
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		if result.Items == nil {
			result.Items = []Provider{}
		}
		httputil.WriteJSON(w, http.StatusOK, result)
	case http.MethodPost:
		pv := Provider{Status: 1}
		if err := json.NewDecoder(r.Body).Decode(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateProviderInput(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.CreateProviderWithStatus(r.Context(), &pv); err != nil {
			switch err.Error() {
			case "invalid_param_json", "invalid_probe_policy_json", "provider_name_required", "provider_name_too_long", "base_url_required", "base_url_invalid_scheme", "unsupported_protocol_type", "unsupported_cpa_config_type":
				writeCharitableError(w, http.StatusBadRequest, err.Error())
			default:
				// Keep response code generic but attach the root cause for clients/logs.
				writeCharitableError(w, http.StatusInternalServerError, "request_failed:"+truncateError(err.Error(), 160))
			}
			return
		}
		httputil.WriteJSON(w, http.StatusOK, pv)
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

func (h *Handler) handleProviderByID(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r.URL.Path, "/api/charitable/providers/")
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		pv, err := h.store.GetProvider(r.Context(), id)
		if err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, pv)
	case http.MethodPut:
		var pv Provider
		if err := json.NewDecoder(r.Body).Decode(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateProviderInput(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.UpdateProvider(r.Context(), id, &pv); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, pv)
	case http.MethodDelete:
		if err := h.store.DeleteProvider(r.Context(), id); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

// ── Key Batch Handlers ──

func (h *Handler) handleKeyBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}

	trimmed := strings.TrimRight(r.URL.Path, "/")
	suffix := strings.TrimPrefix(trimmed, "/api/charitable/keys/batch/")

	switch suffix {
	case "delete":
		h.handleBatchDeleteKeys(w, r)
	case "disable":
		h.handleBatchToggleKeys(w, r)
	default:
		writeCharitableError(w, http.StatusNotFound, "unknown_batch_action")
	}
}

func (h *Handler) handleBatchDeleteKeys(w http.ResponseWriter, r *http.Request) {
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
	if len(req.IDs) > 500 {
		writeCharitableError(w, http.StatusBadRequest, "batch_limit_exceeded")
		return
	}

	n, err := h.store.BatchDeleteKeys(r.Context(), req.IDs)
	if err != nil {
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"deleted": n})
}

func (h *Handler) handleBatchToggleKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs    []int64 `json:"ids"`
		Status int     `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) == 0 {
		writeCharitableError(w, http.StatusBadRequest, "ids_required")
		return
	}
	if len(req.IDs) > 500 {
		writeCharitableError(w, http.StatusBadRequest, "batch_limit_exceeded")
		return
	}

	n, err := h.store.BatchToggleKeys(r.Context(), req.IDs, req.Status)
	if err != nil {
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"updated": n})
}

// ── Key Handlers ──

func (h *Handler) handleKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		p := parseListParams(r)
		result, err := h.store.ListKeys(r.Context(), p)
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		if result.Items == nil {
			result.Items = []APIKey{}
		}
		httputil.WriteJSON(w, http.StatusOK, result)
	case http.MethodPost:
		var k APIKey
		if err := json.NewDecoder(r.Body).Decode(&k); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateKeyInput(&k); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.CreateKey(r.Context(), &k); err != nil {
			switch err.Error() {
			case "auth_index_conflict", "auth_index_source_required", "unsupported_auth_type", "invalid_auth_info", "invalid_probe_policy_json":
				writeCharitableError(w, http.StatusBadRequest, err.Error())
			default:
				writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			}
			return
		}
		httputil.WriteJSON(w, http.StatusOK, k)
	}
}

// handleKeyStatusCounts returns the exact status-code distribution for the
// current non-status filters. It lets the UI offer precise status filters
// without loading every matching credential row.
func (h *Handler) handleKeyStatusCounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	items, err := h.store.ListKeyStatusCounts(r.Context(), parseListParams(r))
	if err != nil {
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	if items == nil {
		items = []KeyStatusCount{}
	}
	httputil.WriteJSON(w, http.StatusOK, items)
}

type keyIdentityRequest struct {
	AuthIndex string `json:"auth_index"`
	AuthValue string `json:"auth_value"`
	FileName  string `json:"file_name"`
}

func (h *Handler) handleKeyQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var request keyIdentityRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	request.AuthIndex = strings.TrimSpace(request.AuthIndex)
	request.AuthValue = strings.TrimSpace(request.AuthValue)
	request.FileName = strings.TrimSpace(request.FileName)

	var key APIKey
	var err error
	if request.AuthIndex != "" {
		key, err = h.store.GetKeyByIndex(r.Context(), request.AuthIndex)
	} else if request.FileName != "" {
		key, err = h.store.GetKeyByFileName(r.Context(), request.FileName)
	} else if request.AuthValue != "" {
		index, buildErr := BuildAuthIndex(request.AuthValue, "")
		if buildErr != nil {
			writeCharitableError(w, http.StatusBadRequest, "auth_identity_required")
			return
		}
		if strings.TrimSpace(index) == "" {
			writeCharitableError(w, http.StatusBadRequest, "auth_identity_required")
			return
		}
		key, err = h.store.GetKeyByIndex(r.Context(), index)
	} else {
		writeCharitableError(w, http.StatusBadRequest, "auth_identity_required")
		return
	}
	if err != nil {
		if err.Error() == "key_not_found" {
			writeCharitableError(w, http.StatusNotFound, "key_not_found")
			return
		}
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, key)
}

func (h *Handler) handleKeyUpsert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var key APIKey
	if err := json.NewDecoder(r.Body).Decode(&key); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if err := validateKeyInput(&key); err != nil {
		writeCharitableError(w, http.StatusBadRequest, err.Error())
		return
	}
	created, err := h.store.UpsertKey(r.Context(), &key)
	if err != nil {
		switch err.Error() {
		case "auth_index_conflict", "auth_index_source_required", "unsupported_auth_type", "invalid_auth_info", "invalid_auth_value_json", "invalid_param_json", "invalid_probe_policy_json":
			writeCharitableError(w, http.StatusBadRequest, err.Error())
		default:
			writeCharitableError(w, http.StatusInternalServerError, "request_failed:"+truncateError(err.Error(), 160))
		}
		return
	}
	operation := "updated"
	status := http.StatusOK
	if created {
		operation = "created"
		status = http.StatusCreated
	}
	httputil.WriteJSON(w, status, map[string]any{
		"operation": operation,
		"item":      key,
	})
}

func (h *Handler) handleKeyByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimRight(r.URL.Path, "/")
	suffix := strings.TrimPrefix(path, "/api/charitable/keys/")
	parts := strings.SplitN(suffix, "/", 2)

	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_id")
		return
	}

	// Sub-path dispatch
	if len(parts) > 1 {
		switch parts[1] {
		case "full_param":
			h.handleGetFullParam(w, r, id)
			return
		case "param":
			h.handleKeyParam(w, r, id)
			return
		}
	}

	// Standard CRUD
	switch r.Method {
	case http.MethodGet:
		k, err := h.store.GetKey(r.Context(), id)
		if err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, k)
	case http.MethodPut:
		var k APIKey
		if err := json.NewDecoder(r.Body).Decode(&k); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateKeyInput(&k); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.UpdateKey(r.Context(), id, &k); err != nil {
			switch err.Error() {
			case "auth_index_conflict", "auth_index_source_required", "unsupported_auth_type", "invalid_auth_info", "invalid_probe_policy_json":
				writeCharitableError(w, http.StatusBadRequest, err.Error())
			case "key_not_found":
				writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			default:
				writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			}
			return
		}
		httputil.WriteJSON(w, http.StatusOK, k)
	case http.MethodDelete:
		if err := h.store.DeleteKey(r.Context(), id); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

func (h *Handler) handleGetFullParam(w http.ResponseWriter, r *http.Request, id int64) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	merged, _, err := h.store.GetKeyFullParam(r.Context(), id)
	if err != nil {
		writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
		return
	}
	httputil.WriteJSON(w, http.StatusOK, merged)
}

func (h *Handler) handleKeyParam(w http.ResponseWriter, r *http.Request, id int64) {
	switch r.Method {
	case http.MethodGet:
		k, err := h.store.GetKey(r.Context(), id)
		if err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(defaultJSON(k.Param)), &obj); err != nil {
			obj = map[string]any{}
		}
		httputil.WriteJSON(w, http.StatusOK, obj)
	case http.MethodPut:
		var raw map[string]any
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		paramBytes, err := json.Marshal(raw)
		if err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := h.store.UpdateKeyParam(r.Context(), id, string(paramBytes)); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, raw)
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

// ── Input Validation ──

func validateChannelInput(c *Channel) error {
	if strings.TrimSpace(c.ChannelName) == "" {
		return errors.New("channel_name_required")
	}
	if len(c.ChannelName) > 100 {
		return errors.New("channel_name_too_long")
	}
	return validateJSON(c.Param)
}

func validateProviderInput(p *Provider) error {
	if strings.TrimSpace(p.ProviderName) == "" {
		return errors.New("provider_name_required")
	}
	if len(p.ProviderName) > 200 {
		return errors.New("provider_name_too_long")
	}
	if strings.TrimSpace(p.BaseURL) == "" {
		return errors.New("base_url_required")
	}
	if !strings.HasPrefix(p.BaseURL, "http://") && !strings.HasPrefix(p.BaseURL, "https://") {
		return errors.New("base_url_invalid_scheme")
	}
	normalizeProviderIntegration(p)
	validProtocols := map[string]bool{"openai_compatible": true, "anthropic": true, "gemini": true, "codex": true, "vertex": true}
	validTargets := map[string]bool{"openai-compatibility": true, "claude-api-key": true, "gemini-api-key": true, "codex-api-key": true, "vertex-api-key": true}
	for _, protocol := range strings.Split(p.ProtocolType, ",") {
		protocol = strings.TrimSpace(protocol)
		if protocol == "" {
			continue
		}
		if !validProtocols[protocol] {
			return errors.New("unsupported_protocol_type")
		}
	}
	if !validTargets[p.CPAConfigType] {
		return errors.New("unsupported_cpa_config_type")
	}
	return validateJSON(p.Param)
}

func validateKeyInput(k *APIKey) error {
	// Accept both new auth_* payload and legacy api_key/api_type payload.
	if strings.TrimSpace(k.AuthValue) == "" && strings.TrimSpace(k.APIKey) != "" {
		k.AuthValue = k.APIKey
	}
	if k.AuthType == 0 {
		k.AuthType = 1
	}
	if k.AuthType < 1 || k.AuthType > 5 {
		return errors.New("unsupported_auth_type")
	}
	if strings.TrimSpace(k.AuthIndex) == "" && strings.TrimSpace(k.AuthValue) == "" && strings.TrimSpace(k.Content) == "" {
		return errors.New("auth_index_source_required")
	}
	if k.AuthType == 1 && strings.TrimSpace(k.AuthValue) != "" && len(strings.TrimSpace(k.AuthValue)) < 8 {
		return errors.New("api_key_too_short")
	}
	if k.AuthType > 1 && strings.TrimSpace(k.AuthValue) != "" {
		var structured any
		if json.Unmarshal([]byte(k.AuthValue), &structured) != nil || structured == nil {
			return errors.New("invalid_auth_value_json")
		}
	}
	if strings.TrimSpace(k.AuthInfo) == "" {
		if k.APIType > 0 {
			k.AuthInfo = strconv.Itoa(k.APIType)
		} else {
			return errors.New("api_type_required")
		}
	}
	info, err := parseAuthInfo(k.AuthInfo)
	if err != nil || info.APIType <= 0 {
		return errors.New("api_type_required")
	}
	k.APIType = info.APIType
	if k.AuthType == 1 {
		k.APIKey = k.AuthValue
	}
	return validateJSON(k.Param)
}

func validateProxyInput(p *ProxyDetail) error {
	p.ProxyValue = strings.TrimSpace(p.ProxyValue)
	p.ProxyInfo = strings.TrimSpace(p.ProxyInfo)
	p.Content = strings.TrimSpace(p.Content)
	if strings.TrimSpace(p.ProxyIndex) == "" && p.ProxyValue == "" && p.Content == "" {
		return errors.New("proxy_value_required")
	}
	// Unknown is the automatic mode; resolve it from the URI before persistence.
	if p.ProxyType <= 0 || p.ProxyType == ProxyTypeUnknown {
		p.ProxyType = DetectProxyType(p.ProxyValue)
	}
	if p.ProxyType <= 0 {
		p.ProxyType = ProxyTypeUnknown
	}
	return validateJSON(p.Param)
}

func (h *Handler) handleProxies(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		p := parseListParams(r)
		result, err := h.store.ListProxies(r.Context(), p)
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		if result.Items == nil {
			result.Items = []ProxyDetail{}
		}
		httputil.WriteJSON(w, http.StatusOK, result)
	case http.MethodPost:
		pv := ProxyDetail{Status: 1, ProxyType: ProxyTypeUnknown}
		if err := json.NewDecoder(r.Body).Decode(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateProxyInput(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.CreateProxy(r.Context(), &pv); err != nil {
			if err.Error() == "proxy_value_required" || err.Error() == "invalid_param_json" || err.Error() == "proxy_index_conflict" {
				writeCharitableError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		httputil.WriteJSON(w, http.StatusOK, pv)
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

type proxyIdentityRequest struct {
	ProxyIndex string `json:"proxy_index"`
	ProxyValue string `json:"proxy_value"`
}

func (h *Handler) handleProxyQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var request proxyIdentityRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	request.ProxyIndex = strings.TrimSpace(request.ProxyIndex)
	request.ProxyValue = strings.TrimSpace(request.ProxyValue)
	if request.ProxyIndex == "" {
		index, err := BuildProxyIndex(request.ProxyValue, "")
		if err != nil {
			writeCharitableError(w, http.StatusBadRequest, "proxy_identity_required")
			return
		}
		request.ProxyIndex = index
	}
	if request.ProxyIndex == "" {
		writeCharitableError(w, http.StatusBadRequest, "proxy_identity_required")
		return
	}
	proxy, err := h.store.GetProxyByIndex(r.Context(), request.ProxyIndex)
	if err != nil {
		if err.Error() == "proxy_not_found" {
			writeCharitableError(w, http.StatusNotFound, "proxy_not_found")
			return
		}
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, proxy)
}

func (h *Handler) handleProxyUpsert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var proxy ProxyDetail
	if err := json.NewDecoder(r.Body).Decode(&proxy); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if err := validateProxyInput(&proxy); err != nil {
		writeCharitableError(w, http.StatusBadRequest, err.Error())
		return
	}
	created, err := h.store.UpsertProxy(r.Context(), &proxy)
	if err != nil {
		switch err.Error() {
		case "proxy_index_conflict", "proxy_index_source_required", "proxy_value_required", "invalid_param_json":
			writeCharitableError(w, http.StatusBadRequest, err.Error())
		default:
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		}
		return
	}
	operation := "updated"
	status := http.StatusOK
	if created {
		operation = "created"
		status = http.StatusCreated
	}
	httputil.WriteJSON(w, status, map[string]any{
		"operation": operation,
		"item":      proxy,
	})
}

func (h *Handler) handleProxyByID(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r.URL.Path, "/api/charitable/proxies/")
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	switch r.Method {
	case http.MethodGet:
		pv, err := h.store.GetProxy(r.Context(), id)
		if err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, pv)
	case http.MethodPut:
		var pv ProxyDetail
		if err := json.NewDecoder(r.Body).Decode(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if err := validateProxyInput(&pv); err != nil {
			writeCharitableError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.UpdateProxy(r.Context(), id, &pv); err != nil {
			switch err.Error() {
			case "proxy_value_required", "invalid_param_json", "proxy_index_conflict":
				writeCharitableError(w, http.StatusBadRequest, err.Error())
			case "proxy_not_found":
				writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			default:
				writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			}
			return
		}
		httputil.WriteJSON(w, http.StatusOK, pv)
	case http.MethodDelete:
		if err := h.store.DeleteProxy(r.Context(), id); err != nil {
			writeCharitableError(w, http.StatusNotFound, getNotFoundCode(err))
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

func (h *Handler) handleProxyBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}

	suffix := strings.TrimPrefix(strings.TrimRight(r.URL.Path, "/"), "/api/charitable/proxies/batch/")
	if suffix != "delete" {
		writeCharitableError(w, http.StatusNotFound, "unknown_batch_action")
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
	if len(req.IDs) > 500 {
		writeCharitableError(w, http.StatusBadRequest, "batch_limit_exceeded")
		return
	}

	deleted, err := h.store.BatchDeleteProxies(r.Context(), req.IDs)
	if err != nil {
		writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]int64{"deleted": deleted})
}

type proxyProbeResult struct {
	ID        int64  `json:"id"`
	OK        bool   `json:"ok"`
	Target    string `json:"target,omitempty"`
	LatencyMs int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

func (h *Handler) handleProxyProbe(w http.ResponseWriter, r *http.Request) {
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
	results := make([]proxyProbeResult, len(req.IDs))
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for index, id := range req.IDs {
		index, id := index, id
		proxy, ok := byID[id]
		if !ok {
			results[index] = proxyProbeResult{ID: id, Error: "proxy_not_found"}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[index] = probeProxyTCP(r.Context(), proxy)
		}()
	}
	wg.Wait()
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"results": results})
}

func probeProxyTCP(ctx context.Context, proxy ProxyDetail) proxyProbeResult {
	result := proxyProbeResult{ID: proxy.ID}
	target, err := proxyProbeTarget(proxy.ProxyValue)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Target = target
	started := time.Now()
	dialer := net.Dialer{Timeout: 8 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", target)
	result.LatencyMs = time.Since(started).Milliseconds()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	_ = conn.Close()
	result.OK = true
	return result
}

func proxyProbeTarget(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New("proxy_value_required")
	}
	if strings.HasPrefix(strings.ToLower(value), "vmess://") {
		return probeTargetFromVMess(value)
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return "", errors.New("proxy_target_unavailable")
	}
	if strings.EqualFold(parsed.Scheme, "freedom") || strings.EqualFold(parsed.Scheme, "blackhole") || strings.EqualFold(parsed.Scheme, "dokodemo-door") {
		return "", errors.New("proxy_target_unavailable")
	}
	host := parsed.Hostname()
	if host == "" {
		return "", errors.New("proxy_target_unavailable")
	}
	port := parsed.Port()
	if port == "" {
		port = defaultProxyPort(parsed.Scheme)
	}
	if port == "" {
		return "", errors.New("proxy_port_unavailable")
	}
	return net.JoinHostPort(host, port), nil
}

func probeTargetFromVMess(raw string) (string, error) {
	payload := strings.TrimPrefix(strings.TrimSpace(raw), "vmess://")
	payload = strings.TrimRight(payload, "=")
	decoded, err := base64.RawStdEncoding.DecodeString(payload)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(payload)
	}
	if err != nil {
		return "", errors.New("proxy_target_unavailable")
	}
	var config struct {
		Add  string `json:"add"`
		Port any    `json:"port"`
	}
	if err := json.Unmarshal(decoded, &config); err != nil || strings.TrimSpace(config.Add) == "" {
		return "", errors.New("proxy_target_unavailable")
	}
	port := fmt.Sprint(config.Port)
	if port == "" || port == "<nil>" {
		return "", errors.New("proxy_port_unavailable")
	}
	return net.JoinHostPort(strings.TrimSpace(config.Add), port), nil
}

func defaultProxyPort(scheme string) string {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "http":
		return "80"
	case "https", "naive", "naive+https", "overtls":
		return "443"
	default:
		return ""
	}
}

// ── Helpers ──

// parsePathID extracts a numeric ID from the URL path.
// e.g., path="/api/charitable/channels/42", prefix="/api/charitable/channels/" → 42
func parsePathID(path, prefix string) (int64, error) {
	raw := strings.TrimPrefix(strings.TrimRight(path, "/"), prefix)
	return strconv.ParseInt(raw, 10, 64)
}

// parseListParams parses common list query parameters from the request.
func parseListParams(r *http.Request) ListParams {
	q := r.URL.Query()
	p := ListParams{}
	p.Page, _ = strconv.Atoi(q.Get("page"))
	p.PageSize, _ = strconv.Atoi(q.Get("page_size"))
	p.Search = strings.TrimSpace(q.Get("search"))
	p.BaseURL = strings.TrimSpace(q.Get("base_url"))

	if raw := q.Get("channel_id"); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
			p.ChannelID = &v
		}
	}
	if raw := q.Get("provider_id"); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
			p.ProviderID = &v
		}
	}
	if raw := strings.TrimSpace(q.Get("provider_ids")); raw != "" {
		parts := strings.Split(raw, ",")
		ids := make([]int64, 0, len(parts))
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if v, err := strconv.ParseInt(part, 10, 64); err == nil {
				ids = append(ids, v)
			}
		}
		if len(ids) > 0 {
			p.ProviderIDs = ids
		}
	}
	if raw := q.Get("status"); raw != "" {
		if raw == "all" {
			p.AllStatus = true
		} else if v, err := strconv.Atoi(raw); err == nil {
			p.Status = &v
		}
	}
	if raw := strings.TrimSpace(q.Get("status_domain")); raw == "valid" || raw == "unknown" || raw == "invalid" || raw == "expired" || raw == "disabled" {
		p.StatusDomain = raw
	}
	if raw := q.Get("priority"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			p.Priority = &v
		}
	}
	if raw := q.Get("api_type"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			p.APIType = &v
		}
	}
	if raw := q.Get("proxy_type"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			p.ProxyType = &v
		}
	}
	if raw := strings.TrimSpace(q.Get("credential_kind")); raw == "auth_file" || raw == "api_key" {
		p.CredentialKind = raw
	}
	return p
}

// getNotFoundCode maps store-level error messages to API error codes.
func getNotFoundCode(err error) string {
	msg := err.Error()
	switch msg {
	case "channel_not_found":
		return "channel_not_found"
	case "provider_not_found":
		return "provider_not_found"
	case "key_not_found":
		return "key_not_found"
	case "proxy_not_found":
		return "proxy_not_found"
	default:
		return "request_failed"
	}
}

// writeCharitableError writes a charitable error response directly, bypassing
// httpapi.usageServiceErrorCode.
func writeCharitableError(w http.ResponseWriter, status int, code string) {
	httputil.WriteJSON(w, status, map[string]any{"error": code, "code": code})
}

func truncateError(message string, max int) string {
	message = strings.TrimSpace(message)
	if max <= 0 || len(message) <= max {
		return message
	}
	return message[:max]
}

// ── SQL Debug Console Handlers ──

func (h *Handler) requireConsole(w http.ResponseWriter) bool {
	if h.console == nil {
		writeCharitableError(w, http.StatusServiceUnavailable, "sql_console_unavailable")
		return false
	}
	return true
}

func (h *Handler) handleDebugDatabases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	if !h.requireConsole(w) {
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"items": h.console.ListDatabases(r.Context()),
	})
}

func (h *Handler) handleDebugDatabaseByID(w http.ResponseWriter, r *http.Request) {
	if !h.requireConsole(w) {
		return
	}
	// Paths:
	//   /api/charitable/debug/databases/{id}/schema
	//   /api/charitable/debug/databases/{id}/tables/{table}/preview
	const prefix = "/api/charitable/debug/databases/"
	rest := strings.TrimPrefix(strings.TrimRight(r.URL.Path, "/"), strings.TrimRight(prefix, "/"))
	rest = strings.TrimPrefix(rest, "/")
	if rest == "" {
		writeCharitableError(w, http.StatusNotFound, "not_found")
		return
	}
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeCharitableError(w, http.StatusNotFound, "not_found")
		return
	}
	databaseID := parts[0]

	switch {
	case len(parts) == 2 && parts[1] == "schema":
		if r.Method != http.MethodGet {
			httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
			return
		}
		schema, err := h.console.GetSchema(r.Context(), databaseID)
		if err != nil {
			status, code := mapSQLConsoleError(err)
			if status >= 500 {
				writeCharitableError(w, status, code)
				return
			}
			// include message for query-ish failures
			httputil.WriteJSON(w, status, map[string]any{"error": err.Error(), "code": code})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, schema)
	case len(parts) == 4 && parts[1] == "tables" && parts[3] == "preview":
		if r.Method != http.MethodGet {
			httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
			return
		}
		maxRows, _ := strconv.Atoi(r.URL.Query().Get("max_rows"))
		preview, err := h.console.PreviewTable(r.Context(), databaseID, parts[2], maxRows)
		if err != nil {
			status, code := mapSQLConsoleError(err)
			httputil.WriteJSON(w, status, map[string]any{"error": err.Error(), "code": code})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, preview)
	default:
		writeCharitableError(w, http.StatusNotFound, "not_found")
	}
}

func (h *Handler) handleDebugQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	if !h.requireConsole(w) {
		return
	}
	var req QueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.DatabaseID) == "" {
		req.DatabaseID = primaryDatabaseID
	}
	result, err := h.console.Execute(r.Context(), req)
	if err != nil {
		status, code := mapSQLConsoleError(err)
		body := map[string]any{"error": err.Error(), "code": code}
		// For write confirmation, keep a stable machine code without leaking internals.
		if errors.Is(err, errWriteConfirmationRequired) {
			body["error"] = code
		}
		httputil.WriteJSON(w, status, body)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

// ── Key Debug Console Handlers ──

func (h *Handler) handleKeyDebugSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := h.store.GetAPIKeyDebugSettings(r.Context())
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		httputil.WriteJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var cfg APIKeyDebugSettings
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			writeCharitableError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		saved, err := h.store.SaveAPIKeyDebugSettings(r.Context(), cfg)
		if err != nil {
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
			return
		}
		httputil.WriteJSON(w, http.StatusOK, saved)
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

func (h *Handler) handleKeyDebugExtract(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var req ExtractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, ExtractCredentialsFromText(req.Text))
}

func (h *Handler) handleKeyDebugModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var req ListModelsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	result, err := ListProviderModels(r.Context(), req)
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleKeyDebugProbe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var req ProbeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.ProbePrompt) == "" {
		if cfg, err := h.store.GetAPIKeyDebugSettings(r.Context()); err == nil {
			req.ProbePrompt = cfg.ProbePrompt
		}
	}
	result, err := ProbeProtocols(r.Context(), req)
	if err != nil {
		writeCharitableError(w, http.StatusBadRequest, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleKeyDebugSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var req SaveCredentialRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	result, err := h.store.SaveExtractedCredential(r.Context(), req)
	if err != nil {
		msg := err.Error()
		switch msg {
		case "base_url_required", "api_key_required", "api_key_too_short", "api_type_required", "invalid_param_json":
			writeCharitableError(w, http.StatusBadRequest, msg)
		default:
			writeCharitableError(w, http.StatusInternalServerError, "request_failed")
		}
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleSyncServiceProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	var entries []SyncEntry
	if err := json.NewDecoder(r.Body).Decode(&entries); err != nil {
		writeCharitableError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	result, err := h.store.SyncServiceProvidersToKeys(r.Context(), entries, r.URL.Query().Get("update_models") == "1")
	if err != nil {
		writeCharitableError(w, http.StatusInternalServerError, "sync_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}
