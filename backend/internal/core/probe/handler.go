package probe

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/httputil"
)

type Handler struct {
	manager *Manager
	store   *Store
}

func NewHandler(manager *Manager, store *Store) *Handler {
	return &Handler{manager: manager, store: store}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/charitable/probe/config", h.handleConfig)
	mux.HandleFunc("/api/charitable/probe/status", h.handleStatus)
	mux.HandleFunc("/api/charitable/probe/summary", h.handleSummary)
	mux.HandleFunc("/api/charitable/probe/results", h.handleResults)
	mux.HandleFunc("/api/charitable/probe/stats", h.handleStats)
	mux.HandleFunc("/api/charitable/probe/actions", h.handleActions)
}

func (h *Handler) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		httputil.WriteJSON(w, http.StatusOK, h.manager.Config())
	case http.MethodPut:
		var cfg Config
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			httputil.WriteError(w, http.StatusBadRequest, errors.New("invalid_json"))
			return
		}
		saved, err := h.manager.UpdateConfig(r.Context(), cfg)
		if err != nil {
			httputil.WriteError(w, http.StatusInternalServerError, err)
			return
		}
		httputil.WriteJSON(w, http.StatusOK, saved)
	default:
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
	}
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	httputil.WriteJSON(w, http.StatusOK, h.manager.Status())
}

func (h *Handler) handleSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	cfg := h.manager.Config()
	window := cfg.WindowSeconds
	if raw := strings.TrimSpace(r.URL.Query().Get("window_seconds")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			window = parsed
		}
	}
	status := h.manager.Status()
	summary, err := h.store.Summary(r.Context(), window, status.Enabled, status.ServiceStatus)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, summary)
}

func (h *Handler) handleResults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	params := parseListParams(r)
	result, err := h.store.ListResults(r.Context(), params)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if result.Items == nil {
		result.Items = []Result{}
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	cfg := h.manager.Config()
	window := cfg.WindowSeconds
	if raw := strings.TrimSpace(r.URL.Query().Get("window_seconds")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			window = parsed
		}
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	result, err := h.store.ListKeyStats(r.Context(), window, search, page, pageSize)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if result.Items == nil {
		result.Items = []KeyStat{}
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleActions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httputil.WriteError(w, http.StatusMethodNotAllowed, errors.New("method_not_allowed"))
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	result, err := h.store.ListActions(r.Context(), page, pageSize)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if result.Items == nil {
		result.Items = []ActionLog{}
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

func parseListParams(r *http.Request) ListParams {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	params := ListParams{
		Page:      page,
		PageSize:  pageSize,
		Search:    strings.TrimSpace(q.Get("search")),
		AuthIndex: strings.TrimSpace(q.Get("auth_index")),
	}
	if raw := strings.TrimSpace(q.Get("key_id")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			params.KeyID = &parsed
		}
	}
	if raw := strings.TrimSpace(q.Get("provider_id")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			params.ProviderID = &parsed
		}
	}
	switch strings.ToLower(strings.TrimSpace(q.Get("success"))) {
	case "1", "true", "yes", "ok":
		value := true
		params.Success = &value
	case "0", "false", "no", "failed":
		value := false
		params.Success = &value
	}
	if raw := strings.TrimSpace(q.Get("since_ms")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			params.SinceMS = &parsed
		}
	}
	if raw := strings.TrimSpace(q.Get("until_ms")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			params.UntilMS = &parsed
		}
	}
	return params
}
