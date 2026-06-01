package probe

import "testing"

func TestUpsertOpenAIProviderFiltersUnavailableKeys(t *testing.T) {
	snapshot := providerSyncSnapshot{
		ID: 1, Name: "Example", Status: 1, BaseURL: "https://api.example.com/", Param: `{}`,
		Keys: []providerSyncKey{
			{AuthType: 1, AuthValue: "sk-valid", Status: 200, Priority: 9},
			{AuthType: 1, AuthValue: "sk-invalid", Status: -401, Priority: 10},
			{AuthType: 3, AuthValue: `{"token":"secret"}`, Status: 200, Priority: 8},
		},
	}
	result := upsertOpenAIProvider([]map[string]any{{"name": "Example", "custom": true}}, snapshot)
	if len(result) != 1 {
		t.Fatalf("providers=%d", len(result))
	}
	entries, ok := result[0]["api-key-entries"].([]map[string]any)
	if !ok || len(entries) != 1 || entries[0]["api-key"] != "sk-valid" {
		t.Fatalf("entries=%#v", result[0]["api-key-entries"])
	}
	if result[0]["disabled"] != false || result[0]["priority"] != 9 || result[0]["custom"] != true {
		t.Fatalf("provider=%#v", result[0])
	}
}

func TestUpsertNativeProviderRemovesOfflineKeys(t *testing.T) {
	snapshot := providerSyncSnapshot{ID: 1, Name: "Gemini", Status: 1, BaseURL: "https://gemini.example.com", Keys: []providerSyncKey{{AuthType: 1, AuthValue: "old", Status: -1}, {AuthType: 1, AuthValue: "new", Status: 1, Priority: 3}}}
	result := upsertNativeProvider([]map[string]any{{"api-key": "old"}, {"api-key": "other"}}, snapshot)
	if len(result) != 2 {
		t.Fatalf("configs=%#v", result)
	}
	if result[0]["api-key"] != "other" || result[1]["api-key"] != "new" {
		t.Fatalf("configs=%#v", result)
	}
}
