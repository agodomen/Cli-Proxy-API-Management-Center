package charitable

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	settingKeyAPIKeyDebug = "chariable.debug.api_key" // intentional spelling per product requirement
	probeTimeout          = 20 * time.Second
	defaultProbePrompt    = "Compute 17+28 and reply with only the number."
)

var (
	// Clean URL: https://host/...
	reURL = regexp.MustCompile(`(?i)\bhttps?://[^\s"'<>]+`)
	// Anti-scrape obfuscated URL, e.g.
	//   https: 😴://ooi.li00.xyz/
	//   https: :sleeping_face://ooi.li00.xyz/
	//   https : //api.example.com
	reObfuscatedURL = regexp.MustCompile(`(?i)https?\s*[:：]?\s*[^\n]{0,48}?//\s*([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?::\d{2,5})?(?:/[^\s"'<>]*)?)`)
	// Bare host on its own line (fallback).
	reBareHost       = regexp.MustCompile(`(?m)^\s*([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)\s*$`)
	reKey            = regexp.MustCompile(`(?i)\b(?:sk-[A-Za-z0-9_\-]{8,}|sk-ant-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{20,}|[A-Za-z0-9_\-]{24,})\b`)
	reLabeledURL     = regexp.MustCompile(`(?im)(?:base[_\s-]?url|endpoint|host)\s*[:=：]\s*([^\s,;]+)`)
	reLabeledKey     = regexp.MustCompile(`(?im)(?:api[_\s-]?key|token|secret|authorization)\s*[:=：]\s*([^\s,;]+)`)
	reLabeledModel   = regexp.MustCompile(`(?im)(?:model(?:_name)?)\s*[:=：]\s*([^\s,;]+)`)
	reEmojiShortcode = regexp.MustCompile(`:[a-z0-9_+-]+:`)
)

type APIKeyDebugSettings struct {
	SystemPrompt string `json:"systemPrompt"`
	ProbePrompt  string `json:"probePrompt"`
	UpdatedAtMS  int64  `json:"updatedAtMs,omitempty"`
}

type ExtractRequest struct {
	Text string `json:"text"`
}

type ExtractedCredential struct {
	BaseURL string `json:"baseUrl,omitempty"`
	APIKey  string `json:"apiKey,omitempty"`
	Model   string `json:"model,omitempty"`
	Source  string `json:"source"` // regex | labeled
}

type ExtractResponse struct {
	Items []ExtractedCredential `json:"items"`
}

type ProbeRequest struct {
	BaseURL       string            `json:"baseUrl"`
	APIKey        string            `json:"apiKey"`
	Model         string            `json:"model,omitempty"`         // single model; empty + empty Models => fetch all then probe
	Models        []string          `json:"models,omitempty"`        // explicit multi-model probe list
	Protocols     []string          `json:"protocols,omitempty"`     // openai, anthropic, gemini, openai_responses
	ProtocolPaths map[string]string `json:"protocolPaths,omitempty"` // protocol → suffix, e.g. "openai"→"/v1/chat/completions"; empty = use default
	ProbePrompt   string            `json:"probePrompt,omitempty"`
	MaxModels     int               `json:"maxModels,omitempty"` // clamp when probing all; default 20, max 50
}

type ProbeResult struct {
	Protocol     string `json:"protocol"`
	Model        string `json:"model,omitempty"`
	OK           bool   `json:"ok"`
	StatusCode   int    `json:"statusCode,omitempty"`
	LatencyMs    int64  `json:"latencyMs"`
	Endpoint     string `json:"endpoint,omitempty"`
	RequestBody  string `json:"requestBody,omitempty"`
	ResponseBody string `json:"responseBody,omitempty"`
	// Snippet keeps a short response preview for backward-compatible UIs.
	Snippet string `json:"snippet,omitempty"`
	Error   string `json:"error,omitempty"`
}

type ProbeResponse struct {
	BaseURL       string        `json:"baseUrl"`
	Model         string        `json:"model,omitempty"`
	Models        []string      `json:"models,omitempty"`
	ModelsFetched bool          `json:"modelsFetched,omitempty"`
	Results       []ProbeResult `json:"results"`
}

type ListModelsRequest struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	Protocol  string `json:"protocol,omitempty"` // openai | anthropic | gemini
	MaxModels int    `json:"maxModels,omitempty"`
}

type ListModelsResponse struct {
	BaseURL string   `json:"baseUrl"`
	Models  []string `json:"models"`
}

type SaveCredentialRequest struct {
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	Model        string `json:"model,omitempty"`
	APIType      int    `json:"apiType,omitempty"`
	ProviderName string `json:"providerName,omitempty"`
	ChannelName  string `json:"channelName,omitempty"`
	Remark       string `json:"remark,omitempty"`
	Content      string `json:"content,omitempty"`
}

type SaveCredentialResponse struct {
	Channel  Channel  `json:"channel"`
	Provider Provider `json:"provider"`
	Key      APIKey   `json:"key"`
	Created  struct {
		Channel  bool `json:"channel"`
		Provider bool `json:"provider"`
		Key      bool `json:"key"`
	} `json:"created"`
}

func defaultAPIKeyDebugSettings() APIKeyDebugSettings {
	return APIKeyDebugSettings{
		SystemPrompt: `You are a credential extractor for messy / anti-scrape text.

Input format:
<prompt>...</prompt> is this instruction
<text>...</text> is the source text to analyze

Return ONLY one JSON object (no markdown, no explanation):
{"baseUrl":"...","apiKey":"...","model":"..."}

Field rules:
1) baseUrl
- Prefer scheme + host (optionally port), e.g. "https://api.example.com"
- Remove trailing chat paths like /v1/chat/completions, /chat/completions, /responses, /messages
- Text may be obfuscated. Reconstruct valid URL when possible:
  - "https: 😴://ooi.li00.xyz/" => "https://ooi.li00.xyz"
  - "https: :sleeping_face://ooi.li00.xyz/" => "https://ooi.li00.xyz"
  - "https : //api.example.com" => "https://api.example.com"
  - emoji / Chinese noise between scheme and host should be ignored
- If only a bare host appears (e.g. api.example.com), prefix https://

2) apiKey
- Extract the secret token (often starts with sk-, sk-ant-, AIza...)
- Keep original characters; do not invent keys
- If text says it is base64 and you can decode confidently, put decoded value; otherwise keep original

3) model
- Only if explicitly present; otherwise ""

Hard constraints:
- Missing field => ""
- Never invent credentials not supported by the text
- No markdown fences, no comments, no extra keys`,
		ProbePrompt: defaultProbePrompt,
	}
}

func ExtractCredentialsFromText(text string) ExtractResponse {
	text = strings.TrimSpace(text)
	if text == "" {
		return ExtractResponse{Items: []ExtractedCredential{}}
	}

	// Labeled first.
	var labeled ExtractedCredential
	if m := reLabeledURL.FindStringSubmatch(text); len(m) > 1 {
		labeled.BaseURL = recoverBaseURL(m[1])
	}
	if m := reLabeledKey.FindStringSubmatch(text); len(m) > 1 {
		labeled.APIKey = strings.Trim(m[1], `"'`)
	}
	if m := reLabeledModel.FindStringSubmatch(text); len(m) > 1 {
		labeled.Model = strings.Trim(m[1], `"'`)
	}
	items := make([]ExtractedCredential, 0, 4)
	if labeled.BaseURL != "" || labeled.APIKey != "" {
		labeled.Source = "labeled"
		items = append(items, labeled)
	}

	urls := collectBaseURLs(text)
	keys := uniqueStrings(reKey.FindAllString(text, -1))
	// Filter keys that are obviously URLs.
	filteredKeys := make([]string, 0, len(keys))
	for _, k := range keys {
		if strings.Contains(k, "://") || strings.Contains(k, ".") && strings.Contains(k, "/") {
			continue
		}
		// Avoid treating hostnames as keys.
		if strings.Count(k, ".") >= 1 && !strings.HasPrefix(strings.ToLower(k), "sk-") && len(k) < 24 {
			continue
		}
		filteredKeys = append(filteredKeys, k)
	}

	if len(urls) == 0 && len(filteredKeys) == 0 {
		if len(items) == 0 {
			return ExtractResponse{Items: []ExtractedCredential{}}
		}
		return ExtractResponse{Items: items}
	}

	// Pair first URL with first key, then remaining solo candidates.
	base := ""
	if len(urls) > 0 {
		base = urls[0]
	}
	key := ""
	if len(filteredKeys) > 0 {
		key = filteredKeys[0]
	}
	// Avoid duplicating labeled if same.
	if !(labeled.BaseURL == base && labeled.APIKey == key) {
		source := "regex"
		if base != "" {
			host := hostOnly(base)
			cleanPresent := host != "" && (strings.Contains(strings.ToLower(text), "https://"+strings.ToLower(host)) ||
				strings.Contains(strings.ToLower(text), "http://"+strings.ToLower(host)))
			if !cleanPresent {
				source = "deobfuscated"
			}
		}
		items = append(items, ExtractedCredential{
			BaseURL: base,
			APIKey:  key,
			Model:   labeled.Model,
			Source:  source,
		})
	}

	// Extra keys alone.
	for i := 1; i < len(filteredKeys); i++ {
		items = append(items, ExtractedCredential{APIKey: filteredKeys[i], Source: "regex"})
	}
	for i := 1; i < len(urls); i++ {
		items = append(items, ExtractedCredential{BaseURL: urls[i], Source: "deobfuscated"})
	}
	return ExtractResponse{Items: items}
}

func collectBaseURLs(text string) []string {
	out := make([]string, 0, 4)

	// 1) Clean URLs.
	for _, raw := range reURL.FindAllString(text, -1) {
		if v := recoverBaseURL(raw); v != "" {
			out = append(out, v)
		}
	}

	// 2) Obfuscated URLs with noise between scheme and host.
	for _, m := range reObfuscatedURL.FindAllStringSubmatch(text, -1) {
		if len(m) < 2 {
			continue
		}
		if v := recoverBaseURL("https://" + m[1]); v != "" {
			out = append(out, v)
		}
	}

	// 3) Line-level recovery: strip emoji/shortcodes then re-scan.
	for _, line := range strings.Split(text, "\n") {
		cleaned := deobfuscateURLLine(line)
		if cleaned == "" || cleaned == strings.TrimSpace(line) {
			// still try host-only lines
			if m := reBareHost.FindStringSubmatch(line); len(m) > 1 {
				if v := recoverBaseURL("https://" + m[1]); v != "" {
					out = append(out, v)
				}
			}
			continue
		}
		for _, raw := range reURL.FindAllString(cleaned, -1) {
			if v := recoverBaseURL(raw); v != "" {
				out = append(out, v)
			}
		}
		// cleaned may already be https://host
		if v := recoverBaseURL(cleaned); v != "" {
			out = append(out, v)
		}
	}

	return uniqueStrings(out)
}

// deobfuscateURLLine turns anti-scrape lines into a usable URL candidate.
// Example: "https: 😴://ooi.li00.xyz/" => "https://ooi.li00.xyz/"
func deobfuscateURLLine(line string) string {
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	lower := strings.ToLower(line)
	if !strings.Contains(lower, "http") {
		return ""
	}

	// Normalize emoji shortcodes and whitespace around scheme separators.
	s := reEmojiShortcode.ReplaceAllString(line, "")
	// Remove common emoji / symbol noise but keep URL charset.
	// Keep letters/digits and URL punctuation.
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r <= 0x7f && (isURLASCII(byte(r)) || r == ' ' || r == '\t'):
			b.WriteRune(r)
		case r == '：':
			b.WriteByte(':')
		default:
			// drop emoji / CJK noise inside scheme area
			b.WriteByte(' ')
		}
	}
	s = b.String()
	s = strings.Join(strings.Fields(s), "") // remove all spaces

	// Fix patterns like https:////host or https:/host
	s = strings.ReplaceAll(s, "https:////", "https://")
	s = strings.ReplaceAll(s, "http:////", "http://")
	s = strings.ReplaceAll(s, "https:///", "https://")
	s = strings.ReplaceAll(s, "http:///", "http://")
	s = strings.ReplaceAll(s, "https:/", "https://")
	s = strings.ReplaceAll(s, "http:/", "http://")
	// Collapse accidental extra slashes after scheme.
	if strings.HasPrefix(strings.ToLower(s), "https:") {
		rest := s[len("https:"):]
		rest = strings.TrimLeft(rest, ":/")
		s = "https://" + rest
	} else if strings.HasPrefix(strings.ToLower(s), "http:") {
		rest := s[len("http:"):]
		rest = strings.TrimLeft(rest, ":/")
		s = "http://" + rest
	}

	// If still no scheme but looks like host, prefix https.
	if !strings.Contains(s, "://") {
		if m := reBareHost.FindStringSubmatch(s); len(m) > 1 {
			s = "https://" + m[1]
		}
	}
	return s
}

func isURLASCII(c byte) bool {
	if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' {
		return true
	}
	switch c {
	case '.', '/', ':', '?', '#', '@', '%', '&', '=', '+', '-', '_', '~', '[', ']', '(', ')':
		return true
	default:
		return false
	}
}

func recoverBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// First try deobfuscation on the whole token/line.
	if cleaned := deobfuscateURLLine(raw); cleaned != "" {
		if v := normalizeBaseURL(cleaned); v != "" {
			return v
		}
	}
	return normalizeBaseURL(raw)
}

func hostOnly(base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func ProbeProtocols(ctx context.Context, req ProbeRequest) (ProbeResponse, error) {
	base := normalizeBaseURL(req.BaseURL)
	if base == "" {
		return ProbeResponse{}, errors.New("base_url_required")
	}
	if strings.TrimSpace(req.APIKey) == "" {
		return ProbeResponse{}, errors.New("api_key_required")
	}
	prompt := strings.TrimSpace(req.ProbePrompt)
	if prompt == "" {
		prompt = defaultProbePrompt
	}
	protocols := req.Protocols
	if len(protocols) == 0 {
		protocols = []string{"openai", "anthropic", "gemini", "openai_responses"}
	}

	models := uniqueStrings(req.Models)
	if single := strings.TrimSpace(req.Model); single != "" {
		models = uniqueStrings(append([]string{single}, models...))
	}

	fetched := false
	client := &http.Client{Timeout: probeTimeout}
	if len(models) == 0 {
		// Empty model means: fetch target provider model list, then probe each.
		list, err := listProviderModels(ctx, client, base, req.APIKey, preferredListProtocol(protocols), clampMaxModels(req.MaxModels))
		if err != nil {
			return ProbeResponse{}, err
		}
		models = list
		fetched = true
		if len(models) == 0 {
			return ProbeResponse{}, errors.New("no_models_found")
		}
	}

	results := make([]ProbeResult, 0, len(protocols)*len(models))
	for _, model := range models {
		for _, p := range protocols {
			p = strings.ToLower(strings.TrimSpace(p))
			start := time.Now()
			var result ProbeResult
			switch p {
			case "openai":
				result = probeOpenAI(ctx, client, base, req.APIKey, model, prompt, req.ProtocolPaths["openai"])
			case "openai_responses":
				result = probeOpenAIResponses(ctx, client, base, req.APIKey, model, prompt, req.ProtocolPaths["openai_responses"])
			case "anthropic":
				result = probeAnthropic(ctx, client, base, req.APIKey, model, prompt, req.ProtocolPaths["anthropic"])
			case "gemini":
				result = probeGemini(ctx, client, base, req.APIKey, model, prompt, req.ProtocolPaths["gemini"])
			default:
				result = ProbeResult{Protocol: p, OK: false, Error: "unsupported_protocol"}
			}
			result.Model = model
			if result.LatencyMs == 0 {
				result.LatencyMs = time.Since(start).Milliseconds()
			}
			results = append(results, result)
		}
	}

	resp := ProbeResponse{
		BaseURL:       base,
		Models:        models,
		ModelsFetched: fetched,
		Results:       results,
	}
	if len(models) == 1 {
		resp.Model = models[0]
	}
	return resp, nil
}

func ListProviderModels(ctx context.Context, req ListModelsRequest) (ListModelsResponse, error) {
	base := normalizeBaseURL(req.BaseURL)
	if base == "" {
		return ListModelsResponse{}, errors.New("base_url_required")
	}
	if strings.TrimSpace(req.APIKey) == "" {
		return ListModelsResponse{}, errors.New("api_key_required")
	}
	client := &http.Client{Timeout: probeTimeout}
	models, err := listProviderModels(ctx, client, base, req.APIKey, strings.ToLower(strings.TrimSpace(req.Protocol)), clampMaxModels(req.MaxModels))
	if err != nil {
		return ListModelsResponse{}, err
	}
	return ListModelsResponse{BaseURL: base, Models: models}, nil
}

func clampMaxModels(n int) int {
	if n <= 0 {
		return 20
	}
	if n > 50 {
		return 50
	}
	return n
}

func preferredListProtocol(protocols []string) string {
	for _, p := range protocols {
		switch strings.ToLower(strings.TrimSpace(p)) {
		case "openai", "openai_responses":
			return "openai"
		case "anthropic":
			return "anthropic"
		case "gemini":
			return "gemini"
		}
	}
	return "openai"
}

func listProviderModels(ctx context.Context, client *http.Client, base, apiKey, protocol string, maxModels int) ([]string, error) {
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if protocol == "" || protocol == "openai_responses" {
		protocol = "openai"
	}

	// Try protocol-preferred endpoint first, then fall back.
	candidates := make([]string, 0, 4)
	switch protocol {
	case "anthropic":
		candidates = append(candidates, joinURL(base, "/v1/models"), joinURL(base, "/models"))
	case "gemini":
		candidates = append(candidates,
			joinURL(base, "/v1beta/models")+"?key="+url.QueryEscape(apiKey),
			joinURL(base, "/v1/models"),
			joinURL(base, "/models"),
		)
	default:
		candidates = append(candidates, joinURL(base, "/models"), joinURL(base, "/v1/models"))
	}

	var lastErr error
	for _, endpoint := range candidates {
		models, err := fetchModelsEndpoint(ctx, client, endpoint, apiKey, protocol)
		if err != nil {
			lastErr = err
			continue
		}
		if len(models) == 0 {
			lastErr = errors.New("no_models_found")
			continue
		}
		if len(models) > maxModels {
			models = models[:maxModels]
		}
		return models, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no_models_found")
	}
	return nil, lastErr
}

func fetchModelsEndpoint(ctx context.Context, client *http.Client, endpoint, apiKey, protocol string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	// Gemini often uses ?key=; still set bearer for compatible gateways.
	if protocol == "anthropic" {
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else if !strings.Contains(endpoint, "key=") {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("http_%d", res.StatusCode)
	}
	return parseModelIDs(body), nil
}

func parseModelIDs(raw []byte) []string {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	out := make([]string, 0, 32)
	seen := map[string]struct{}{}
	add := func(v string) {
		v = strings.TrimSpace(v)
		v = strings.TrimPrefix(v, "models/")
		if v == "" {
			return
		}
		if _, ok := seen[v]; ok {
			return
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}

	var walk func(any)
	walk = func(node any) {
		switch n := node.(type) {
		case map[string]any:
			// common shapes: {data:[{id}]}, {models:[{name}]}, {id/name/model}
			if data, ok := n["data"]; ok {
				walk(data)
			}
			if models, ok := n["models"]; ok {
				walk(models)
			}
			if id, ok := n["id"].(string); ok {
				add(id)
			}
			if name, ok := n["name"].(string); ok {
				add(name)
			}
			if model, ok := n["model"].(string); ok {
				add(model)
			}
		case []any:
			for _, item := range n {
				switch v := item.(type) {
				case string:
					add(v)
				default:
					walk(v)
				}
			}
		case string:
			add(n)
		}
	}
	walk(payload)
	return out
}

func (s *CharitableStore) SaveExtractedCredential(ctx context.Context, req SaveCredentialRequest) (SaveCredentialResponse, error) {
	base := normalizeBaseURL(req.BaseURL)
	apiKey := strings.TrimSpace(req.APIKey)
	if base == "" {
		return SaveCredentialResponse{}, errors.New("base_url_required")
	}
	if apiKey == "" {
		return SaveCredentialResponse{}, errors.New("api_key_required")
	}
	apiType := req.APIType
	if apiType <= 0 {
		apiType = 2 // openai default
	}
	channelName := strings.TrimSpace(req.ChannelName)
	if channelName == "" {
		channelName = "localhost"
	}
	providerName := strings.TrimSpace(req.ProviderName)
	if providerName == "" {
		providerName = hostLabel(base)
	}

	var out SaveCredentialResponse

	// Channel: find by name or create.
	ch, err := s.findChannelByName(ctx, channelName)
	if err != nil {
		return SaveCredentialResponse{}, err
	}
	if ch == nil {
		created := Channel{ChannelName: channelName, Status: 1, Param: "{}", URL: ""}
		if err := s.CreateChannelWithStatus(ctx, &created); err != nil {
			return SaveCredentialResponse{}, err
		}
		out.Channel = created
		out.Created.Channel = true
	} else {
		out.Channel = *ch
	}

	// Provider: find by base_url (+ optional channel) or create.
	pv, err := s.findProviderByBaseURL(ctx, base, out.Channel.ChannelID)
	if err != nil {
		return SaveCredentialResponse{}, err
	}
	if pv == nil {
		param := "{}"
		if strings.TrimSpace(req.Model) != "" {
			b, _ := json.Marshal(map[string]any{
				"models": []map[string]string{{"name": req.Model, "alias": req.Model}},
			})
			param = string(b)
		}
		created := Provider{
			ProviderName: providerName,
			ChannelID:    &out.Channel.ChannelID,
			Status:       1,
			BaseURL:      base,
			Param:        param,
		}
		if err := s.CreateProviderWithStatus(ctx, &created); err != nil {
			return SaveCredentialResponse{}, err
		}
		out.Provider = created
		out.Created.Provider = true
	} else {
		out.Provider = *pv
	}

	// Key create.
	key := APIKey{
		APIKey:     apiKey,
		APIType:    apiType,
		Status:     1,
		Priority:   0,
		Param:      "{}",
		ProviderID: &out.Provider.ProviderID,
		Content:    strings.TrimSpace(req.Content),
		Remark:     strings.TrimSpace(req.Remark),
	}
	if key.Remark == "" {
		key.Remark = "imported from key debug"
	}
	if err := s.CreateKey(ctx, &key); err != nil {
		return SaveCredentialResponse{}, err
	}
	out.Key = key
	out.Created.Key = true
	return out, nil
}

func (s *CharitableStore) findChannelByName(ctx context.Context, name string) (*Channel, error) {
	result, err := s.ListChannels(ctx, ListParams{Page: 1, PageSize: 100, Search: name})
	if err != nil {
		return nil, err
	}
	for i := range result.Items {
		if strings.EqualFold(result.Items[i].ChannelName, name) && result.Items[i].Status >= 0 {
			return &result.Items[i], nil
		}
	}
	return nil, nil
}

func (s *CharitableStore) findProviderByBaseURL(ctx context.Context, base string, channelID int64) (*Provider, error) {
	params := ListParams{Page: 1, PageSize: 100, BaseURL: base}
	if channelID > 0 {
		params.ChannelID = &channelID
	}
	result, err := s.ListProviders(ctx, params)
	if err != nil && channelID > 0 {
		// fallback without channel filter
		result, err = s.ListProviders(ctx, ListParams{Page: 1, PageSize: 100, BaseURL: base})
	}
	if err != nil {
		return nil, err
	}
	for i := range result.Items {
		if normalizeBaseURL(result.Items[i].BaseURL) == base && result.Items[i].Status >= 0 {
			return &result.Items[i], nil
		}
	}
	// broader search
	result, err = s.ListProviders(ctx, ListParams{Page: 1, PageSize: 200, Search: base})
	if err != nil {
		return nil, err
	}
	for i := range result.Items {
		if normalizeBaseURL(result.Items[i].BaseURL) == base && result.Items[i].Status >= 0 {
			return &result.Items[i], nil
		}
	}
	return nil, nil
}

func probeOpenAI(ctx context.Context, client *http.Client, base, key, model, prompt, pathOverride string) ProbeResult {
	endpoint := buildProbeEndpoint(base, pathOverride, "/v1/chat/completions")
	body := map[string]any{
		"model":      model,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
		"stream":     false,
		"max_tokens": 16,
	}
	return doJSONProbe(ctx, client, "openai", endpoint, key, "bearer", body)
}

func probeOpenAIResponses(ctx context.Context, client *http.Client, base, key, model, prompt, pathOverride string) ProbeResult {
	endpoint := buildProbeEndpoint(base, pathOverride, "/v1/responses")
	body := map[string]any{
		"model": model,
		"input": prompt,
	}
	return doJSONProbe(ctx, client, "openai_responses", endpoint, key, "bearer", body)
}

func probeAnthropic(ctx context.Context, client *http.Client, base, key, model, prompt, pathOverride string) ProbeResult {
	endpoint := buildProbeEndpoint(base, pathOverride, "/v1/messages")
	body := map[string]any{
		"model":      model,
		"max_tokens": 16,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	}
	return doJSONProbe(ctx, client, "anthropic", endpoint, key, "x-api-key", body)
}

func probeGemini(ctx context.Context, client *http.Client, base, key, model, prompt, pathOverride string) ProbeResult {
	suffix := pathOverride
	if strings.TrimSpace(suffix) == "" {
		suffix = "/v1beta/models/{model}:generateContent"
	}
	suffix = strings.ReplaceAll(suffix, "{model}", url.PathEscape(model))
	endpoint := joinURL(base, suffix)
	u, err := url.Parse(endpoint)
	if err == nil {
		q := u.Query()
		q.Set("key", key)
		u.RawQuery = q.Encode()
		endpoint = u.String()
	}
	body := map[string]any{
		"contents": []map[string]any{
			{"parts": []map[string]string{{"text": prompt}}},
		},
	}
	return doJSONProbe(ctx, client, "gemini", endpoint, key, "none", body)
}

func buildProbeEndpoint(base, pathOverride, fallback string) string {
	if suffix := strings.TrimSpace(pathOverride); suffix != "" {
		return joinURL(base, suffix)
	}
	return joinURL(base, fallback)
}

const (
	// Cap bodies returned to UI so a single probe page stays readable.
	maxProbeRequestBodyBytes  = 8 << 10  // 8 KiB
	maxProbeResponseBodyBytes = 32 << 10 // 32 KiB
	maxProbeSnippetBytes      = 1024
)

func doJSONProbe(ctx context.Context, client *http.Client, protocol, endpoint, key, authMode string, body any) ProbeResult {
	start := time.Now()
	raw, err := json.Marshal(body)
	if err != nil {
		return ProbeResult{Protocol: protocol, OK: false, Endpoint: endpoint, Error: err.Error(), LatencyMs: time.Since(start).Milliseconds()}
	}
	requestBody := prettyJSONBytes(raw)
	if len(requestBody) > maxProbeRequestBodyBytes {
		requestBody = requestBody[:maxProbeRequestBodyBytes] + "…"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return ProbeResult{
			Protocol:    protocol,
			OK:          false,
			Endpoint:    endpoint,
			RequestBody: requestBody,
			Error:       err.Error(),
			LatencyMs:   time.Since(start).Milliseconds(),
		}
	}
	req.Header.Set("Content-Type", "application/json")
	switch authMode {
	case "bearer":
		req.Header.Set("Authorization", "Bearer "+key)
	case "x-api-key":
		req.Header.Set("x-api-key", key)
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	res, err := client.Do(req)
	if err != nil {
		return ProbeResult{
			Protocol:    protocol,
			OK:          false,
			Endpoint:    endpoint,
			RequestBody: requestBody,
			Error:       err.Error(),
			LatencyMs:   time.Since(start).Milliseconds(),
		}
	}
	defer res.Body.Close()
	responseBytes, _ := io.ReadAll(io.LimitReader(res.Body, maxProbeResponseBodyBytes+1))
	truncated := len(responseBytes) > maxProbeResponseBodyBytes
	if truncated {
		responseBytes = responseBytes[:maxProbeResponseBodyBytes]
	}
	responseBody := prettyJSONBytes(responseBytes)
	if truncated {
		responseBody += "…"
	}
	snippet := responseBody
	if len(snippet) > maxProbeSnippetBytes {
		snippet = snippet[:maxProbeSnippetBytes] + "…"
	}
	ok := res.StatusCode >= 200 && res.StatusCode < 300
	out := ProbeResult{
		Protocol:     protocol,
		OK:           ok,
		StatusCode:   res.StatusCode,
		LatencyMs:    time.Since(start).Milliseconds(),
		Endpoint:     endpoint,
		RequestBody:  requestBody,
		ResponseBody: responseBody,
		Snippet:      snippet,
	}
	if !ok {
		out.Error = summarizeProbeError(res.StatusCode, responseBody)
	}
	return out
}

func prettyJSONBytes(raw []byte) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err == nil {
		return buf.String()
	}
	return string(raw)
}

func summarizeProbeError(status int, snippet string) string {
	code := fmt.Sprintf("http_%d", status)
	msg := extractProviderErrorMessage(snippet)
	if msg == "" {
		return code
	}
	// Keep one-line machine-readable summary for UI chips.
	msg = strings.ReplaceAll(msg, "\n", " ")
	if len(msg) > 220 {
		msg = msg[:220] + "…"
	}
	return code + ": " + msg
}

func extractProviderErrorMessage(snippet string) string {
	snippet = strings.TrimSpace(snippet)
	if snippet == "" {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(snippet), &payload); err != nil {
		return ""
	}
	// Common shapes:
	// {"error":{"code":"UnsupportedModel","message":"..."}}
	// {"error":{"message":"..."}}
	// {"message":"..."}
	if errObj, ok := payload["error"].(map[string]any); ok {
		parts := make([]string, 0, 2)
		if c, ok := errObj["code"].(string); ok && strings.TrimSpace(c) != "" {
			parts = append(parts, strings.TrimSpace(c))
		}
		if m, ok := errObj["message"].(string); ok && strings.TrimSpace(m) != "" {
			parts = append(parts, strings.TrimSpace(m))
		}
		if t, ok := errObj["type"].(string); ok && strings.TrimSpace(t) != "" && len(parts) == 0 {
			parts = append(parts, strings.TrimSpace(t))
		}
		return strings.Join(parts, " — ")
	}
	if m, ok := payload["message"].(string); ok {
		return strings.TrimSpace(m)
	}
	return ""
}

func normalizeBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.Trim(raw, `"'`)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return strings.TrimRight(raw, "/")
	}
	// strip common chat path suffixes
	path := strings.TrimRight(u.Path, "/")
	for _, suffix := range []string{"/chat/completions", "/completions", "/responses", "/messages"} {
		if strings.HasSuffix(strings.ToLower(path), suffix) {
			path = path[:len(path)-len(suffix)]
			break
		}
	}
	u.Path = path
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/")
}

func joinURL(base, suffix string) string {
	base = strings.TrimRight(base, "/")
	if !strings.HasPrefix(suffix, "/") {
		suffix = "/" + suffix
	}
	// avoid double /v1/v1
	if strings.HasSuffix(base, "/v1") && strings.HasPrefix(suffix, "/v1/") {
		suffix = strings.TrimPrefix(suffix, "/v1")
	}
	return base + suffix
}

func hostLabel(base string) string {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "imported-provider"
	}
	host := u.Hostname()
	host = strings.TrimPrefix(host, "www.")
	if host == "" {
		return "imported-provider"
	}
	return host
}

func uniqueStrings(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		v = strings.TrimRight(v, ".,);]")
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func (s *CharitableStore) GetAPIKeyDebugSettings(ctx context.Context) (APIKeyDebugSettings, error) {
	defaults := defaultAPIKeyDebugSettings()
	var raw string
	err := s.db.QueryRowContext(ctx, `select value from settings where key = ?`, settingKeyAPIKeyDebug).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return defaults, nil
		}
		// settings table always exists in main store init; tolerate missing for tests
		if strings.Contains(err.Error(), "no such table") {
			return defaults, nil
		}
		return defaults, err
	}
	var cfg APIKeyDebugSettings
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return defaults, nil
	}
	if strings.TrimSpace(cfg.SystemPrompt) == "" {
		cfg.SystemPrompt = defaults.SystemPrompt
	}
	if strings.TrimSpace(cfg.ProbePrompt) == "" {
		cfg.ProbePrompt = defaults.ProbePrompt
	}
	return cfg, nil
}

func (s *CharitableStore) SaveAPIKeyDebugSettings(ctx context.Context, cfg APIKeyDebugSettings) (APIKeyDebugSettings, error) {
	defaults := defaultAPIKeyDebugSettings()
	if strings.TrimSpace(cfg.SystemPrompt) == "" {
		cfg.SystemPrompt = defaults.SystemPrompt
	}
	if strings.TrimSpace(cfg.ProbePrompt) == "" {
		cfg.ProbePrompt = defaults.ProbePrompt
	}
	cfg.UpdatedAtMS = time.Now().UnixMilli()
	raw, err := json.Marshal(cfg)
	if err != nil {
		return cfg, err
	}
	_, err = s.db.ExecContext(ctx, `
		insert into settings(key, value, updated_at_ms)
		values(?, ?, ?)
		on conflict(key) do update set value = excluded.value, updated_at_ms = excluded.updated_at_ms
	`, settingKeyAPIKeyDebug, string(raw), cfg.UpdatedAtMS)
	if err != nil {
		return cfg, err
	}
	return cfg, nil
}
