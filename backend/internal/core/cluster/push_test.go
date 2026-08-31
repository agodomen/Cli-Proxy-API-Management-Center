package cluster

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

// newTestStore returns a Store backed by a SQLite database (temp file) with
// the cluster tables initialized.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "cluster.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if err := EnsureTables(s.DB()); err != nil {
		t.Fatalf("EnsureTables: %v", err)
	}
	return NewStore(s.DB())
}

// TestPushAll_PushesYAMLToFollower exercises the full CPAMC → CPA follower push
// link: it serializes the config snapshot to YAML and PUTs it to the follower's
// /v0/management/config.yaml. A mock CPA follower records the received body,
// status code and Authorization header so the test can assert the contract.
func TestPushAll_PushesYAMLToFollower(t *testing.T) {
	var (
		receivedYAML  []byte
		receivedAuth  string
		receivedCT    string
		requestCount  int
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/v0/management/config.yaml", func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.Method != http.MethodPut {
			t.Errorf("follower expected PUT, got %s", r.Method)
		}
		receivedAuth = r.Header.Get("Authorization")
		receivedCT = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		receivedYAML = body
		w.WriteHeader(http.StatusNoContent)
	})
	follower := httptest.NewServer(mux)
	defer follower.Close()

	store := newTestStore(t)
	ctx := context.Background()

	// Seed config snapshot that should be serialized to YAML and pushed.
	if err := store.UpsertConfigValue(ctx, "api-keys", `["key-1","key-2"]`); err != nil {
		t.Fatalf("UpsertConfigValue api-keys: %v", err)
	}
	if err := store.UpsertConfigValue(ctx, "plugins", `{"enabled":true}`); err != nil {
		t.Fatalf("UpsertConfigValue plugins: %v", err)
	}
	// Internal home_connection key must be excluded from the pushed YAML.
	if err := store.SaveHomeConnection(ctx, HomeConnection{BaseURL: "http://home.example"}); err != nil {
		t.Fatalf("SaveHomeConnection: %v", err)
	}

	if err := store.UpsertNode(ctx, ClusterNode{
		ID:            "cpa-follower-1",
		Type:          NodeTypeCPA,
		Role:          NodeRoleFollower,
		Status:        NodeStatusActive,
		Endpoint:      follower.URL,
		ManagementKey: "test-mgmt-key",
		Name:          "follower-1",
	}); err != nil {
		t.Fatalf("UpsertNode: %v", err)
	}
	// A CPAHome node must be skipped (delegated to Home, not pushed directly).
	if err := store.UpsertNode(ctx, ClusterNode{
		ID:       "cpa-home-1",
		Type:     NodeTypeCPAHome,
		Role:     NodeRoleFollower,
		Status:   NodeStatusActive,
		Endpoint: "http://should-not-be-called",
	}); err != nil {
		t.Fatalf("UpsertNode home: %v", err)
	}
	// A draining node must be skipped.
	if err := store.UpsertNode(ctx, ClusterNode{
		ID:       "cpa-draining",
		Type:     NodeTypeCPA,
		Role:     NodeRoleFollower,
		Status:   NodeStatusDraining,
		Endpoint: "http://should-not-be-called",
	}); err != nil {
		t.Fatalf("UpsertNode draining: %v", err)
	}

	pusher := NewPusher(store)
	results, err := pusher.PushAll(ctx)
	if err != nil {
		t.Fatalf("PushAll: %v", err)
	}

	if got, want := requestCount, 1; got != want {
		t.Fatalf("follower received %d PUT requests, want %d", got, want)
	}

	// Only the active CPA follower should have been pushed.
	var followerResult *PushResult
	for i := range results {
		if results[i].NodeID == "cpa-follower-1" {
			followerResult = &results[i]
		}
		if results[i].NodeID == "cpa-home-1" && results[i].Status != "skipped" {
			t.Errorf("cpa-home node should be skipped, got %s", results[i].Status)
		}
		if results[i].NodeID == "cpa-draining" && results[i].Status != "skipped" {
			t.Errorf("draining node should be skipped, got %s", results[i].Status)
		}
	}
	if followerResult == nil {
		t.Fatalf("no result for cpa-follower-1: %+v", results)
	}
	if followerResult.Status != "success" {
		t.Fatalf("follower push status = %s, want success (err=%s)", followerResult.Status, followerResult.Error)
	}

	// Auth header forwarded from node.ManagementKey.
	if got, want := receivedAuth, "Bearer test-mgmt-key"; got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
	if receivedCT == "" || receivedCT[:5] != "text/" {
		t.Errorf("Content-Type = %q, want text/yaml", receivedCT)
	}

	// Received YAML must contain the seeded config keys and NOT the internal
	// home_connection key.
	yamlStr := string(receivedYAML)
	for _, want := range []string{"api-keys", "key-1", "plugins", "enabled"} {
		if !contains(yamlStr, want) {
			t.Errorf("pushed YAML missing %q:\n%s", want, yamlStr)
		}
	}
	if contains(yamlStr, "home_connection_v1") || contains(yamlStr, "home.example") {
		t.Errorf("pushed YAML leaked internal home_connection key:\n%s", yamlStr)
	}

	// Pushing must refresh the follower's last_seen_at.
	node, err := store.GetNode(ctx, "cpa-follower-1")
	if err != nil {
		t.Fatalf("GetNode: %v", err)
	}
	if node.LastSeenAt == nil {
		t.Errorf("expected last_seen_at to be refreshed after push")
	} else if time.Since(*node.LastSeenAt) > time.Minute {
		t.Errorf("last_seen_at too old: %v", node.LastSeenAt)
	}
}

// TestPushNode_404Propagates verifies a failed push is reported as failed with
// the upstream status code surfaced, not as success.
func TestPushNode_404Propagates(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v0/management/config.yaml", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	})
	follower := httptest.NewServer(mux)
	defer follower.Close()

	store := newTestStore(t)
	ctx := context.Background()
	_ = store.UpsertConfigValue(ctx, "api-keys", `[]`)
	_ = store.UpsertNode(ctx, ClusterNode{
		ID: "bad-follower", Type: NodeTypeCPA, Role: NodeRoleFollower,
		Status: NodeStatusActive, Endpoint: follower.URL,
	})

	pusher := NewPusher(store)
	res, err := pusher.PushNode(ctx, "bad-follower")
	if err != nil {
		t.Fatalf("PushNode returned err: %v (expected status=failed in result)", err)
	}
	if res.Status != "failed" {
		t.Errorf("status = %s, want failed", res.Status)
	}
	if !contains(res.Error, "404") {
		t.Errorf("error = %q, want it to mention HTTP 404", res.Error)
	}
}

// TestPushToHome_Delegates verifies Home delegation uses the Home connection's
// endpoint and key rather than a registered node.
func TestPushToHome_Delegates(t *testing.T) {
	var (
		homeAuth string
		calls    int
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/v0/management/config.yaml", func(w http.ResponseWriter, r *http.Request) {
		calls++
		homeAuth = r.Header.Get("Authorization")
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
	})
	home := httptest.NewServer(mux)
	defer home.Close()

	store := newTestStore(t)
	ctx := context.Background()
	_ = store.UpsertConfigValue(ctx, "api-keys", `["home-key"]`)
	if err := store.SaveHomeConnection(ctx, HomeConnection{
		BaseURL:       home.URL,
		ManagementKey: "home-mgmt-key",
		Role:          "master",
	}); err != nil {
		t.Fatalf("SaveHomeConnection: %v", err)
	}

	pusher := NewPusher(store)
	res, err := pusher.PushToHome(ctx)
	if err != nil {
		t.Fatalf("PushToHome: %v", err)
	}
	if res.Status != "success" {
		t.Fatalf("status = %s, want success (err=%s)", res.Status, res.Error)
	}
	if calls != 1 {
		t.Fatalf("home received %d calls, want 1", calls)
	}
	if got, want := homeAuth, "Bearer home-mgmt-key"; got != want {
		t.Errorf("home Authorization = %q, want %q", got, want)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && indexOf(s, substr) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
