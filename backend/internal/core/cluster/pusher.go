package cluster

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// PushResult records the outcome of pushing config to a single node.
type PushResult struct {
	NodeID string `json:"nodeId"`
	Status string `json:"status"` // success | failed | skipped
	Error  string `json:"error,omitempty"`
}

// Pusher serializes the cluster config snapshot to YAML and pushes it to
// follower nodes via their management API.
type Pusher struct {
	store    *Store
	httpClient *http.Client
}

// NewPusher creates a config pusher.
func NewPusher(store *Store) *Pusher {
	return &Pusher{
		store: store,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// BuildYAML reads all config key-value pairs from SQLite, assembles them into
// a config root map, and marshals to YAML. This is the format CPA follower
// nodes expect (PUT /v0/management/config.yaml).
func (p *Pusher) BuildYAML(ctx context.Context) ([]byte, error) {
	if p.store == nil {
		return nil, fmt.Errorf("store is nil")
	}
	items, err := p.store.LoadConfigSnapshot(ctx)
	if err != nil {
		return nil, fmt.Errorf("load config snapshot: %w", err)
	}
	// Filter out internal keys that are not part of the CPA config root.
	root := make(map[string]any)
	for _, item := range items {
		if item.Key == clusterHomeConnKey {
			continue
		}
		var value any
		if err := json.Unmarshal([]byte(item.Value), &value); err != nil {
			return nil, fmt.Errorf("decode config value for key %q: %w", item.Key, err)
		}
		root[item.Key] = value
	}
	data, err := yaml.Marshal(root)
	if err != nil {
		return nil, fmt.Errorf("marshal config yaml: %w", err)
	}
	return data, nil
}

// PushAll pushes the current config snapshot to all active follower nodes.
// CPAHome follower nodes are skipped here (they are managed via Home's own
// DB-driven config distribution; use PushToHome instead).
func (p *Pusher) PushAll(ctx context.Context) ([]PushResult, error) {
	if p.store == nil {
		return nil, fmt.Errorf("store is nil")
	}
	yamlData, err := p.BuildYAML(ctx)
	if err != nil {
		return nil, err
	}
	nodes, err := p.store.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	results := make([]PushResult, 0, len(nodes))
	for _, node := range nodes {
		result := PushResult{NodeID: node.ID}
		if node.Status != NodeStatusActive {
			result.Status = "skipped"
			results = append(results, result)
			continue
		}
		// CPAHome nodes are delegated to Home, not pushed directly.
		if node.Type == NodeTypeCPAHome {
			result.Status = "skipped"
			results = append(results, result)
			continue
		}
		if node.Endpoint == "" {
			result.Status = "failed"
			result.Error = "endpoint is empty"
			results = append(results, result)
			continue
		}
		if err := p.pushToNode(ctx, node, yamlData); err != nil {
			result.Status = "failed"
			result.Error = err.Error()
		} else {
			result.Status = "success"
		}
		results = append(results, result)
	}
	return results, nil
}

// PushNode pushes the current config snapshot to a specific node by ID.
func (p *Pusher) PushNode(ctx context.Context, nodeID string) (PushResult, error) {
	if p.store == nil {
		return PushResult{}, fmt.Errorf("store is nil")
	}
	node, err := p.store.GetNode(ctx, nodeID)
	if err != nil {
		return PushResult{}, fmt.Errorf("get node: %w", err)
	}
	result := PushResult{NodeID: node.ID}
	if node.Status != NodeStatusActive {
		result.Status = "skipped"
		return result, nil
	}
	if node.Type == NodeTypeCPAHome {
		result.Status = "skipped"
		return result, nil
	}
	yamlData, err := p.BuildYAML(ctx)
	if err != nil {
		return PushResult{}, err
	}
	if err := p.pushToNode(ctx, node, yamlData); err != nil {
		result.Status = "failed"
		result.Error = err.Error()
	} else {
		result.Status = "success"
	}
	return result, nil
}

// pushToNode sends YAML config to a CPA node's PUT /v0/management/config.yaml.
func (p *Pusher) pushToNode(ctx context.Context, node ClusterNode, yamlData []byte) error {
	baseURL := strings.TrimRight(strings.TrimSpace(node.Endpoint), "/")
	if baseURL == "" {
		return fmt.Errorf("endpoint is empty for node %s", node.ID)
	}
	url := baseURL + "/v0/management/config.yaml"
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(yamlData))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "text/yaml; charset=utf-8")
	if node.ManagementKey != "" {
		req.Header.Set("Authorization", "Bearer "+node.ManagementKey)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("push request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("node %s returned HTTP %d: %s", node.ID, resp.StatusCode, string(body))
	}
	_ = p.store.TouchNode(ctx, node.ID)
	return nil
}

// PushToHome delegates config push to a CLIProxyAPIHome master via its
// Management API (PUT /v0/management/config.yaml). CPAMC only interacts with
// the Home master; Home itself distributes to its CPA nodes.
func (p *Pusher) PushToHome(ctx context.Context) (PushResult, error) {
	if p.store == nil {
		return PushResult{}, fmt.Errorf("store is nil")
	}
	conn, err := p.store.LoadHomeConnection(ctx)
	if err != nil {
		return PushResult{}, fmt.Errorf("load home connection: %w", err)
	}
	if conn.BaseURL == "" {
		return PushResult{Status: "skipped", Error: "home connection not configured"}, nil
	}
	yamlData, err := p.BuildYAML(ctx)
	if err != nil {
		return PushResult{}, err
	}
	baseURL := strings.TrimRight(strings.TrimSpace(conn.BaseURL), "/")
	url := baseURL + "/v0/management/config.yaml"
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(yamlData))
	if err != nil {
		return PushResult{}, fmt.Errorf("create home request: %w", err)
	}
	req.Header.Set("Content-Type", "text/yaml; charset=utf-8")
	if conn.ManagementKey != "" {
		req.Header.Set("Authorization", "Bearer "+conn.ManagementKey)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return PushResult{NodeID: "home", Status: "failed", Error: err.Error()}, nil
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return PushResult{NodeID: "home", Status: "failed", Error: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(body))}, nil
	}
	return PushResult{NodeID: "home", Status: "success"}, nil
}
