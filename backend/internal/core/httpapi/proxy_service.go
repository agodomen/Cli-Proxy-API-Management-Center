package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/proxy/service"
)

const proxyServiceSettingKey = service.SettingKey

// proxyServiceStatusResponse is the JSON shape returned by the proxy-service
// status endpoint.
type proxyServiceStatusResponse struct {
	Config  service.Config   `json:"config"`
	Status  service.Status   `json:"status"`
}

// loadProxyServiceConfig reads the persisted service config from SQLite.
func (s *Server) loadProxyServiceConfig(ctx context.Context) service.Config {
	cfg := service.DefaultConfig()
	if s.store == nil {
		return cfg
	}
	if raw, ok, err := s.store.LoadSetting(ctx, proxyServiceSettingKey); err == nil && ok {
		if parsed, errParse := service.UnmarshalConfig([]byte(raw)); errParse == nil {
			cfg = parsed
		}
	}
	return cfg
}

// saveProxyServiceConfig persists the service config to SQLite.
func (s *Server) saveProxyServiceConfig(ctx context.Context, cfg service.Config) error {
	if s.store == nil {
		return errors.New("store unavailable")
	}
	raw, err := service.MarshalConfig(cfg)
	if err != nil {
		return err
	}
	return s.store.SaveSetting(ctx, proxyServiceSettingKey, string(raw))
}

// ensureProxyService lazily creates the service manager and syncs its config
// from the persisted setting.
func (s *Server) ensureProxyService() *service.Service {
	s.proxyServiceMu.Lock()
	defer s.proxyServiceMu.Unlock()
	if s.proxyService == nil {
		cfg := s.loadProxyServiceConfig(context.Background())
		s.proxyService = service.New(cfg)
	} else {
		// Sync config from DB if not currently running.
		st := s.proxyService.Status()
		if !st.Running {
			s.proxyService.UpdateConfig(s.loadProxyServiceConfig(context.Background()))
		}
	}
	return s.proxyService
}

// handleProxyService handles GET/PUT /v0/cpamc/charitable/proxies/service and
// POST /v0/cpamc/charitable/proxies/service/{start,stop,restart}.
func (s *Server) handleProxyService(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	servicePath := cpamcBase + "/charitable/proxies/service"

	switch {
	case path == servicePath && r.Method == http.MethodGet:
		svc := s.ensureProxyService()
		writeJSON(w, http.StatusOK, proxyServiceStatusResponse{
			Config: svc.Config(),
			Status: svc.Status(),
		})

	case path == servicePath && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		var body service.Config
		if errDecode := json.NewDecoder(r.Body).Decode(&body); errDecode != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid body"))
			return
		}
		if err := body.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := s.saveProxyServiceConfig(r.Context(), body); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		svc := s.ensureProxyService()
		svc.UpdateConfig(body)
		// Auto-start/stop when enabled flag changes and service is not in the
		// desired state.
		st := svc.Status()
		if body.Enabled && !st.Running {
			if err := svc.Start(r.Context()); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
		} else if !body.Enabled && st.Running {
			svc.Stop()
		}
		writeJSON(w, http.StatusOK, proxyServiceStatusResponse{
			Config: svc.Config(),
			Status: svc.Status(),
		})

	case path == servicePath+"/start" && r.Method == http.MethodPost:
		svc := s.ensureProxyService()
		st := svc.Status()
		if st.Running {
			writeJSON(w, http.StatusOK, proxyServiceStatusResponse{
				Config: svc.Config(),
				Status: st,
			})
			return
		}
		if err := svc.Start(r.Context()); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, proxyServiceStatusResponse{
			Config: svc.Config(),
			Status: svc.Status(),
		})

	case path == servicePath+"/stop" && r.Method == http.MethodPost:
		svc := s.ensureProxyService()
		svc.Stop()
		writeJSON(w, http.StatusOK, proxyServiceStatusResponse{
			Config: svc.Config(),
			Status: svc.Status(),
		})

	case path == servicePath+"/restart" && r.Method == http.MethodPost:
		svc := s.ensureProxyService()
		if err := svc.Restart(r.Context()); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, proxyServiceStatusResponse{
			Config: svc.Config(),
			Status: svc.Status(),
		})

	default:
		methodNotAllowed(w)
	}
}

// ShutdownProxyService stops the proxy service if it is running. Called during
// graceful process exit.
func (s *Server) ShutdownProxyService(ctx context.Context) {
	s.proxyServiceMu.Lock()
	svc := s.proxyService
	s.proxyServiceMu.Unlock()
	if svc != nil {
		_ = svc.Shutdown(ctx)
	}
}
