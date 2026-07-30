package management

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
)

func TestGetPluginProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if errWrite := os.WriteFile(configPath, []byte("proxy-url: http://system:1\nplugin-proxy:\n  url: socks5://custom:1080\n  status: 2\n"), 0o600); errWrite != nil {
		t.Fatalf("write config: %v", errWrite)
	}
	cfg, errLoad := config.LoadConfig(configPath)
	if errLoad != nil {
		t.Fatalf("LoadConfig: %v", errLoad)
	}

	h := &Handler{cfg: cfg, configFilePath: configPath}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v0/management/plugin-proxy", nil)
	h.GetPluginProxy(c)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &payload); errDecode != nil {
		t.Fatalf("decode: %v", errDecode)
	}
	if payload["proxy-url"] != "http://system:1" {
		t.Fatalf("proxy-url = %#v", payload["proxy-url"])
	}
	if payload["effective"] != "http://system:1" {
		t.Fatalf("effective = %#v", payload["effective"])
	}
	pluginProxy, ok := payload["plugin-proxy"].(map[string]any)
	if !ok {
		t.Fatalf("plugin-proxy missing: %#v", payload)
	}
	if pluginProxy["status"] != float64(2) {
		t.Fatalf("status = %#v", pluginProxy["status"])
	}
	if pluginProxy["url"] != "socks5://custom:1080" {
		t.Fatalf("url = %#v", pluginProxy["url"])
	}
}

func TestPutPluginProxyCustomValidatesAndPersists(t *testing.T) {
	gin.SetMode(gin.TestMode)

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if errWrite := os.WriteFile(configPath, []byte("proxy-url: http://system:1\n"), 0o600); errWrite != nil {
		t.Fatalf("write config: %v", errWrite)
	}
	cfg, errLoad := config.LoadConfig(configPath)
	if errLoad != nil {
		t.Fatalf("LoadConfig: %v", errLoad)
	}
	h := &Handler{cfg: cfg, configFilePath: configPath}

	badBody := bytes.NewBufferString(`{"value":{"status":1,"url":"not-a-proxy"}}`)
	badRec := httptest.NewRecorder()
	badCtx, _ := gin.CreateTestContext(badRec)
	badCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", badBody)
	badCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(badCtx)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid custom status = %d, body=%s", badRec.Code, badRec.Body.String())
	}

	okBody := bytes.NewBufferString(`{"value":{"status":1,"url":"socks5://user:pass@127.0.0.1:1080"}}`)
	okRec := httptest.NewRecorder()
	okCtx, _ := gin.CreateTestContext(okRec)
	okCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", okBody)
	okCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(okCtx)
	if okRec.Code != http.StatusOK {
		t.Fatalf("valid custom status = %d, body=%s", okRec.Code, okRec.Body.String())
	}
	if h.cfg.PluginProxy.Status != config.PluginProxyStatusCustom {
		t.Fatalf("cfg after custom = %#v", h.cfg.PluginProxy)
	}
	if config.EffectivePluginStoreProxyURL(h.cfg) != "socks5://user:pass@127.0.0.1:1080" {
		t.Fatalf("effective after custom = %q", config.EffectivePluginStoreProxyURL(h.cfg))
	}

	noneBody := bytes.NewBufferString(`{"status":0}`)
	noneRec := httptest.NewRecorder()
	noneCtx, _ := gin.CreateTestContext(noneRec)
	noneCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", noneBody)
	noneCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(noneCtx)
	if noneRec.Code != http.StatusOK {
		t.Fatalf("none status = %d, body=%s", noneRec.Code, noneRec.Body.String())
	}
	if h.cfg.PluginProxy.Status != config.PluginProxyStatusNone {
		t.Fatalf("cfg after none = %#v", h.cfg.PluginProxy)
	}
	if h.cfg.PluginProxy.URL != "socks5://user:pass@127.0.0.1:1080" {
		t.Fatalf("url should be retained after disable, got %q", h.cfg.PluginProxy.URL)
	}
	if config.EffectivePluginStoreProxyURL(h.cfg) != "" {
		t.Fatalf("effective after none should be empty")
	}

	sysBody := bytes.NewBufferString(`{"status":2}`)
	sysRec := httptest.NewRecorder()
	sysCtx, _ := gin.CreateTestContext(sysRec)
	sysCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", sysBody)
	sysCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(sysCtx)
	if sysRec.Code != http.StatusOK {
		t.Fatalf("system status = %d, body=%s", sysRec.Code, sysRec.Body.String())
	}
	if h.cfg.PluginProxy.Status != config.PluginProxyStatusSystem {
		t.Fatalf("cfg after system = %#v", h.cfg.PluginProxy)
	}
	if config.EffectivePluginStoreProxyURL(h.cfg) != "http://system:1" {
		t.Fatalf("effective after system = %q", config.EffectivePluginStoreProxyURL(h.cfg))
	}
}

func TestValidatePluginProxyURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{}

	badRec := httptest.NewRecorder()
	badCtx, _ := gin.CreateTestContext(badRec)
	badCtx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/plugin-proxy/validate", bytes.NewBufferString(`{"url":"ftp://x"}`))
	badCtx.Request.Header.Set("Content-Type", "application/json")
	h.ValidatePluginProxyURL(badCtx)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("bad validate status = %d", badRec.Code)
	}

	okRec := httptest.NewRecorder()
	okCtx, _ := gin.CreateTestContext(okRec)
	okCtx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/plugin-proxy/validate", bytes.NewBufferString(`{"url":"https://proxy.example:8443"}`))
	okCtx.Request.Header.Set("Content-Type", "application/json")
	h.ValidatePluginProxyURL(okCtx)
	if okRec.Code != http.StatusOK {
		t.Fatalf("ok validate status = %d body=%s", okRec.Code, okRec.Body.String())
	}
}

func TestPutPluginProxyAcceleratorValidatesAndPersists(t *testing.T) {
	gin.SetMode(gin.TestMode)

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if errWrite := os.WriteFile(configPath, []byte("proxy-url: http://system:1\n"), 0o600); errWrite != nil {
		t.Fatalf("write config: %v", errWrite)
	}
	cfg, errLoad := config.LoadConfig(configPath)
	if errLoad != nil {
		t.Fatalf("LoadConfig: %v", errLoad)
	}
	h := &Handler{cfg: cfg, configFilePath: configPath}

	badBody := bytes.NewBufferString(`{"value":{"status":3,"accelerator":"socks5://127.0.0.1:1080"}}`)
	badRec := httptest.NewRecorder()
	badCtx, _ := gin.CreateTestContext(badRec)
	badCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", badBody)
	badCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(badCtx)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid accelerator status = %d, body=%s", badRec.Code, badRec.Body.String())
	}

	okBody := bytes.NewBufferString(`{"value":{"status":3,"accelerator":"https://gh-proxy.com"}}`)
	okRec := httptest.NewRecorder()
	okCtx, _ := gin.CreateTestContext(okRec)
	okCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", okBody)
	okCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(okCtx)
	if okRec.Code != http.StatusOK {
		t.Fatalf("valid accelerator status = %d, body=%s", okRec.Code, okRec.Body.String())
	}
	if h.cfg.PluginProxy.Status != config.PluginProxyStatusAccelerator {
		t.Fatalf("cfg after accelerator = %#v", h.cfg.PluginProxy)
	}
	if h.cfg.PluginProxy.Accelerator != "https://gh-proxy.com/" {
		t.Fatalf("accelerator = %q", h.cfg.PluginProxy.Accelerator)
	}
	if config.EffectivePluginStoreProxyURL(h.cfg) != "" {
		t.Fatalf("effective traditional proxy should be empty for accelerator, got %q", config.EffectivePluginStoreProxyURL(h.cfg))
	}
	if config.EffectivePluginStoreAcceleratorBase(h.cfg) != "https://gh-proxy.com/" {
		t.Fatalf("effective accelerator = %q", config.EffectivePluginStoreAcceleratorBase(h.cfg))
	}

	noneBody := bytes.NewBufferString(`{"status":0}`)
	noneRec := httptest.NewRecorder()
	noneCtx, _ := gin.CreateTestContext(noneRec)
	noneCtx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/plugin-proxy", noneBody)
	noneCtx.Request.Header.Set("Content-Type", "application/json")
	h.PutPluginProxy(noneCtx)
	if noneRec.Code != http.StatusOK {
		t.Fatalf("none status = %d, body=%s", noneRec.Code, noneRec.Body.String())
	}
	if h.cfg.PluginProxy.Status != config.PluginProxyStatusNone {
		t.Fatalf("cfg after none = %#v", h.cfg.PluginProxy)
	}
	if h.cfg.PluginProxy.Accelerator != "https://gh-proxy.com/" {
		t.Fatalf("accelerator should be retained after disable, got %q", h.cfg.PluginProxy.Accelerator)
	}
	if config.EffectivePluginStoreAcceleratorBase(h.cfg) != "" {
		t.Fatalf("effective accelerator after none should be empty")
	}
}

func TestValidatePluginProxyAcceleratorURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{}

	badRec := httptest.NewRecorder()
	badCtx, _ := gin.CreateTestContext(badRec)
	badCtx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/plugin-proxy/validate", bytes.NewBufferString(`{"status":3,"accelerator":"socks5://127.0.0.1:1080"}`))
	badCtx.Request.Header.Set("Content-Type", "application/json")
	h.ValidatePluginProxyURL(badCtx)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("bad accelerator validate status = %d body=%s", badRec.Code, badRec.Body.String())
	}

	okRec := httptest.NewRecorder()
	okCtx, _ := gin.CreateTestContext(okRec)
	okCtx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/plugin-proxy/validate", bytes.NewBufferString(`{"status":3,"accelerator":"https://gh-proxy.com"}`))
	okCtx.Request.Header.Set("Content-Type", "application/json")
	h.ValidatePluginProxyURL(okCtx)
	if okRec.Code != http.StatusOK {
		t.Fatalf("ok accelerator validate status = %d body=%s", okRec.Code, okRec.Body.String())
	}
	var payload map[string]any
	if errDecode := json.Unmarshal(okRec.Body.Bytes(), &payload); errDecode != nil {
		t.Fatalf("decode: %v", errDecode)
	}
	if payload["valid"] != true {
		t.Fatalf("valid = %#v", payload["valid"])
	}
	if payload["accelerator"] != "https://gh-proxy.com/" {
		t.Fatalf("accelerator = %#v", payload["accelerator"])
	}
}
