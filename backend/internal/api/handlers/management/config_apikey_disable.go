package management

import (
	"fmt"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/watcher/synthesizer"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
)

const configAPIKeyDisablePattern = "*"

func setConfigAPIKeyExcludedAll(models []string, disable bool) []string {
	if disable {
		for _, item := range models {
			if strings.TrimSpace(item) == configAPIKeyDisablePattern {
				return config.NormalizeExcludedModels(models)
			}
		}
		return config.NormalizeExcludedModels(append(append([]string(nil), models...), configAPIKeyDisablePattern))
	}
	filtered := make([]string, 0, len(models))
	for _, item := range models {
		if strings.TrimSpace(item) == configAPIKeyDisablePattern {
			continue
		}
		filtered = append(filtered, item)
	}
	return config.NormalizeExcludedModels(filtered)
}

func toggleConfigAPIKeyExcludedAll(cfg *config.Config, auth *coreauth.Auth, disable bool) (bool, error) {
	if cfg == nil || auth == nil || !coreauth.IsConfigAPIKeyAuth(auth) {
		return false, nil
	}
	authID := strings.TrimSpace(auth.ID)
	if authID == "" {
		return false, fmt.Errorf("auth id is empty")
	}

	idGen := synthesizer.NewStableIDGenerator()

	for i := range cfg.GeminiKey {
		entry := &cfg.GeminiKey[i]
		id, _ := idGen.Next("gemini:apikey", entry.APIKey, entry.BaseURL)
		if id == authID {
			entry.ExcludedModels = setConfigAPIKeyExcludedAll(entry.ExcludedModels, disable)
			return true, nil
		}
	}
	for i := range cfg.InteractionsKey {
		entry := &cfg.InteractionsKey[i]
		id, _ := idGen.Next("gemini-interactions:apikey", entry.APIKey, entry.BaseURL)
		if id == authID {
			entry.ExcludedModels = setConfigAPIKeyExcludedAll(entry.ExcludedModels, disable)
			return true, nil
		}
	}
	for i := range cfg.ClaudeKey {
		entry := &cfg.ClaudeKey[i]
		id, _ := idGen.Next("claude:apikey", entry.APIKey, entry.BaseURL)
		if id == authID {
			entry.ExcludedModels = setConfigAPIKeyExcludedAll(entry.ExcludedModels, disable)
			return true, nil
		}
	}
	for i := range cfg.CodexKey {
		entry := &cfg.CodexKey[i]
		id, _ := idGen.Next("codex:apikey", entry.APIKey, entry.BaseURL)
		if id == authID {
			entry.ExcludedModels = setConfigAPIKeyExcludedAll(entry.ExcludedModels, disable)
			return true, nil
		}
	}
	for i := range cfg.XAIKey {
		entry := &cfg.XAIKey[i]
		id, _ := idGen.Next("xai:apikey", entry.APIKey, entry.BaseURL)
		if id == authID {
			entry.ExcludedModels = setConfigAPIKeyExcludedAll(entry.ExcludedModels, disable)
			return true, nil
		}
	}
	for i := range cfg.VertexCompatAPIKey {
		entry := &cfg.VertexCompatAPIKey[i]
		id, _ := idGen.Next("vertex:apikey", entry.APIKey, entry.BaseURL, entry.ProxyURL)
		if id == authID {
			entry.ExcludedModels = setConfigAPIKeyExcludedAll(entry.ExcludedModels, disable)
			return true, nil
		}
	}

	// OpenAI-compatible: always provider-level Disabled.
	// Only allowed when the provider has fewer than 2 API keys (single-key / legacy).
	// Multi-key providers must be managed on the service-providers page; per-key
	// disable is intentionally not supported on the community config model.
	for i := range cfg.OpenAICompatibility {
		compat := &cfg.OpenAICompatibility[i]
		providerName := strings.ToLower(strings.TrimSpace(compat.Name))
		if providerName == "" {
			providerName = "openai-compatibility"
		}
		base := strings.TrimSpace(compat.BaseURL)
		idKind := fmt.Sprintf("openai-compatibility:%s", providerName)
		keyCount := countOpenAICompatAPIKeys(compat.APIKeyEntries)
		displayName := strings.TrimSpace(compat.Name)
		if displayName == "" {
			displayName = providerName
		}

		if len(compat.APIKeyEntries) == 0 {
			id, _ := idGen.Next(idKind, base)
			if id == authID {
				// Legacy entry without api-key-entries: treat as a single virtual account.
				compat.Disabled = disable
				return true, nil
			}
			continue
		}

		for j := range compat.APIKeyEntries {
			entry := &compat.APIKeyEntries[j]
			key := strings.TrimSpace(entry.APIKey)
			proxyURL := strings.TrimSpace(entry.ProxyURL)
			id, _ := idGen.Next(idKind, key, base, proxyURL)
			if id != authID {
				continue
			}
			if keyCount >= 2 {
				action := "enable"
				if disable {
					action = "disable"
				}
				return false, fmt.Errorf(
					"openai-compat provider %q has %d api keys; management %s is only allowed when key count < 2 (provider-level disable)",
					displayName,
					keyCount,
					action,
				)
			}
			compat.Disabled = disable
			return true, nil
		}
	}

	return false, nil
}

func countOpenAICompatAPIKeys(entries []config.OpenAICompatibilityAPIKey) int {
	count := 0
	for i := range entries {
		if strings.TrimSpace(entries[i].APIKey) != "" {
			count++
		}
	}
	return count
}
