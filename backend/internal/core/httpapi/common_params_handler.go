package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const commonParamsSettingKey = "common_params"

// CommonParams holds user-configurable common parameters (header presets, etc.)
// persisted in the settings table under key "common_params".
type CommonParams struct {
	CodexUserAgent    string `json:"codexUserAgent,omitempty"`
	ClaudeUserAgent   string `json:"claudeUserAgent,omitempty"`
	XaiUserAgent      string `json:"xaiUserAgent,omitempty"`
	OpenCodeUserAgent string `json:"openCodeUserAgent,omitempty"`
	UpdatedAtMs       int64  `json:"updatedAtMs,omitempty"`
}

type refreshUserAgentRequest struct {
	Field            string `json:"field"`
	CurrentUserAgent string `json:"currentUserAgent"`
}

type refreshUserAgentResponse struct {
	Field       string `json:"field"`
	UserAgent   string `json:"userAgent"`
	Version     string `json:"version,omitempty"`
	PackageName string `json:"packageName,omitempty"`
	Source      string `json:"source,omitempty"`
}

type commonParamsUASpec struct {
	Field        string
	PackageName  string
	DefaultValue string
	Prefix       string
}

var (
	semverInUAPattern = regexp.MustCompile(`(?i)(?:^|[^\d])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`)
	npmVersionClient  = &http.Client{Timeout: 12 * time.Second}
)

func defaultCommonParams() CommonParams {
	return CommonParams{
		CodexUserAgent:    "codex-cli/0.142.2",
		ClaudeUserAgent:   "claude-cli/2.1.170",
		XaiUserAgent:      "grok-shell/0.2.93",
		OpenCodeUserAgent: "opencode/0.15.0",
	}
}

func commonParamsUASpecs() map[string]commonParamsUASpec {
	defaults := defaultCommonParams()
	return map[string]commonParamsUASpec{
		"codexUserAgent": {
			Field:        "codexUserAgent",
			PackageName:  "@openai/codex",
			DefaultValue: defaults.CodexUserAgent,
			Prefix:       "codex-cli/",
		},
		"claudeUserAgent": {
			Field:        "claudeUserAgent",
			PackageName:  "@anthropic-ai/claude-code",
			DefaultValue: defaults.ClaudeUserAgent,
			Prefix:       "claude-cli/",
		},
		"xaiUserAgent": {
			Field:        "xaiUserAgent",
			PackageName:  "",
			DefaultValue: defaults.XaiUserAgent,
			Prefix:       "grok-shell/",
		},
		"openCodeUserAgent": {
			Field:        "openCodeUserAgent",
			PackageName:  "opencode-ai",
			DefaultValue: defaults.OpenCodeUserAgent,
			Prefix:       "opencode/",
		},
	}
}

func normalizeCommonParams(raw CommonParams) CommonParams {
	out := defaultCommonParams()
	if strings.TrimSpace(raw.CodexUserAgent) != "" {
		out.CodexUserAgent = strings.TrimSpace(raw.CodexUserAgent)
	}
	if strings.TrimSpace(raw.ClaudeUserAgent) != "" {
		out.ClaudeUserAgent = strings.TrimSpace(raw.ClaudeUserAgent)
	}
	if strings.TrimSpace(raw.XaiUserAgent) != "" {
		out.XaiUserAgent = strings.TrimSpace(raw.XaiUserAgent)
	}
	if strings.TrimSpace(raw.OpenCodeUserAgent) != "" {
		out.OpenCodeUserAgent = strings.TrimSpace(raw.OpenCodeUserAgent)
	}
	return out
}

func (s *Server) handleCommonParams(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}
	cleanPath := strings.TrimRight(r.URL.Path, "/")

	if cleanPath == "/api/common-params" && r.Method == http.MethodGet {
		raw, ok, err := s.store.LoadSetting(r.Context(), commonParamsSettingKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if !ok {
			writeJSON(w, http.StatusOK, defaultCommonParams())
			return
		}
		var params CommonParams
		if err := json.Unmarshal([]byte(raw), &params); err != nil {
			writeJSON(w, http.StatusOK, defaultCommonParams())
			return
		}
		writeJSON(w, http.StatusOK, normalizeCommonParams(params))
		return
	}

	if cleanPath == "/api/common-params" && r.Method == http.MethodPut {
		var req CommonParams
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		normalized := normalizeCommonParams(req)
		normalized.UpdatedAtMs = time.Now().UnixMilli()
		data, err := json.Marshal(normalized)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if err := s.store.SaveSetting(r.Context(), commonParamsSettingKey, string(data)); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, normalized)
		return
	}

	if cleanPath == "/api/common-params/refresh-user-agent" && r.Method == http.MethodPost {
		var req refreshUserAgentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		spec, ok := commonParamsUASpecs()[strings.TrimSpace(req.Field)]
		if !ok {
			writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported user-agent field: %s", req.Field))
			return
		}
		current := strings.TrimSpace(req.CurrentUserAgent)
		if current == "" {
			current = spec.DefaultValue
		}
		version, source, err := fetchLatestCLIVersion(r.Context(), spec)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		nextUA := applyLatestVersionToUserAgent(current, spec, version)
		writeJSON(w, http.StatusOK, refreshUserAgentResponse{
			Field:       spec.Field,
			UserAgent:   nextUA,
			Version:     version,
			PackageName: spec.PackageName,
			Source:      source,
		})
		return
	}

	methodNotAllowed(w)
}

func fetchLatestCLIVersion(ctx context.Context, spec commonParamsUASpec) (version string, source string, err error) {
	if strings.TrimSpace(spec.PackageName) == "" {
		// xAI / Grok does not have a stable public npm package for UA bumping.
		if v := extractSemver(spec.DefaultValue); v != "" {
			return v, "default", nil
		}
		return "", "", fmt.Errorf("no version source configured for %s", spec.Field)
	}

	version, err = fetchNpmLatestVersion(ctx, spec.PackageName)
	if err != nil {
		return "", "", err
	}
	return version, "npm:" + spec.PackageName, nil
}

func fetchNpmLatestVersion(ctx context.Context, packageName string) (string, error) {
	packageName = strings.TrimSpace(packageName)
	if packageName == "" {
		return "", fmt.Errorf("empty package name")
	}
	url := "https://registry.npmjs.org/" + packageName + "/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "CLIProxyAPI-Management-Center")

	resp, err := npmVersionClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("npm registry returned %d for %s", resp.StatusCode, packageName)
	}
	var payload struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	version := strings.TrimSpace(strings.TrimPrefix(payload.Version, "v"))
	if version == "" {
		return "", fmt.Errorf("npm package %s has empty version", packageName)
	}
	return version, nil
}

func extractSemver(value string) string {
	match := semverInUAPattern.FindStringSubmatch(value)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func applyLatestVersionToUserAgent(current string, spec commonParamsUASpec, version string) string {
	current = strings.TrimSpace(current)
	version = strings.TrimSpace(strings.TrimPrefix(version, "v"))
	if version == "" {
		return current
	}
	if current == "" {
		current = spec.DefaultValue
	}

	if prefix := strings.TrimSpace(spec.Prefix); prefix != "" {
		if idx := strings.Index(current, prefix); idx >= 0 {
			start := idx + len(prefix)
			end := start
			for end < len(current) {
				ch := current[end]
				if (ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') {
					end++
					continue
				}
				break
			}
			if end > start {
				return current[:start] + version + current[end:]
			}
			return current[:start] + version + current[start:]
		}
		if !strings.Contains(current, "/") {
			return prefix + version
		}
	}

	if loc := semverInUAPattern.FindStringSubmatchIndex(current); len(loc) >= 4 {
		return current[:loc[2]] + version + current[loc[3]:]
	}

	if prefix := strings.TrimSpace(spec.Prefix); prefix != "" {
		return prefix + version
	}
	return version
}
