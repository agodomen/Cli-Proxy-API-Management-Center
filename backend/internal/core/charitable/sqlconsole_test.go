package charitable

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func newTestConsoleHandler(t *testing.T) (http.Handler, *store.Store) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	s, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	cs := NewCharitableStore(s.DB())
	console := NewSQLConsole(s.DB(), dbPath, nil)
	t.Cleanup(console.Close)
	h := NewHandlerWithConsole(cs, console)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return mux, s
}

func TestSQLConsoleSelect(t *testing.T) {
	console, _ := openTestConsole(t)
	res, err := console.Execute(context.Background(), QueryRequest{
		DatabaseID: "primary",
		SQL:        "SELECT 1 AS n, 'ok' AS label",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res.Kind != "query" || res.RowCount != 1 || len(res.Columns) != 2 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if res.Rows[0][0] != int64(1) && res.Rows[0][0] != float64(1) && res.Rows[0][0] != "1" {
		// modernc may return int64
		if v, ok := res.Rows[0][0].(int64); !ok || v != 1 {
			t.Fatalf("first cell = %#v", res.Rows[0][0])
		}
	}
}

func TestSQLConsoleWriteRequiresConfirm(t *testing.T) {
	console, _ := openTestConsole(t)
	_, err := console.Execute(context.Background(), QueryRequest{
		DatabaseID: "primary",
		SQL:        "DELETE FROM cpa_channel_info WHERE 0",
	})
	if err == nil || !strings.Contains(err.Error(), "write_confirmation_required") {
		t.Fatalf("expected write confirmation, got %v", err)
	}

	res, err := console.Execute(context.Background(), QueryRequest{
		DatabaseID:   "primary",
		SQL:          "DELETE FROM cpa_channel_info WHERE 0",
		ConfirmWrite: true,
	})
	if err != nil {
		t.Fatalf("confirmed write: %v", err)
	}
	if res.Kind != "exec" {
		t.Fatalf("kind = %s", res.Kind)
	}
}

func TestSQLConsoleRejectsMultipleStatements(t *testing.T) {
	console, _ := openTestConsole(t)
	_, err := console.Execute(context.Background(), QueryRequest{
		DatabaseID: "primary",
		SQL:        "SELECT 1; SELECT 2",
	})
	if err == nil || !strings.Contains(err.Error(), "multiple_statements") {
		t.Fatalf("expected multi-statement rejection, got %v", err)
	}
}

func TestSQLConsoleUnknownDatabase(t *testing.T) {
	console, _ := openTestConsole(t)
	_, err := console.Execute(context.Background(), QueryRequest{
		DatabaseID: "missing",
		SQL:        "SELECT 1",
	})
	if err == nil || !strings.Contains(err.Error(), "database_not_found") {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestSQLConsoleSchemaIncludesCoreTables(t *testing.T) {
	console, _ := openTestConsole(t)
	schema, err := console.GetSchema(context.Background(), "primary")
	if err != nil {
		t.Fatalf("schema: %v", err)
	}
	names := map[string]bool{}
	for _, table := range schema.Tables {
		names[table.Name] = true
	}
	for _, want := range []string{"usage_events", "cpa_channel_info", "cpa_provider_info", "cpa_auth_detail", "cpa_proxy_detail"} {
		if !names[want] {
			t.Fatalf("missing table %s in %#v", want, names)
		}
	}
	if names["cpa_api_key_detail"] {
		t.Fatalf("deprecated cpa_api_key_detail table should not exist in %#v", names)
	}
}

func TestSQLConsoleExtraDatabase(t *testing.T) {
	primaryPath := filepath.Join(t.TempDir(), "primary.sqlite")
	extraPath := filepath.Join(t.TempDir(), "extra.sqlite")
	primary, err := store.Open(primaryPath)
	if err != nil {
		t.Fatalf("open primary: %v", err)
	}
	t.Cleanup(func() { _ = primary.Close() })
	extra, err := store.Open(extraPath)
	if err != nil {
		t.Fatalf("open extra: %v", err)
	}
	_ = extra.Close()

	console := NewSQLConsole(primary.DB(), primaryPath, []config.DebugDatabase{
		{ID: "extra", Label: "Extra DB", Path: extraPath},
	})
	t.Cleanup(console.Close)

	items := console.ListDatabases(context.Background())
	if len(items) != 2 {
		t.Fatalf("databases = %d", len(items))
	}
	res, err := console.Execute(context.Background(), QueryRequest{
		DatabaseID: "extra",
		SQL:        "SELECT name FROM sqlite_master WHERE type='table' LIMIT 5",
	})
	if err != nil {
		t.Fatalf("query extra: %v", err)
	}
	if res.Kind != "query" {
		t.Fatalf("kind = %s", res.Kind)
	}
}

func TestDebugQueryHTTPEndpoints(t *testing.T) {
	handler, _ := newTestConsoleHandler(t)

	// list databases
	req := httptest.NewRequest(http.MethodGet, "/api/charitable/debug/databases", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d body=%s", rr.Code, rr.Body.String())
	}

	// schema
	req = httptest.NewRequest(http.MethodGet, "/api/charitable/debug/databases/primary/schema", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("schema status = %d body=%s", rr.Code, rr.Body.String())
	}

	// write without confirm
	body := `{"databaseId":"primary","sql":"DELETE FROM cpa_channel_info WHERE 0","confirmWrite":false}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/debug/query", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rr.Code, rr.Body.String())
	}
	var errBody map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &errBody)
	if errBody["code"] != "write_confirmation_required" {
		t.Fatalf("code = %#v", errBody["code"])
	}

	// select ok
	body = `{"databaseId":"primary","sql":"SELECT 1 AS n","confirmWrite":false}`
	req = httptest.NewRequest(http.MethodPost, "/api/charitable/debug/query", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("select status = %d body=%s", rr.Code, rr.Body.String())
	}
}

func openTestConsole(t *testing.T) (*SQLConsole, *store.Store) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	s, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	console := NewSQLConsole(s.DB(), dbPath, nil)
	t.Cleanup(console.Close)
	return console, s
}

func TestClassifySQL(t *testing.T) {
	cases := []struct {
		sql   string
		kind  string
		write bool
		err   bool
	}{
		{"SELECT 1", "query", false, false},
		{"with x as (select 1) select * from x", "query", false, false},
		{"INSERT INTO t VALUES (1)", "exec", true, false},
		{"ATTACH DATABASE 'x' AS y", "", false, true},
		{"SELECT 1; SELECT 2", "query", false, false}, // classification ignores multi; multi checked separately
	}
	for _, tc := range cases {
		kind, write, err := classifySQL(tc.sql)
		if tc.err {
			if err == nil {
				t.Fatalf("%q expected error", tc.sql)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%q err %v", tc.sql, err)
		}
		if kind != tc.kind || write != tc.write {
			t.Fatalf("%q => %s/%v want %s/%v", tc.sql, kind, write, tc.kind, tc.write)
		}
	}
}
