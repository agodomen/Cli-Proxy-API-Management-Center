package probe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

var supportedCPAConfigTypes = map[string]bool{"openai-compatibility": true, "gemini-api-key": true, "claude-api-key": true, "codex-api-key": true, "vertex-api-key": true}

func (m *Manager) syncProviderConfig(ctx context.Context, providerID int64) error {
	if providerID <= 0 || m.upstream == nil {
		return nil
	}
	baseURL, managementKey, ok := m.upstream.ResolveCPAUpstream(ctx)
	if !ok || strings.TrimSpace(baseURL) == "" || strings.TrimSpace(managementKey) == "" {
		return errors.New("cpa_upstream_unavailable")
	}
	snapshot, err := m.store.LoadProviderSyncSnapshot(ctx, providerID)
	if err != nil {
		return err
	}
	target := strings.TrimSpace(snapshot.CPAConfigType)
	if target == "" {
		target = "openai-compatibility"
	}
	if !supportedCPAConfigTypes[target] {
		return fmt.Errorf("unsupported_cpa_config_type: %s", target)
	}
	config, err := m.fetchCPAConfig(ctx, baseURL, managementKey)
	if err != nil {
		return err
	}
	current := recordList(config[target])
	var next []map[string]any
	if target == "openai-compatibility" {
		next = upsertOpenAIProvider(current, snapshot)
	} else {
		next = upsertNativeProvider(current, snapshot)
	}
	return m.putCPASection(ctx, baseURL, managementKey, target, next)
}

func (m *Manager) fetchCPAConfig(ctx context.Context, baseURL, managementKey string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/v0/management/config", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+managementKey)
	res, err := m.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch CPA config failed: HTTP %d", res.StatusCode)
	}
	var config map[string]any
	if err := json.Unmarshal(body, &config); err != nil {
		return nil, err
	}
	return config, nil
}

func (m *Manager) putCPASection(ctx context.Context, baseURL, managementKey, target string, value []map[string]any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, strings.TrimRight(baseURL, "/")+"/v0/management/"+target, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+managementKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		return fmt.Errorf("update CPA %s failed: HTTP %d %s", target, res.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func recordList(value any) []map[string]any {
	items, _ := value.([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if record, ok := item.(map[string]any); ok {
			out = append(out, record)
		}
	}
	return out
}
func eligibleSyncKeys(snapshot providerSyncSnapshot) []providerSyncKey {
	if snapshot.Status <= 0 {
		return nil
	}
	var out []providerSyncKey
	for _, key := range snapshot.Keys {
		if key.AuthType == 1 && key.Status > 0 && strings.TrimSpace(key.AuthValue) != "" {
			out = append(out, key)
		}
	}
	return out
}

func upsertOpenAIProvider(current []map[string]any, snapshot providerSyncSnapshot) []map[string]any {
	index := -1
	for i, item := range current {
		if strings.EqualFold(strings.TrimSpace(stringValue(item["name"])), strings.TrimSpace(snapshot.Name)) {
			index = i
			break
		}
	}
	provider := map[string]any{}
	if index >= 0 {
		for key, value := range current[index] {
			provider[key] = value
		}
	}
	provider["name"] = strings.TrimSpace(snapshot.Name)
	provider["base-url"] = strings.TrimRight(strings.TrimSpace(snapshot.BaseURL), "/")
	keys := eligibleSyncKeys(snapshot)
	entries := make([]map[string]any, 0, len(keys))
	maxPriority := 0
	for _, key := range keys {
		entry := map[string]any{"api-key": strings.TrimSpace(key.AuthValue)}
		if proxy := syncProxyURL(key.Param, snapshot.Param); proxy != "" {
			entry["proxy-url"] = proxy
		}
		entries = append(entries, entry)
		if key.Priority > maxPriority {
			maxPriority = key.Priority
		}
	}
	provider["api-key-entries"] = entries
	provider["disabled"] = snapshot.Status <= 0 || len(entries) == 0
	provider["priority"] = maxPriority
	applyProviderSyncParams(provider, snapshot.Param)
	if index >= 0 {
		current[index] = provider
		return current
	}
	return append(current, provider)
}

func upsertNativeProvider(current []map[string]any, snapshot providerSyncSnapshot) []map[string]any {
	managed := map[string]bool{}
	for _, key := range snapshot.Keys {
		managed[strings.TrimSpace(key.AuthValue)] = true
	}
	next := make([]map[string]any, 0, len(current)+len(snapshot.Keys))
	for _, item := range current {
		if !managed[strings.TrimSpace(stringValue(item["api-key"]))] {
			next = append(next, item)
		}
	}
	for _, key := range eligibleSyncKeys(snapshot) {
		item := map[string]any{"api-key": strings.TrimSpace(key.AuthValue), "priority": key.Priority, "base-url": strings.TrimRight(strings.TrimSpace(snapshot.BaseURL), "/")}
		if proxy := syncProxyURL(key.Param, snapshot.Param); proxy != "" {
			item["proxy-url"] = proxy
		}
		applyProviderSyncParams(item, snapshot.Param)
		next = append(next, item)
	}
	return next
}

func applyProviderSyncParams(target map[string]any, raw string) {
	var params map[string]any
	if json.Unmarshal([]byte(raw), &params) != nil {
		return
	}
	for _, key := range []string{"prefix", "headers", "models", "excluded-models", "disable-cooling", "test-model"} {
		if value, ok := params[key]; ok {
			target[key] = value
		}
	}
}
func syncProxyURL(keyRaw, providerRaw string) string {
	for _, raw := range []string{keyRaw, providerRaw} {
		var params map[string]any
		if json.Unmarshal([]byte(raw), &params) != nil {
			continue
		}
		if value := strings.TrimSpace(stringValue(params["proxy_url"])); value != "" {
			return value
		}
		if value := strings.TrimSpace(stringValue(params["proxyUrl"])); value != "" {
			return value
		}
	}
	return ""
}
func stringValue(value any) string { text, _ := value.(string); return text }
