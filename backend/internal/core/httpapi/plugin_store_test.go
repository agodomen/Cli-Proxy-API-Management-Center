package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	communityconfig "github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	communitypluginstore "github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginstore"
	"gopkg.in/yaml.v3"
)

func TestHandleCorePluginStoreRequiresLocalEngine(t *testing.T) {
	handler := newPluginProxyTestHandler(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v0/cpamc/plugin-store", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestCorePluginSourceMatchesConfiguredManifest(t *testing.T) {
	t.Parallel()

	var raw yaml.Node
	if err := raw.Encode(map[string]any{
		"enabled": true,
		"store": map[string]any{
			"source-id":  "official",
			"source-url": communitypluginstore.DefaultRegistryURL,
		},
	}); err != nil {
		t.Fatal(err)
	}
	item := communityconfig.PluginInstanceConfig{Raw: raw}
	sourceID, sourceURL, managed := coreConfiguredPluginSource(item)
	status := corePluginStatus{InstalledSourceID: sourceID, InstalledSourceURL: sourceURL, StoreManaged: managed}
	if !corePluginSourceMatches(status, communitypluginstore.DefaultSource()) {
		t.Fatal("configured official source should match")
	}
	if corePluginSourceMatches(status, communitypluginstore.Source{ID: "other", URL: "https://example.com/registry.json"}) {
		t.Fatal("different source should not match")
	}
}

func TestCorePluginStatusesUsesRuntimeRegistration(t *testing.T) {
	enabled := true
	configs := map[string]communityconfig.PluginInstanceConfig{
		"active-plugin": {Enabled: &enabled},
	}
	statuses, err := corePluginStatuses(true, filepath.Join(t.TempDir(), "plugins"), configs, func(id string) bool {
		return id == "active-plugin"
	})
	if err != nil {
		t.Fatalf("corePluginStatuses() error = %v", err)
	}
	status := statuses["active-plugin"]
	if !status.Registered || !status.EffectiveEnabled {
		t.Fatalf("status = %#v, want registered and effectively enabled", status)
	}
}

func TestHandleCorePluginStoreRejectsInvalidPluginID(t *testing.T) {
	handler := newPluginProxyTestHandler(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v0/cpamc/plugin-store/not%20valid/install", http.NoBody)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
}
