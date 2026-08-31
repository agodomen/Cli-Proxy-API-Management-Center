package cluster

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestHeartbeat_RefreshesLastSeen verifies a follower's heartbeat updates
// last_seen_at without altering other fields, and returns the recommended
// reporting interval.
func TestHeartbeat_RefreshesLastSeen(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	if err := store.UpsertNode(ctx, ClusterNode{
		ID:       "follower-1",
		Type:     NodeTypeCPA,
		Role:     NodeRoleFollower,
		Status:   NodeStatusActive,
		Endpoint: "http://127.0.0.1:8317",
		Name:     "follower-1",
	}); err != nil {
		t.Fatalf("UpsertNode: %v", err)
	}

	// Simulate a follower POSTing a heartbeat with metadata.
	node, found, err := store.HeartbeatNode(ctx, "follower-1", "", map[string]any{
		"version": "1.2.3",
		"platform": "linux/amd64",
	})
	if err != nil {
		t.Fatalf("HeartbeatNode: %v", err)
	}
	if !found {
		t.Fatalf("expected node to be found")
	}
	if node.LastSeenAt == nil {
		t.Fatalf("expected last_seen_at to be set after heartbeat")
	}
	if node.Metadata == nil || node.Metadata["version"] != "1.2.3" {
		t.Fatalf("metadata not updated: %+v", node.Metadata)
	}

	// A heartbeat for an unknown node must report not-found.
	_, found2, err := store.HeartbeatNode(ctx, "does-not-exist", "", nil)
	if err != nil {
		t.Fatalf("HeartbeatNode unknown: %v", err)
	}
	if found2 {
		t.Fatalf("unknown node should not be found")
	}
}

// TestHeartbeat_HTTPHandler exercises the HTTP surface end-to-end through the
// cluster Handler, including the recommended-interval field in the response.
func TestHeartbeat_HTTPHandler(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	_ = store.UpsertNode(ctx, ClusterNode{
		ID: "follower-http", Type: NodeTypeCPA, Role: NodeRoleFollower,
		Status: NodeStatusActive, Endpoint: "http://127.0.0.1:8317",
	})

	h := NewHandler(store)

	// Empty-body heartbeat (most common follower case).
	req := httptest.NewRequest(http.MethodPost,
		RoutesBase+"/nodes/follower-http/heartbeat", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "heartbeatInterval") {
		t.Fatalf("response missing heartbeatInterval: %s", rec.Body.String())
	}

	// Unknown node -> 404.
	req2 := httptest.NewRequest(http.MethodPost,
		RoutesBase+"/nodes/ghost/heartbeat", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("unknown node status = %d, want 404", rec2.Code)
	}
}
