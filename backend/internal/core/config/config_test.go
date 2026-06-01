package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadCreatesDefaultConfig(t *testing.T) {
	clearConfigEnv(t)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	t.Setenv(configEnvKey, configPath)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != "0.0.0.0:18317" {
		t.Fatalf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if want := filepath.Join(dir, "data", "usage.sqlite"); cfg.DBPath != want {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, want)
	}
	if !cfg.LocalEngine.Enabled || cfg.LocalEngine.Host != "0.0.0.0" || cfg.LocalEngine.Port != 18318 {
		t.Fatalf("LocalEngine = %#v", cfg.LocalEngine)
	}
	if want := filepath.Join(dir, "data", "cliproxyapi", "config.yaml"); cfg.LocalEngine.ConfigPath != want {
		t.Fatalf("LocalEngine.ConfigPath = %q, want %q", cfg.LocalEngine.ConfigPath, want)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	if !strings.Contains(string(data), `"dataDir": "./data"`) {
		t.Fatalf("generated config does not contain relative dataDir: %s", data)
	}
}

func TestLoadReadsConfigAndResolvesRelativePaths(t *testing.T) {
	clearConfigEnv(t)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	secretPath := filepath.Join(dir, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("secret-value\n"), 0o600); err != nil {
		t.Fatalf("write secret: %v", err)
	}
	if err := os.WriteFile(configPath, []byte(`{
  "httpAddr": "127.0.0.1:19000",
  "dataDir": "state",
  "cpaUpstreamUrl": "http://cpa.local:8317",
  "managementKeyFile": "secret.txt",
  "collectorMode": "http",
  "queue": "custom-usage",
  "popSide": "left",
  "batchSize": 7,
  "pollIntervalMs": 250,
  "queryLimit": 900,
  "panelPath": "panel.html",
  "localEngine": {
    "enabled": false,
    "configPath": "engine/config.yaml",
    "host": "127.0.0.1",
    "port": 19018
  },
  "corsOrigins": ["http://panel.local"],
  "tlsSkipVerify": true
}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(configEnvKey, configPath)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != "127.0.0.1:19000" {
		t.Fatalf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if want := filepath.Join(dir, "state", "usage.sqlite"); cfg.DBPath != want {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, want)
	}
	if cfg.CPAUpstreamURL != "http://cpa.local:8317" {
		t.Fatalf("CPAUpstreamURL = %q", cfg.CPAUpstreamURL)
	}
	if cfg.ManagementKey != "secret-value" {
		t.Fatalf("ManagementKey = %q", cfg.ManagementKey)
	}
	if cfg.CollectorMode != "http" || cfg.Queue != "custom-usage" || cfg.PopSide != "left" {
		t.Fatalf("collector config = %#v", cfg)
	}
	if cfg.BatchSize != 7 || cfg.PollInterval != 250*time.Millisecond || cfg.QueryLimit != 900 {
		t.Fatalf("numeric config = %#v", cfg)
	}
	if want := filepath.Join(dir, "panel.html"); cfg.PanelPath != want {
		t.Fatalf("PanelPath = %q, want %q", cfg.PanelPath, want)
	}
	if len(cfg.CORSOrigins) != 1 || cfg.CORSOrigins[0] != "http://panel.local" {
		t.Fatalf("CORSOrigins = %#v", cfg.CORSOrigins)
	}
	if !cfg.TLSSkipVerify {
		t.Fatal("TLSSkipVerify = false")
	}
	if cfg.LocalEngine.Enabled || cfg.LocalEngine.Host != "127.0.0.1" || cfg.LocalEngine.Port != 19018 {
		t.Fatalf("LocalEngine = %#v", cfg.LocalEngine)
	}
	if want := filepath.Join(dir, "engine", "config.yaml"); cfg.LocalEngine.ConfigPath != want {
		t.Fatalf("LocalEngine.ConfigPath = %q, want %q", cfg.LocalEngine.ConfigPath, want)
	}
}

func TestLoadEnvOverridesConfig(t *testing.T) {
	clearConfigEnv(t)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(configPath, []byte(`{
  "httpAddr": "127.0.0.1:19000",
  "dataDir": "state",
  "managementKeyFile": "secret.txt",
  "batchSize": 7
}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(configEnvKey, configPath)
	t.Setenv("HTTP_ADDR", "127.0.0.1:19001")
	t.Setenv("USAGE_DATA_DIR", filepath.Join(dir, "env-data"))
	t.Setenv("CPA_MANAGEMENT_KEY", "env-secret")
	t.Setenv("USAGE_BATCH_SIZE", "12")
	t.Setenv("CPAMC_LOCAL_ENGINE_ENABLED", "false")
	t.Setenv("CPAMC_LOCAL_ENGINE_CONFIG", filepath.Join(dir, "local-engine.yaml"))
	t.Setenv("CPAMC_LOCAL_ENGINE_HOST", "127.0.0.2")
	t.Setenv("CPAMC_LOCAL_ENGINE_PORT", "19019")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != "127.0.0.1:19001" {
		t.Fatalf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if want := filepath.Join(dir, "env-data", "usage.sqlite"); cfg.DBPath != want {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, want)
	}
	if cfg.ManagementKey != "env-secret" {
		t.Fatalf("ManagementKey = %q", cfg.ManagementKey)
	}
	if cfg.BatchSize != 12 {
		t.Fatalf("BatchSize = %d", cfg.BatchSize)
	}
	if cfg.LocalEngine.Enabled || cfg.LocalEngine.Host != "127.0.0.2" || cfg.LocalEngine.Port != 19019 {
		t.Fatalf("LocalEngine = %#v", cfg.LocalEngine)
	}
	if cfg.LocalEngine.ConfigPath != filepath.Join(dir, "local-engine.yaml") {
		t.Fatalf("LocalEngine.ConfigPath = %q", cfg.LocalEngine.ConfigPath)
	}
}

func TestNormalizeCollectorMode(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"", "auto"},
		{"AUTO", "auto"},
		{"http", "http"},
		{"HTTP", "http"},
		{"resp", "resp"},
		{"subscribe", "subscribe"},
		{" Subscribe ", "subscribe"},
		{"unknown", "auto"},
	}
	for _, tc := range cases {
		if got := normalizeCollectorMode(tc.input); got != tc.want {
			t.Errorf("normalizeCollectorMode(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestLoadDebugDatabasesFromConfig(t *testing.T) {
	clearConfigEnv(t)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(configPath, []byte(`{
  "httpAddr": "127.0.0.1:19000",
  "dataDir": "state",
  "debugDatabases": [
    {"id": "billing", "label": "Billing", "path": "billing.sqlite"},
    {"id": "primary", "label": "ignored", "path": "x.sqlite"},
    {"id": "", "path": "y.sqlite"}
  ]
}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(configEnvKey, configPath)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.DebugDatabases) != 1 {
		t.Fatalf("DebugDatabases = %#v", cfg.DebugDatabases)
	}
	if cfg.DebugDatabases[0].ID != "billing" {
		t.Fatalf("id = %q", cfg.DebugDatabases[0].ID)
	}
	if want := filepath.Join(dir, "billing.sqlite"); cfg.DebugDatabases[0].Path != want {
		t.Fatalf("path = %q, want %q", cfg.DebugDatabases[0].Path, want)
	}
}

func TestLoadDebugDatabasesFromEnvOverridesConfig(t *testing.T) {
	clearConfigEnv(t)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(configPath, []byte(`{
  "dataDir": "state",
  "debugDatabases": [{"id": "from-file", "path": "file.sqlite"}]
}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(configEnvKey, configPath)
	t.Setenv("USAGE_DEBUG_DB_PATHS", "extra:Extra DB:"+filepath.Join(dir, "extra.sqlite")+",solo:"+filepath.Join(dir, "solo.sqlite"))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.DebugDatabases) != 2 {
		t.Fatalf("DebugDatabases = %#v", cfg.DebugDatabases)
	}
	if cfg.DebugDatabases[0].ID != "extra" || cfg.DebugDatabases[0].Label != "Extra DB" {
		t.Fatalf("first = %#v", cfg.DebugDatabases[0])
	}
	if cfg.DebugDatabases[1].ID != "solo" || cfg.DebugDatabases[1].Label != "solo" {
		t.Fatalf("second = %#v", cfg.DebugDatabases[1])
	}
}

func TestSplitDebugDatabaseEntry(t *testing.T) {
	id, label, path := splitDebugDatabaseEntry("billing:Billing:/data/billing.sqlite")
	if id != "billing" || label != "Billing" || path != "/data/billing.sqlite" {
		t.Fatalf("got %q %q %q", id, label, path)
	}
	id, label, path = splitDebugDatabaseEntry("solo:/tmp/a.sqlite")
	if id != "solo" || label != "" || path != "/tmp/a.sqlite" {
		t.Fatalf("got %q %q %q", id, label, path)
	}
}

func clearConfigEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		configEnvKey,
		"HTTP_ADDR",
		"USAGE_DATA_DIR",
		"USAGE_DB_PATH",
		"CPA_UPSTREAM_URL",
		"CPA_MANAGEMENT_KEY",
		"CPA_MANAGEMENT_KEY_FILE",
		"USAGE_COLLECTOR_MODE",
		"USAGE_RESP_QUEUE",
		"USAGE_RESP_POP_SIDE",
		"USAGE_BATCH_SIZE",
		"USAGE_POLL_INTERVAL_MS",
		"USAGE_QUERY_LIMIT",
		"USAGE_CORS_ORIGINS",
		"USAGE_RESP_TLS_SKIP_VERIFY",
		"PANEL_PATH",
		"USAGE_DEBUG_DB_PATHS",
		"CPAMC_LOCAL_ENGINE_ENABLED",
		"CPAMC_LOCAL_ENGINE_CONFIG",
		"CPAMC_LOCAL_ENGINE_HOST",
		"CPAMC_LOCAL_ENGINE_PORT",
	} {
		t.Setenv(key, "")
	}
}
