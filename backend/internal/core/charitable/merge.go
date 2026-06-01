package charitable

import (
	"encoding/json"
	"strings"
)

// MergeParams performs a three-level, first-level-only override merge:
// channel → provider → key. Sub-objects are replaced wholesale, not deep-merged.
func MergeParams(channelParam, providerParam, keyParam string) (map[string]any, error) {
	channel := parseJSON(channelParam)
	provider := parseJSON(providerParam)
	key := parseJSON(keyParam)

	result := make(map[string]any, len(channel)+len(provider)+len(key))
	for k, v := range channel {
		result[k] = v
	}
	for k, v := range provider {
		result[k] = v
	}
	for k, v := range key {
		result[k] = v
	}
	return result, nil
}

// parseJSON safely parses a JSON string. Returns an empty map on any failure.
func parseJSON(raw string) map[string]any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "{}" {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(trimmed), &m); err != nil {
		return map[string]any{}
	}
	return m
}

// SupportsProtocol reports whether apiType includes the given protocol prime
// (e.g. 2=OpenAI, 3=Anthropic, 5=Gemini, 7=Responses).
func SupportsProtocol(apiType int, protocolPrime int) bool {
	if apiType <= 0 || protocolPrime <= 0 {
		return false
	}
	return apiType%protocolPrime == 0
}
