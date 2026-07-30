package charitable

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	_ "modernc.org/sqlite"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/config"
)

const (
	primaryDatabaseID     = "primary"
	defaultQueryMaxRows   = 500
	maxQueryMaxRows       = 2000
	queryTimeout          = 15 * time.Second
	maxCellStringBytes    = 4 * 1024
	defaultPreviewMaxRows = 50

	// Hide SQLite internals and FTS5 shadow/virtual tables from schema browser.
	schemaTablesWhere = `
		type IN ('table','view')
		AND name NOT LIKE 'sqlite_%'
		AND name NOT LIKE '%_fts'
		AND name NOT LIKE '%_fts_%'
	`
	schemaTablesCountSQL = `SELECT COUNT(*) FROM sqlite_master WHERE ` + schemaTablesWhere
	schemaTablesListSQL  = `
		SELECT name, type
		FROM sqlite_master
		WHERE ` + schemaTablesWhere + `
		ORDER BY type ASC, name ASC
	`
)

var (
	errDatabaseNotFound          = errors.New("database_not_found")
	errWriteConfirmationRequired = errors.New("write_confirmation_required")
	errMultipleStatements        = errors.New("multiple_statements_not_allowed")
	errEmptySQL                  = errors.New("empty_sql")
	errAttachNotAllowed          = errors.New("attach_not_allowed")
	errUnsupportedStatement      = errors.New("unsupported_statement")
	lineCommentRe                = regexp.MustCompile(`(?m)--.*?$`)
	blockCommentRe               = regexp.MustCompile(`(?s)/\*.*?\*/`)
	identifierUnsafeRe           = regexp.MustCompile(`[^a-zA-Z0-9_]`)
)

// SQLConsole manages whitelisted SQLite connections for the debug console.
type SQLConsole struct {
	mu          sync.Mutex
	primary     *sql.DB
	primaryPath string
	extras      []config.DebugDatabase
	extraDBs    map[string]*sql.DB
}

type DatabaseInfo struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Path       string `json:"path"`
	Basename   string `json:"basename"`
	Primary    bool   `json:"primary"`
	Available  bool   `json:"available"`
	Writable   bool   `json:"writable"`
	TableCount int    `json:"tableCount"`
	Error      string `json:"error,omitempty"`
}

type SchemaColumn struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	NotNull    bool   `json:"notNull"`
	PrimaryKey bool   `json:"primaryKey"`
	Default    any    `json:"default,omitempty"`
}

type SchemaTable struct {
	Name    string         `json:"name"`
	Type    string         `json:"type"` // table | view
	Columns []SchemaColumn `json:"columns"`
}

type SchemaResponse struct {
	DatabaseID string        `json:"databaseId"`
	Tables     []SchemaTable `json:"tables"`
}

type QueryRequest struct {
	DatabaseID   string `json:"databaseId"`
	SQL          string `json:"sql"`
	ConfirmWrite bool   `json:"confirmWrite"`
	MaxRows      int    `json:"maxRows"`
}

type QueryResponse struct {
	DatabaseID   string   `json:"databaseId"`
	SQL          string   `json:"sql"`
	Kind         string   `json:"kind"` // query | exec
	Columns      []string `json:"columns,omitempty"`
	Rows         [][]any  `json:"rows,omitempty"`
	RowCount     int      `json:"rowCount"`
	Truncated    bool     `json:"truncated"`
	RowsAffected int64    `json:"rowsAffected,omitempty"`
	DurationMs   int64    `json:"durationMs"`
	Warnings     []string `json:"warnings,omitempty"`
}

type PreviewResponse struct {
	DatabaseID string   `json:"databaseId"`
	Table      string   `json:"table"`
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"rowCount"`
	Truncated  bool     `json:"truncated"`
	DurationMs int64    `json:"durationMs"`
}

func NewSQLConsole(primary *sql.DB, primaryPath string, extras []config.DebugDatabase) *SQLConsole {
	return &SQLConsole{
		primary:     primary,
		primaryPath: primaryPath,
		extras:      append([]config.DebugDatabase(nil), extras...),
		extraDBs:    map[string]*sql.DB{},
	}
}

func (c *SQLConsole) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, db := range c.extraDBs {
		_ = db.Close()
		delete(c.extraDBs, id)
	}
}

func (c *SQLConsole) ListDatabases(ctx context.Context) []DatabaseInfo {
	items := make([]DatabaseInfo, 0, 1+len(c.extras))
	items = append(items, c.describeDatabase(ctx, primaryDatabaseID, filepath.Base(c.primaryPath), c.primaryPath, true))
	for _, extra := range c.extras {
		label := extra.Label
		if label == "" {
			label = extra.ID
		}
		items = append(items, c.describeDatabase(ctx, extra.ID, label, extra.Path, false))
	}
	return items
}

func (c *SQLConsole) describeDatabase(ctx context.Context, id, label, path string, primary bool) DatabaseInfo {
	info := DatabaseInfo{
		ID:       id,
		Label:    label,
		Path:     path,
		Basename: filepath.Base(path),
		Primary:  primary,
		Writable: true,
	}
	db, err := c.open(id)
	if err != nil {
		info.Available = false
		info.Error = err.Error()
		return info
	}
	info.Available = true
	var count int
	if err := db.QueryRowContext(ctx, schemaTablesCountSQL).Scan(&count); err == nil {
		info.TableCount = count
	}
	return info
}

func (c *SQLConsole) GetSchema(ctx context.Context, databaseID string) (SchemaResponse, error) {
	db, err := c.open(databaseID)
	if err != nil {
		return SchemaResponse{}, err
	}

	// Collect table names first. With MaxOpenConns(1) on the primary store DB,
	// nested queries while rows are open will deadlock waiting for a free conn.
	type tableMeta struct {
		name string
		typ  string
	}
	metas := make([]tableMeta, 0)
	rows, err := db.QueryContext(ctx, schemaTablesListSQL)
	if err != nil {
		return SchemaResponse{}, err
	}
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			_ = rows.Close()
			return SchemaResponse{}, err
		}
		metas = append(metas, tableMeta{name: name, typ: typ})
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return SchemaResponse{}, err
	}
	if err := rows.Close(); err != nil {
		return SchemaResponse{}, err
	}

	tables := make([]SchemaTable, 0, len(metas))
	for _, meta := range metas {
		cols, err := c.tableColumns(ctx, db, meta.name)
		if err != nil {
			return SchemaResponse{}, err
		}
		tables = append(tables, SchemaTable{Name: meta.name, Type: meta.typ, Columns: cols})
	}
	return SchemaResponse{DatabaseID: databaseID, Tables: tables}, nil
}

func (c *SQLConsole) tableColumns(ctx context.Context, db *sql.DB, table string) ([]SchemaColumn, error) {
	// PRAGMA table_info does not accept bound parameters for table names.
	quoted := quoteIdent(table)
	rows, err := db.QueryContext(ctx, "PRAGMA table_info("+quoted+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make([]SchemaColumn, 0)
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, SchemaColumn{
			Name:       name,
			Type:       colType,
			NotNull:    notNull != 0,
			PrimaryKey: pk != 0,
			Default:    dflt,
		})
	}
	return cols, rows.Err()
}

func (c *SQLConsole) PreviewTable(ctx context.Context, databaseID, table string, maxRows int) (PreviewResponse, error) {
	if !isSafeIdent(table) {
		return PreviewResponse{}, errors.New("invalid_table_name")
	}
	if maxRows <= 0 {
		maxRows = defaultPreviewMaxRows
	}
	if maxRows > maxQueryMaxRows {
		maxRows = maxQueryMaxRows
	}
	sqlText := fmt.Sprintf("SELECT * FROM %s LIMIT %d", quoteIdent(table), maxRows+1)
	result, err := c.Execute(ctx, QueryRequest{
		DatabaseID: databaseID,
		SQL:        sqlText,
		MaxRows:    maxRows,
	})
	if err != nil {
		return PreviewResponse{}, err
	}
	return PreviewResponse{
		DatabaseID: databaseID,
		Table:      table,
		Columns:    result.Columns,
		Rows:       result.Rows,
		RowCount:   result.RowCount,
		Truncated:  result.Truncated,
		DurationMs: result.DurationMs,
	}, nil
}

func (c *SQLConsole) Execute(ctx context.Context, req QueryRequest) (QueryResponse, error) {
	sqlText := strings.TrimSpace(req.SQL)
	if sqlText == "" {
		return QueryResponse{}, errEmptySQL
	}
	if hasMultipleStatements(sqlText) {
		return QueryResponse{}, errMultipleStatements
	}

	kind, write, err := classifySQL(sqlText)
	if err != nil {
		return QueryResponse{}, err
	}
	if write && !req.ConfirmWrite {
		return QueryResponse{}, errWriteConfirmationRequired
	}

	db, err := c.open(req.DatabaseID)
	if err != nil {
		return QueryResponse{}, err
	}

	maxRows := req.MaxRows
	if maxRows <= 0 {
		maxRows = defaultQueryMaxRows
	}
	if maxRows > maxQueryMaxRows {
		maxRows = maxQueryMaxRows
	}

	queryCtx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	started := time.Now()
	resp := QueryResponse{
		DatabaseID: req.DatabaseID,
		SQL:        sqlText,
		Kind:       kind,
	}
	if write {
		resp.Warnings = append(resp.Warnings, "write_confirmed")
	}

	if kind == "query" {
		rows, err := db.QueryContext(queryCtx, sqlText)
		if err != nil {
			return QueryResponse{}, err
		}
		defer rows.Close()

		columns, err := rows.Columns()
		if err != nil {
			return QueryResponse{}, err
		}
		resp.Columns = columns

		values := make([]any, len(columns))
		scanArgs := make([]any, len(columns))
		for i := range values {
			scanArgs[i] = &values[i]
		}

		outRows := make([][]any, 0, 32)
		truncatedCells := false
		for rows.Next() {
			if len(outRows) >= maxRows {
				resp.Truncated = true
				break
			}
			if err := rows.Scan(scanArgs...); err != nil {
				return QueryResponse{}, err
			}
			row := make([]any, len(columns))
			for i, v := range values {
				cell, cellTruncated := normalizeCell(v)
				if cellTruncated {
					truncatedCells = true
				}
				row[i] = cell
			}
			outRows = append(outRows, row)
		}
		if err := rows.Err(); err != nil {
			return QueryResponse{}, err
		}
		if truncatedCells {
			resp.Truncated = true
			resp.Warnings = append(resp.Warnings, "cell_truncated")
		}
		resp.Rows = outRows
		resp.RowCount = len(outRows)
	} else {
		result, err := db.ExecContext(queryCtx, sqlText)
		if err != nil {
			return QueryResponse{}, err
		}
		if affected, err := result.RowsAffected(); err == nil {
			resp.RowsAffected = affected
		}
		resp.RowCount = 0
	}

	resp.DurationMs = time.Since(started).Milliseconds()
	return resp, nil
}

func (c *SQLConsole) open(databaseID string) (*sql.DB, error) {
	if databaseID == "" || databaseID == primaryDatabaseID {
		if c.primary == nil {
			return nil, errDatabaseNotFound
		}
		return c.primary, nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if db, ok := c.extraDBs[databaseID]; ok {
		return db, nil
	}

	var meta *config.DebugDatabase
	for i := range c.extras {
		if c.extras[i].ID == databaseID {
			meta = &c.extras[i]
			break
		}
	}
	if meta == nil {
		return nil, errDatabaseNotFound
	}
	if strings.TrimSpace(meta.Path) == "" {
		return nil, fmt.Errorf("database path empty")
	}
	if _, err := os.Stat(meta.Path); err != nil {
		return nil, fmt.Errorf("database unavailable: %w", err)
	}
	db, err := sql.Open("sqlite", meta.Path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(0)
	if _, err := db.Exec(`PRAGMA busy_timeout = 5000`); err != nil {
		_ = db.Close()
		return nil, err
	}
	c.extraDBs[databaseID] = db
	return db, nil
}

func classifySQL(sqlText string) (kind string, write bool, err error) {
	stripped := stripSQLComments(sqlText)
	stripped = strings.TrimSpace(stripped)
	if stripped == "" {
		return "", false, errEmptySQL
	}
	token := firstSQLToken(stripped)
	if token == "" {
		return "", false, errEmptySQL
	}
	switch token {
	case "SELECT", "WITH", "VALUES", "EXPLAIN":
		return "query", false, nil
	case "PRAGMA":
		// Treat PRAGMA as query (returns rows for table_info etc.). Writing pragmas still need care;
		// disallow attach-like and mark known mutating pragmas as write.
		upper := strings.ToUpper(stripped)
		if strings.Contains(upper, "PRAGMA") && (strings.Contains(upper, "WRITABLE_SCHEMA") ||
			strings.Contains(upper, "JOURNAL_MODE") ||
			strings.Contains(upper, "USER_VERSION") ||
			strings.Contains(upper, "APPLICATION_ID") ||
			strings.Contains(upper, "SCHEMA_VERSION") ||
			strings.Contains(upper, "WAL_CHECKPOINT") ||
			strings.Contains(upper, "OPTIMIZE")) {
			return "exec", true, nil
		}
		return "query", false, nil
	case "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "ALTER", "DROP",
		"VACUUM", "REINDEX", "ANALYZE", "TRUNCATE":
		return "exec", true, nil
	case "ATTACH", "DETACH":
		return "", false, errAttachNotAllowed
	default:
		return "", false, errUnsupportedStatement
	}
}

func stripSQLComments(sqlText string) string {
	withoutBlock := blockCommentRe.ReplaceAllString(sqlText, " ")
	return lineCommentRe.ReplaceAllString(withoutBlock, " ")
}

func firstSQLToken(sqlText string) string {
	i := 0
	for i < len(sqlText) && unicode.IsSpace(rune(sqlText[i])) {
		i++
	}
	if i >= len(sqlText) {
		return ""
	}
	j := i
	for j < len(sqlText) {
		r := rune(sqlText[j])
		if unicode.IsLetter(r) || r == '_' {
			j++
			continue
		}
		break
	}
	return strings.ToUpper(sqlText[i:j])
}

func hasMultipleStatements(sqlText string) bool {
	stripped := strings.TrimSpace(stripSQLComments(sqlText))
	if stripped == "" {
		return false
	}
	// Remove trailing semicolons then check for another statement.
	stripped = strings.TrimRight(stripped, " \t\r\n;")
	inSingle := false
	inDouble := false
	for i := 0; i < len(stripped); i++ {
		ch := stripped[i]
		switch ch {
		case '\'':
			if !inDouble {
				// handle escaped ''
				if inSingle && i+1 < len(stripped) && stripped[i+1] == '\'' {
					i++
					continue
				}
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				if inDouble && i+1 < len(stripped) && stripped[i+1] == '"' {
					i++
					continue
				}
				inDouble = !inDouble
			}
		case ';':
			if !inSingle && !inDouble {
				// anything non-space after this means multiple statements
				rest := strings.TrimSpace(stripped[i+1:])
				return rest != ""
			}
		}
	}
	return false
}

func normalizeCell(v any) (any, bool) {
	if v == nil {
		return nil, false
	}
	switch value := v.(type) {
	case []byte:
		s := string(value)
		if len(s) > maxCellStringBytes {
			return s[:maxCellStringBytes] + "…", true
		}
		return s, false
	case string:
		if len(value) > maxCellStringBytes {
			return value[:maxCellStringBytes] + "…", true
		}
		return value, false
	case int64, float64, bool:
		return value, false
	case time.Time:
		return value.UTC().Format(time.RFC3339Nano), false
	default:
		s := fmt.Sprint(value)
		if len(s) > maxCellStringBytes {
			return s[:maxCellStringBytes] + "…", true
		}
		return s, false
	}
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func isSafeIdent(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 128 {
		return false
	}
	return !identifierUnsafeRe.MatchString(name)
}

func mapSQLConsoleError(err error) (status int, code string) {
	switch {
	case errors.Is(err, errDatabaseNotFound):
		return 404, "database_not_found"
	case errors.Is(err, errWriteConfirmationRequired):
		return 400, "write_confirmation_required"
	case errors.Is(err, errMultipleStatements):
		return 400, "multiple_statements_not_allowed"
	case errors.Is(err, errEmptySQL):
		return 400, "empty_sql"
	case errors.Is(err, errAttachNotAllowed):
		return 400, "attach_not_allowed"
	case errors.Is(err, errUnsupportedStatement):
		return 400, "unsupported_statement"
	case errors.Is(err, context.DeadlineExceeded):
		return 504, "query_timeout"
	default:
		msg := err.Error()
		if strings.Contains(msg, "invalid_table_name") {
			return 400, "invalid_table_name"
		}
		if strings.Contains(msg, "database unavailable") {
			return 503, "database_unavailable"
		}
		return 400, "query_failed"
	}
}
