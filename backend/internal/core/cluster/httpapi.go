package cluster

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// Handler exposes the cluster management HTTP API under /v0/management/cpamc/cluster/*.
type Handler struct {
	store  *Store
	pusher *Pusher
}

// NewHandler creates a cluster API handler.
func NewHandler(store *Store) *Handler {
	return &Handler{
		store:  store,
		pusher: NewPusher(store),
	}
}

// Routes returns the base path for cluster API routes.
const RoutesBase = "/v0/cpamc/cluster"

// ServeHTTP routes cluster API requests.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cluster store unavailable"})
		return
	}
	cleanPath := strings.TrimRight(r.URL.Path, "/")
	relative := strings.TrimPrefix(cleanPath, RoutesBase)
	relative = strings.TrimPrefix(relative, "/")

	switch {
	case relative == "" && r.Method == http.MethodGet:
		h.handleClusterOverview(w, r)
	case relative == "nodes" && r.Method == http.MethodGet:
		h.handleListNodes(w, r)
	case relative == "nodes" && r.Method == http.MethodPost:
		h.handleUpsertNode(w, r)
	case strings.HasPrefix(relative, "nodes/") && r.Method == http.MethodDelete:
		id := strings.TrimPrefix(relative, "nodes/")
		h.handleDeleteNode(w, r, id)
	case strings.HasPrefix(relative, "nodes/") && strings.HasSuffix(relative, "/push") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(relative, "nodes/"), "/push")
		h.handlePushNode(w, r, id)
	case strings.HasPrefix(relative, "nodes/") && strings.HasSuffix(relative, "/heartbeat") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(relative, "nodes/"), "/heartbeat")
		h.handleHeartbeat(w, r, id)
	case relative == "push" && r.Method == http.MethodPost:
		h.handlePushAll(w, r)
	case relative == "home" && r.Method == http.MethodGet:
		h.handleGetHome(w, r)
	case relative == "home" && r.Method == http.MethodPut:
		h.handleSetHome(w, r)
	case relative == "home/push" && r.Method == http.MethodPost:
		h.handlePushHome(w, r)
	case relative == "config" && r.Method == http.MethodGet:
		h.handleGetConfig(w, r)
	case relative == "config" && r.Method == http.MethodPut:
		h.handleSetConfig(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (h *Handler) handleClusterOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	nodes, err := h.store.ListNodes(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	home, _ := h.store.LoadHomeConnection(ctx)
	type overview struct {
		Nodes []ClusterNode  `json:"nodes"`
		Home  HomeConnection `json:"home"`
	}
	writeJSON(w, http.StatusOK, overview{Nodes: nodes, Home: home})
}

func (h *Handler) handleListNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := h.store.ListNodes(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

type upsertNodeRequest struct {
	ID            string         `json:"id"`
	Type          string         `json:"type"`
	Role          string         `json:"role"`
	Endpoint      string         `json:"endpoint"`
	Status        string         `json:"status"`
	Name          string         `json:"name"`
	ManagementKey string         `json:"managementKey"`
	Metadata      map[string]any `json:"metadata"`
}

func (h *Handler) handleUpsertNode(w http.ResponseWriter, r *http.Request) {
	var req upsertNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body: " + err.Error()})
		return
	}
	if req.ID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}
	node := ClusterNode{
		ID:            req.ID,
		Type:          req.Type,
		Role:          req.Role,
		Endpoint:      req.Endpoint,
		Status:        req.Status,
		Name:          req.Name,
		ManagementKey: req.ManagementKey,
		Metadata:      req.Metadata,
	}
	if err := h.store.UpsertNode(r.Context(), node); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	saved, _ := h.store.GetNode(r.Context(), req.ID)
	writeJSON(w, http.StatusOK, saved)
}

func (h *Handler) handleDeleteNode(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "node id is required"})
		return
	}
	if err := h.store.DeleteNode(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": id})
}

// heartbeatInterval is the recommended reporting interval exposed to follower
// nodes so they know how often to POST /nodes/:id/heartbeat.
const heartbeatInterval = "30s"

type heartbeatRequest struct {
	Status   string         `json:"status"`
	Metadata map[string]any `json:"metadata"`
}

func (h *Handler) handleHeartbeat(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "node id is required"})
		return
	}
	var req heartbeatRequest
	// Body is optional: a follower may POST an empty body to just refresh
	// last_seen_at.
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body: " + err.Error()})
			return
		}
	}
	node, found, err := h.store.HeartbeatNode(r.Context(), id, req.Status, req.Metadata)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "node not found", "id": id})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"node":               node,
		"heartbeatInterval":  heartbeatInterval,
		"receivedAt":         node.UpdatedAt,
	})
}

func (h *Handler) handlePushNode(w http.ResponseWriter, r *http.Request, id string) {
	result, err := h.pusher.PushNode(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) handlePushAll(w http.ResponseWriter, r *http.Request) {
	results, err := h.pusher.PushAll(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (h *Handler) handleGetHome(w http.ResponseWriter, r *http.Request) {
	conn, err := h.store.LoadHomeConnection(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, conn)
}

func (h *Handler) handleSetHome(w http.ResponseWriter, r *http.Request) {
	var conn HomeConnection
	if err := json.NewDecoder(r.Body).Decode(&conn); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body: " + err.Error()})
		return
	}
	if err := h.store.SaveHomeConnection(r.Context(), conn); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, conn)
}

func (h *Handler) handlePushHome(w http.ResponseWriter, r *http.Request) {
	result, err := h.pusher.PushToHome(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	items, err := h.store.LoadConfigSnapshot(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"config": items})
}

type setConfigRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (h *Handler) handleSetConfig(w http.ResponseWriter, r *http.Request) {
	var req setConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body: " + err.Error()})
		return
	}
	if req.Key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key is required"})
		return
	}
	if err := h.store.UpsertConfigValue(r.Context(), req.Key, req.Value); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "key": req.Key})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// ValidateNode checks basic invariants for a cluster node before persisting.
func ValidateNode(node ClusterNode) error {
	if node.ID == "" {
		return errors.New("node id is required")
	}
	switch node.Type {
	case NodeTypeCPA, NodeTypeCPAHome, NodeTypeCPAMC, "":
	default:
		return errors.New("invalid node type: " + node.Type)
	}
	switch node.Role {
	case NodeRoleMaster, NodeRoleFollower, "":
	default:
		return errors.New("invalid node role: " + node.Role)
	}
	return nil
}

// noop context import guard (removed if not needed)
var _ = context.Background
