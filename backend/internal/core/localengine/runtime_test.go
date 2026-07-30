package localengine

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

func TestNewDisabledReturnsNil(t *testing.T) {
	runtime, err := New(config.LocalEngineConfig{}, nil)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if runtime != nil {
		t.Fatalf("runtime = %#v, want nil", runtime)
	}
}

func TestNewCreatesConfigAndBuildsRuntime(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "engine", "config.yaml")
	runtime, err := New(config.LocalEngineConfig{
		Enabled:    true,
		ConfigPath: configPath,
		Host:       "127.0.0.1",
		Port:       19018,
	}, nil)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if runtime == nil {
		t.Fatal("runtime is nil")
	}
	status := runtime.Status()
	if !status.Enabled || status.Running || status.Address != "127.0.0.1:19018" {
		t.Fatalf("status = %#v", status)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(data), "port: 19018") || !strings.Contains(string(data), "usage-statistics-enabled: true") {
		t.Fatalf("generated config = %s", data)
	}
	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatalf("stat config: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o", info.Mode().Perm())
	}
}

func TestResolveAuthDirRelativeToConfig(t *testing.T) {
	dir := t.TempDir()
	got, err := resolveAuthDir("auths", dir)
	if err != nil {
		t.Fatalf("resolveAuthDir() error = %v", err)
	}
	if want := filepath.Join(dir, "auths"); got != want {
		t.Fatalf("resolveAuthDir() = %q, want %q", got, want)
	}
}

func TestRuntimeServesHealthzAndStopsWithContext(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("close reserved port: %v", err)
	}

	dir := t.TempDir()
	runtime, err := New(config.LocalEngineConfig{
		Enabled:    true,
		ConfigPath: filepath.Join(dir, "config.yaml"),
		Host:       "127.0.0.1",
		Port:       port,
	}, nil)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- runtime.Run(ctx) }()

	url := fmt.Sprintf("http://127.0.0.1:%d/healthz", port)
	deadline := time.Now().Add(5 * time.Second)
	for {
		response, requestErr := http.Get(url)
		if requestErr == nil {
			_ = response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("health status = %d", response.StatusCode)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("local engine did not become ready: %v", requestErr)
		}
		time.Sleep(25 * time.Millisecond)
	}

	cancel()
	select {
	case runErr := <-errCh:
		if runErr != nil {
			t.Fatalf("Run() error = %v", runErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("local engine did not stop")
	}
	if runtime.Status().Running {
		t.Fatalf("status = %#v", runtime.Status())
	}
}

func TestInjectManagementSecretFromEnv_NoPassword_Noop(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("remote-management:\n  secret-key: \"\"\n  allow-remote: false\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("MANAGEMENT_PASSWORD", "")
	t.Setenv("MANAGEMENT_REMOTE", "1")

	applied, err := injectManagementSecretFromEnv(configPath)
	if err != nil {
		t.Fatalf("injectManagementSecretFromEnv() error = %v", err)
	}
	if applied {
		t.Fatal("expected applied=false without MANAGEMENT_PASSWORD")
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if strings.Contains(string(data), "allow-remote: true") {
		t.Fatalf("expected no mutation without MANAGEMENT_PASSWORD, got:\n%s", data)
	}
}

func TestInjectManagementSecretFromEnv_EmptySecret_WritesPasswordAndRemote(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	initial := "remote-management:\n  secret-key: \"\"\n  allow-remote: false\n"
	if err := os.WriteFile(configPath, []byte(initial), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("MANAGEMENT_PASSWORD", "bootstrap-secret")
	t.Setenv("MANAGEMENT_REMOTE", "1")

	applied, err := injectManagementSecretFromEnv(configPath)
	if err != nil {
		t.Fatalf("injectManagementSecretFromEnv() error = %v", err)
	}
	if !applied {
		t.Fatal("expected applied=true when secret-key is empty")
	}

	// After injection the file holds plaintext; New() later calls cliproxyconfig.LoadConfig
	// which hashes it and writes back the bcrypt form (tested in TestNewBootstrapsSecretFromEnvAndHashes).
	if got := nestedScalarFromFile(t, configPath, "remote-management", "secret-key"); got != "bootstrap-secret" {
		t.Fatalf("secret-key = %q, want bootstrap-secret", got)
	}
	if got := nestedScalarFromFile(t, configPath, "remote-management", "allow-remote"); got != "true" {
		t.Fatalf("allow-remote = %q, want true", got)
	}
}

func TestInjectManagementSecretFromEnv_ExistingSecret_NotOverwritten(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	initial := "remote-management:\n  secret-key: existing-secret\n  allow-remote: false\n"
	if err := os.WriteFile(configPath, []byte(initial), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("MANAGEMENT_PASSWORD", "new-secret-from-env")
	t.Setenv("MANAGEMENT_REMOTE", "1")

	applied, err := injectManagementSecretFromEnv(configPath)
	if err != nil {
		t.Fatalf("injectManagementSecretFromEnv() error = %v", err)
	}
	if applied {
		t.Fatal("expected applied=false when secret-key already exists")
	}
	if got := nestedScalarFromFile(t, configPath, "remote-management", "secret-key"); got != "existing-secret" {
		t.Fatalf("secret-key = %q, want existing-secret (must not overwrite)", got)
	}
	if got := nestedScalarFromFile(t, configPath, "remote-management", "allow-remote"); got != "false" {
		t.Fatalf("allow-remote = %q, want false (must not mutate when secret already set)", got)
	}
}

func TestInjectManagementSecretFromEnv_RemoteFalseByDefault(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("remote-management:\n  secret-key: \"\"\n  allow-remote: true\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("MANAGEMENT_PASSWORD", "only-local")
	t.Setenv("MANAGEMENT_REMOTE", "") // unset / empty → force false

	applied, err := injectManagementSecretFromEnv(configPath)
	if err != nil {
		t.Fatalf("injectManagementSecretFromEnv() error = %v", err)
	}
	if !applied {
		t.Fatal("expected applied=true for empty secret-key")
	}
	if got := nestedScalarFromFile(t, configPath, "remote-management", "allow-remote"); got != "false" {
		t.Fatalf("allow-remote = %q, want false when MANAGEMENT_REMOTE is unset", got)
	}
}

func TestNewBootstrapsSecretFromEnvAndHashes(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "engine", "config.yaml")
	t.Setenv("MANAGEMENT_PASSWORD", "login-password")
	t.Setenv("MANAGEMENT_REMOTE", "1")

	runtime, err := New(config.LocalEngineConfig{
		Enabled:    true,
		ConfigPath: configPath,
		Host:       "127.0.0.1",
		Port:       19019,
	}, nil)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if runtime == nil {
		t.Fatal("runtime is nil")
	}

	// After New(), LoadConfig has already hashed and written the bcrypt form.
	secret := nestedScalarFromFile(t, configPath, "remote-management", "secret-key")
	if secret == "" || secret == "login-password" {
		t.Fatalf("secret-key should be bcrypt-hashed after New(), got %q", secret)
	}
	if !strings.HasPrefix(secret, "$2a$") && !strings.HasPrefix(secret, "$2b$") && !strings.HasPrefix(secret, "$2y$") {
		t.Fatalf("secret-key does not look like bcrypt: %q", secret)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(secret), []byte("login-password")); err != nil {
		t.Fatalf("bcrypt.CompareHashAndPassword() error = %v", err)
	}
	if got := nestedScalarFromFile(t, configPath, "remote-management", "allow-remote"); got != "true" {
		t.Fatalf("allow-remote = %q, want true", got)
	}
}

func nestedScalarFromFile(t *testing.T, path string, keys ...string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 {
		t.Fatalf("invalid yaml document in %s", path)
	}
	return nestedScalarValue(root.Content[0], keys...)
}
