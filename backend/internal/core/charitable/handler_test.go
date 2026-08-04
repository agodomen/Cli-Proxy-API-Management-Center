package charitable

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	s, err := store.Open(t.TempDir() + "/charitable.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	cs := NewCharitableStore(s.DB())
	h := NewHandler(cs)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return mux
}

func TestHandlerChannelCRUD(t *testing.T) {
	handler := newTestHandler(t)

	// Create
	body := `{"channel_name":"test-ch","description":"test channel","param":"{\"k\":\"v\"}","url":"https://example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/channels", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var ch Channel
	json.Unmarshal(rr.Body.Bytes(), &ch)
	if ch.ChannelID == 0 {
		t.Fatalf("missing channel ID")
	}

	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/channels/"+itoa(ch.ChannelID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get status = %d", rr.Code)
	}

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/channels?page=1&page_size=10", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d", rr.Code)
	}
	var list PageResult[Channel]
	json.Unmarshal(rr.Body.Bytes(), &list)
	if list.TotalItems != 4 {
		t.Fatalf("total = %d, want 4 including preset channels", list.TotalItems)
	}

	// Update
	body = `{"channel_name":"updated-ch","param":"{}","url":""}`
	req = httptest.NewRequest(http.MethodPut, "/api/charitable/channels/"+itoa(ch.ChannelID), strings.NewReader(body))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/charitable/channels/"+itoa(ch.ChannelID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete status = %d", rr.Code)
	}

	// Get after soft delete → still returns row (status=-1), but excluded from list
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/channels/"+itoa(ch.ChannelID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get after soft delete status = %d", rr.Code)
	}
	var deleted Channel
	json.Unmarshal(rr.Body.Bytes(), &deleted)
	if deleted.Status != -1 {
		t.Fatalf("status = %d, want -1", deleted.Status)
	}
}

func TestHandlerProviderCRUD(t *testing.T) {
	handler := newTestHandler(t)

	body := `{"provider_name":"test-pv","base_url":"https://api.test","param":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/providers", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var pv Provider
	json.Unmarshal(rr.Body.Bytes(), &pv)
	if pv.ProviderID == 0 {
		t.Fatalf("missing provider ID")
	}

	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/providers/"+itoa(pv.ProviderID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get status = %d", rr.Code)
	}

	// Update
	body = `{"provider_name":"updated-pv","base_url":"https://api.test","param":"{}"}`
	req = httptest.NewRequest(http.MethodPut, "/api/charitable/providers/"+itoa(pv.ProviderID), strings.NewReader(body))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("update status = %d", rr.Code)
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/charitable/providers/"+itoa(pv.ProviderID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete status = %d", rr.Code)
	}
}

func TestHandlerKeyCRUD(t *testing.T) {
	handler := newTestHandler(t)

	body := `{"api_key":"sk-test-key-1234567890","api_type":2,"status":1,"expires_at_ms":1798761600000,"probe_policy":"{\"failureThreshold\":4}","param":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var key APIKey
	json.Unmarshal(rr.Body.Bytes(), &key)
	if key.ID == 0 {
		t.Fatalf("missing key ID")
	}
	if key.ExpiresAtMS == nil || *key.ExpiresAtMS != 1798761600000 || key.ProbePolicy != `{"failureThreshold":4}` {
		t.Fatalf("strategy fields not persisted: %+v", key)
	}

	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/keys/"+itoa(key.ID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get status = %d", rr.Code)
	}

	// Get full_param
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/keys/"+itoa(key.ID)+"/full_param", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("full_param status = %d", rr.Code)
	}

	// Get/Update param
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/keys/"+itoa(key.ID)+"/param", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get param status = %d", rr.Code)
	}

	paramBody := `{"model":"gpt-4"}`
	req = httptest.NewRequest(http.MethodPut, "/api/charitable/keys/"+itoa(key.ID)+"/param", strings.NewReader(paramBody))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("update param status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/charitable/keys/"+itoa(key.ID), nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete status = %d", rr.Code)
	}
}

func TestHandlerKeyQueryAndUpsert(t *testing.T) {
	handler := newTestHandler(t)
	authValue := "sk-upsert-test-1234567890"
	authIndex := "auth-business-key-001"

	upsertBody, err := json.Marshal(map[string]any{
		"auth_index": authIndex,
		"auth_type":  1,
		"auth_value": authValue,
		"api_type":   2,
		"status":     1,
		"priority":   3,
		"param":      `{}`,
		"remark":     "created",
	})
	if err != nil {
		t.Fatalf("marshal upsert: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(string(upsertBody)))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("upsert create status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Operation string `json:"operation"`
		Item      APIKey `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode upsert create: %v", err)
	}
	if created.Operation != "created" || created.Item.ID == 0 || created.Item.AuthIndex != authIndex {
		t.Fatalf("unexpected create response: %+v", created)
	}

	queryBody, err := json.Marshal(keyIdentityRequest{AuthIndex: authIndex})
	if err != nil {
		t.Fatalf("marshal query: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/query", strings.NewReader(string(queryBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("query status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var queried APIKey
	if err := json.Unmarshal(rr.Body.Bytes(), &queried); err != nil {
		t.Fatalf("decode query: %v", err)
	}
	if queried.ID != created.Item.ID || queried.AuthValue != authValue {
		t.Fatalf("queried item = %+v", queried)
	}

	updatedBody, err := json.Marshal(map[string]any{
		"auth_index": authIndex,
		"auth_type":  1,
		"auth_value": "sk-upsert-test-changed-1234567890",
		"api_type":   2,
		"status":     -1,
		"priority":   9,
		"param":      `{"model":"gpt-4.1"}`,
		"remark":     "updated",
	})
	if err != nil {
		t.Fatalf("marshal update: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(string(updatedBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("upsert update status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var updated struct {
		Operation string `json:"operation"`
		Item      APIKey `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode upsert update: %v", err)
	}
	if updated.Operation != "updated" || updated.Item.ID != created.Item.ID || updated.Item.Priority != 9 || updated.Item.Remark != "updated" {
		t.Fatalf("unexpected update response: %+v", updated)
	}

	indexOnlyBody, err := json.Marshal(map[string]any{
		"auth_index": authIndex,
		"auth_type":  1,
		"auth_value": "",
		"api_type":   2,
		"param":      `{}`,
	})
	if err != nil {
		t.Fatalf("marshal index-only auth: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(string(indexOnlyBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("index-only auth update status = %d, body = %s", rr.Code, rr.Body.String())
	}

	derivedBody := `{"auth_type":1,"auth_value":"sk-derived-auth-1234567890","api_type":2,"param":"{}"}`
	for attempt, expectedStatus := range []int{http.StatusCreated, http.StatusOK} {
		req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(derivedBody))
		rr = httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != expectedStatus {
			t.Fatalf("derived auth upsert attempt %d status = %d, body = %s", attempt+1, rr.Code, rr.Body.String())
		}
	}
}

func TestHandlerKeyUpsertAcceptsUserscriptPayload(t *testing.T) {
	handler := newTestHandler(t)
	body := `{
		"auth_index":"f5655cbf5f1eb709edd02d574d9849cb",
		"auth_value":"tp-ctkn5k7zue63ky6shd5qorgrir1e2zqil4cz2f8asr7pmqq7",
		"auth_info":{
			"url":"https://linux.do/t/topic/2694328",
			"topic_id":"2694328",
			"username":"ppchang",
			"title":"mimo token",
			"base_url":"",
			"path":"",
			"schema_version":1,
			"credential_type":"api_key",
			"api_type":1,
			"provider_name":"Mimo",
			"provider_url":"https://token-plan-cn.xiaomimimo.com"
		},
		"owner_id":"448666",
		"status":1,
		"priority":0,
		"content":"shared token",
		"title":"mimo token",
		"remark":"https://linux.do/t/topic/2694328"
	}`

	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("userscript upsert status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var response struct {
		Item APIKey `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode userscript upsert response: %v", err)
	}
	if response.Item.OwnerID == nil || *response.Item.OwnerID != 448666 {
		t.Fatalf("owner_id = %v, want 448666", response.Item.OwnerID)
	}
	var authInfo map[string]any
	if err := json.Unmarshal([]byte(response.Item.AuthInfo), &authInfo); err != nil {
		t.Fatalf("auth_info is not stored as JSON text: %v", err)
	}
	if authInfo["provider_name"] != "Mimo" || authInfo["topic_id"] != "2694328" {
		t.Fatalf("unexpected auth_info: %v", authInfo)
	}
}

func TestHandlerProxyQueryAndUpsert(t *testing.T) {
	handler := newTestHandler(t)
	proxyValue := "socks5://user:password@example.com:1080"
	proxyIndex := "proxy-business-key-001"

	upsertBody, err := json.Marshal(map[string]any{
		"proxy_index": proxyIndex,
		"proxy_type":  ProxyTypeSOCKS,
		"proxy_value": proxyValue,
		"proxy_info":  "socks5",
		"status":      1,
		"priority":    3,
		"param":       `{}`,
		"remark":      "created",
	})
	if err != nil {
		t.Fatalf("marshal proxy upsert: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/proxies/upsert", strings.NewReader(string(upsertBody)))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("proxy upsert create status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Operation string      `json:"operation"`
		Item      ProxyDetail `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode proxy upsert create: %v", err)
	}
	if created.Operation != "created" || created.Item.ID == 0 || created.Item.ProxyIndex != proxyIndex {
		t.Fatalf("unexpected proxy create response: %+v", created)
	}

	queryBody, err := json.Marshal(proxyIdentityRequest{ProxyIndex: proxyIndex})
	if err != nil {
		t.Fatalf("marshal proxy query: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/proxies/query", strings.NewReader(string(queryBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("proxy query status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var queried ProxyDetail
	if err := json.Unmarshal(rr.Body.Bytes(), &queried); err != nil {
		t.Fatalf("decode proxy query: %v", err)
	}
	if queried.ID != created.Item.ID || queried.ProxyValue != proxyValue {
		t.Fatalf("queried proxy = %+v", queried)
	}

	updatedBody, err := json.Marshal(map[string]any{
		"proxy_index": proxyIndex,
		"proxy_type":  ProxyTypeSOCKS,
		"proxy_value": "socks5://new-user:new-password@example.com:1080",
		"proxy_info":  "updated socks5",
		"status":      -1,
		"priority":    9,
		"param":       `{"region":"us"}`,
		"remark":      "updated",
	})
	if err != nil {
		t.Fatalf("marshal proxy update: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/proxies/upsert", strings.NewReader(string(updatedBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("proxy upsert update status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var updated struct {
		Operation string      `json:"operation"`
		Item      ProxyDetail `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode proxy upsert update: %v", err)
	}
	if updated.Operation != "updated" || updated.Item.ID != created.Item.ID || updated.Item.Priority != 9 || updated.Item.Remark != "updated" {
		t.Fatalf("unexpected proxy update response: %+v", updated)
	}

	indexOnlyBody, err := json.Marshal(map[string]any{
		"proxy_index": proxyIndex,
		"proxy_type":  ProxyTypeSOCKS,
		"proxy_value": "",
		"param":       `{}`,
	})
	if err != nil {
		t.Fatalf("marshal index-only proxy: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/proxies/upsert", strings.NewReader(string(indexOnlyBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("index-only proxy update status = %d, body = %s", rr.Code, rr.Body.String())
	}

	derivedBody := `{"proxy_type":4,"proxy_value":"socks5://derived.example.com:1080","param":"{}"}`
	for attempt, expectedStatus := range []int{http.StatusCreated, http.StatusOK} {
		req = httptest.NewRequest(http.MethodPost, "/api/charitable/proxies/upsert", strings.NewReader(derivedBody))
		rr = httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != expectedStatus {
			t.Fatalf("derived proxy upsert attempt %d status = %d, body = %s", attempt+1, rr.Code, rr.Body.String())
		}
	}
}

func TestHandlerCreatesStructuredOAuthCredential(t *testing.T) {
	handler := newTestHandler(t)
	body := `{
		"auth_type":3,
		"auth_value":"{\"access_token\":\"access-secret\",\"refresh_token\":\"refresh-secret\"}",
		"auth_info":"{\"schema_version\":1,\"credential_type\":\"oauth2\",\"api_type\":2,\"protocols\":[\"openai\"],\"access_token\":\"must-be-removed\"}",
		"status":1,
		"param":"{}"
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create structured auth status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var credential APIKey
	if err := json.Unmarshal(rr.Body.Bytes(), &credential); err != nil {
		t.Fatalf("decode structured auth: %v", err)
	}
	if credential.AuthType != 3 || credential.APIType != 2 {
		t.Fatalf("unexpected structured credential: %+v", credential)
	}
	if credential.APIKey != "" {
		t.Fatalf("structured credential must not expose api_key alias")
	}
	if strings.Contains(credential.AuthInfo, "must-be-removed") {
		t.Fatalf("auth_info must not retain credential secrets: %s", credential.AuthInfo)
	}
}

func TestHandlerKeyBatchDelete(t *testing.T) {
	handler := newTestHandler(t)

	// Create 3 keys
	var ids []int64
	for i := range 3 {
		body := `{"api_key":"sk-batch-` + string(rune('0'+i)) + `-1234567890","api_type":2,"status":1,"param":"{}"}`
		req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys", strings.NewReader(body))
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create %d status = %d", i, rr.Code)
		}
		var key APIKey
		json.Unmarshal(rr.Body.Bytes(), &key)
		ids = append(ids, key.ID)
	}

	// Batch delete
	reqBody := `{"ids":[` + itoa(ids[0]) + `,` + itoa(ids[1]) + `,` + itoa(ids[2]) + `]}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/batch/delete", strings.NewReader(reqBody))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("batch delete status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Deleted int64 `json:"deleted"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Deleted != 3 {
		t.Fatalf("deleted = %d, want 3", resp.Deleted)
	}
}

func TestHandlerKeyBatchToggle(t *testing.T) {
	handler := newTestHandler(t)

	var ids []int64
	for i := range 2 {
		body := `{"api_key":"sk-toggle-` + string(rune('0'+i)) + `-1234567890","api_type":2,"status":1,"param":"{}"}`
		req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys", strings.NewReader(body))
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		var key APIKey
		json.Unmarshal(rr.Body.Bytes(), &key)
		ids = append(ids, key.ID)
	}

	reqBody := `{"ids":[` + itoa(ids[0]) + `,` + itoa(ids[1]) + `],"status":0}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/batch/disable", strings.NewReader(reqBody))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("batch toggle status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Updated int64 `json:"updated"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Updated != 2 {
		t.Fatalf("updated = %d, want 2", resp.Updated)
	}
}

func TestHandlerKeyStatusCounts(t *testing.T) {
	handler := newTestHandler(t)

	for _, body := range []string{
		`{"api_key":"sk-status-count-a-1234567890","api_type":2,"status":200,"param":"{}"}`,
		`{"api_key":"sk-status-count-b-1234567890","api_type":2,"status":0,"param":"{}"}`,
		`{"api_key":"sk-status-count-c-1234567890","api_type":2,"status":-401,"param":"{}"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys", strings.NewReader(body))
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create status = %d body=%s", rr.Code, rr.Body.String())
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/charitable/keys/statuses", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status counts = %d body=%s", rr.Code, rr.Body.String())
	}
	var items []KeyStatusCount
	if err := json.Unmarshal(rr.Body.Bytes(), &items); err != nil {
		t.Fatalf("decode status counts: %v", err)
	}
	if len(items) < 3 {
		t.Fatalf("status counts len=%d, want >= 3: %+v", len(items), items)
	}
}

func TestHandlerValidationErrors(t *testing.T) {
	handler := newTestHandler(t)

	// Empty channel name
	body := `{"channel_name":"","param":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/channels", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty name, got %d", rr.Code)
	}

	// Invalid base URL
	body = `{"provider_name":"pv","base_url":"not-a-url","param":"{}"}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/providers", strings.NewReader(body))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid URL, got %d", rr.Code)
	}

	// Short API key
	body = `{"api_key":"short","api_type":2,"param":"{}"}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys", strings.NewReader(body))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short key, got %d", rr.Code)
	}

	// Invalid JSON body
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/channels", strings.NewReader("not-json"))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d", rr.Code)
	}
}

func TestHandlerNotFound(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/charitable/channels/999", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/charitable/providers/999", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/charitable/keys/999", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestHandlerMethodNotAllowed(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodPatch, "/api/charitable/channels", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rr.Code)
	}
}

func TestHandlerInvalidID(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/charitable/channels/abc", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestHandlerBatchLimitExceeded(t *testing.T) {
	handler := newTestHandler(t)

	// Build a request with 501 IDs
	var ids []string
	for i := range 501 {
		ids = append(ids, itoa(int64(i+1)))
	}
	body := `{"ids":[` + strings.Join(ids, ",") + `]}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/batch/delete", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestHandlerUnknownBatchAction(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/batch/unknown", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestHandlerBatchEmptyIDs(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/charitable/keys/batch/delete", strings.NewReader(`{"ids":[]}`))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

// itoa is a simple helper to avoid strconv import in test file.
func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func TestHandlerKeyUpsertResolvesProviderFromAuthInfoBaseURL(t *testing.T) {
	handler := newTestHandler(t)

	// Create provider with a known base_url.
	providerBody := `{"provider_name":"match-pv","base_url":"https://edge.example.com/v1","param":"{}","status":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/providers", strings.NewReader(providerBody))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create provider status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var provider Provider
	if err := json.Unmarshal(rr.Body.Bytes(), &provider); err != nil {
		t.Fatalf("decode provider: %v", err)
	}
	if provider.ProviderID == 0 {
		t.Fatal("missing provider id")
	}

	// Upsert key without provider_id; auth_info.base_url should auto-bind.
	authInfo := `{"schema_version":1,"credential_type":"api_key","api_type":2,"base_url":"https://edge.example.com/v1/chat/completions"}`
	upsertBody, err := json.Marshal(map[string]any{
		"auth_index": "auth-auto-provider-001",
		"auth_type":  1,
		"auth_value": "sk-auto-provider-1234567890",
		"auth_info":  authInfo,
		"status":     1,
		"param":      `{}`,
	})
	if err != nil {
		t.Fatalf("marshal upsert: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(string(upsertBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("upsert status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Operation string `json:"operation"`
		Item      APIKey `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode upsert: %v", err)
	}
	if created.Item.ProviderID == nil || *created.Item.ProviderID != provider.ProviderID {
		t.Fatalf("provider_id = %v, want %d", created.Item.ProviderID, provider.ProviderID)
	}

	// Explicit provider_id must win over auth_info.base_url.
	otherBody := `{"provider_name":"other-pv","base_url":"https://other.example.com/v1","param":"{}","status":1}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/providers", strings.NewReader(otherBody))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create other provider status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var other Provider
	if err := json.Unmarshal(rr.Body.Bytes(), &other); err != nil {
		t.Fatalf("decode other provider: %v", err)
	}

	explicitBody, err := json.Marshal(map[string]any{
		"auth_index":  "auth-auto-provider-002",
		"auth_type":   1,
		"auth_value":  "sk-auto-provider-explicit-1234567890",
		"auth_info":   authInfo,
		"provider_id": other.ProviderID,
		"status":      1,
		"param":       `{}`,
	})
	if err != nil {
		t.Fatalf("marshal explicit upsert: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(string(explicitBody)))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("explicit upsert status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var explicit struct {
		Operation string `json:"operation"`
		Item      APIKey `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &explicit); err != nil {
		t.Fatalf("decode explicit upsert: %v", err)
	}
	if explicit.Item.ProviderID == nil || *explicit.Item.ProviderID != other.ProviderID {
		t.Fatalf("explicit provider_id = %v, want %d", explicit.Item.ProviderID, other.ProviderID)
	}

	// Missing base_url and provider_id remains unbound.
	unboundBody := `{"auth_index":"auth-auto-provider-003","auth_type":1,"auth_value":"sk-auto-provider-unbound-1234567890","api_type":2,"status":1,"param":"{}"}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/keys/upsert", strings.NewReader(unboundBody))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("unbound upsert status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var unbound struct {
		Item APIKey `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &unbound); err != nil {
		t.Fatalf("decode unbound upsert: %v", err)
	}
	if unbound.Item.ProviderID != nil {
		t.Fatalf("unbound provider_id = %v, want nil", unbound.Item.ProviderID)
	}
}

func TestHandlerProviderMultiProtocolType(t *testing.T) {
	handler := newTestHandler(t)
	body := `{"provider_name":"multi-proto","base_url":"https://multi.example.com/v1","protocol_type":"openai_compatible,anthropic","param":"{}","status":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/charitable/providers", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("create multi protocol provider status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var provider Provider
	if err := json.Unmarshal(rr.Body.Bytes(), &provider); err != nil {
		t.Fatalf("decode provider: %v", err)
	}
	if provider.ProtocolType != "openai_compatible,anthropic" {
		t.Fatalf("protocol_type = %q", provider.ProtocolType)
	}
	if provider.CPAConfigType == "" {
		t.Fatalf("expected default cpa_config_type")
	}

	// Invalid protocol token is rejected.
	bad := `{"provider_name":"bad-proto","base_url":"https://bad.example.com/v1","protocol_type":"openai_compatible,not_a_protocol","param":"{}"}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/providers", strings.NewReader(bad))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code == http.StatusOK {
		t.Fatalf("expected invalid protocol rejection, body = %s", rr.Body.String())
	}
}
