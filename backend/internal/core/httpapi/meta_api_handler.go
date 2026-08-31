package httpapi

import (
	"net/http"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

// handleMetaAPI serves the project API path catalog (cpa_api_detail) so the
// /charitable/debug page can browse and exercise every route.
//
//	GET /v0/cpamc/meta-api/list   → full catalog + stats
func (s *Server) handleMetaAPI(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}
	cleanPath := strings.TrimRight(r.URL.Path, "/")
	switch {
	case cleanPath == cpamcBase+"/meta-api/list" && r.Method == http.MethodGet:
		entries, err := s.store.ListMetaAPI(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		stats, err := s.store.MetaAPIStats(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, metaAPIListResponse{
			Items: entries,
			Stats: stats,
		})
	default:
		methodNotAllowed(w)
	}
}

type metaAPIListResponse struct {
	Items []store.MetaAPIEntry `json:"items"`
	Stats store.MetaAPIStats   `json:"stats"`
}
