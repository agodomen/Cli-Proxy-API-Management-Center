package cluster

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const clusterNodesTableDDL = `CREATE TABLE IF NOT EXISTS cluster_nodes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id TEXT NOT NULL UNIQUE,
	type TEXT NOT NULL DEFAULT 'cpa',
	role TEXT NOT NULL DEFAULT 'follower',
	endpoint TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'active',
	name TEXT NOT NULL DEFAULT '',
	management_key TEXT NOT NULL DEFAULT '',
	metadata TEXT NOT NULL DEFAULT '{}',
	last_seen_at_ms INTEGER,
	created_at_ms INTEGER NOT NULL,
	updated_at_ms INTEGER NOT NULL
)`

const clusterConfigTableDDL = `CREATE TABLE IF NOT EXISTS cluster_config (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	key TEXT NOT NULL UNIQUE,
	value TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	updated_at_ms INTEGER NOT NULL
)`

const clusterHomeConnKey = "home_connection_v1"

// EnsureTables creates the cluster tables if they do not exist. It is safe to
// call multiple times.
func EnsureTables(db *sql.DB) error {
	if db == nil {
		return errors.New("database is nil")
	}
	for _, stmt := range []string{
		clusterNodesTableDDL,
		clusterConfigTableDDL,
		`CREATE INDEX IF NOT EXISTS idx_cluster_nodes_type ON cluster_nodes(type)`,
		`CREATE INDEX IF NOT EXISTS idx_cluster_nodes_role ON cluster_nodes(role)`,
		`CREATE INDEX IF NOT EXISTS idx_cluster_nodes_status ON cluster_nodes(status)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("cluster table init: %w", err)
		}
	}
	return nil
}

// Store provides cluster node and config persistence backed by SQLite.
type Store struct {
	db *sql.DB
}

// NewStore creates a cluster store. The database must already have the cluster
// tables (call EnsureTables first).
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// ListNodes returns all registered cluster nodes ordered by type then name.
func (s *Store) ListNodes(ctx context.Context) ([]ClusterNode, error) {
	if s.db == nil {
		return nil, errors.New("database is nil")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT node_id, type, role, endpoint, status, name, management_key, metadata,
			last_seen_at_ms, created_at_ms, updated_at_ms
		 FROM cluster_nodes ORDER BY type, name`)
	if err != nil {
		return nil, fmt.Errorf("list cluster nodes: %w", err)
	}
	defer rows.Close()
	var nodes []ClusterNode
	for rows.Next() {
		node, errScan := scanNode(rows)
		if errScan != nil {
			return nil, errScan
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

// GetNode returns a single cluster node by ID.
func (s *Store) GetNode(ctx context.Context, id string) (ClusterNode, error) {
	if s.db == nil {
		return ClusterNode{}, errors.New("database is nil")
	}
	row := s.db.QueryRowContext(ctx,
		`SELECT node_id, type, role, endpoint, status, name, management_key, metadata,
			last_seen_at_ms, created_at_ms, updated_at_ms
		 FROM cluster_nodes WHERE node_id = ?`, id)
	return scanNodeRow(row)
}

// UpsertNode creates or updates a cluster node.
func (s *Store) UpsertNode(ctx context.Context, node ClusterNode) error {
	if s.db == nil {
		return errors.New("database is nil")
	}
	if node.ID == "" {
		return errors.New("node id is required")
	}
	if node.Type == "" {
		node.Type = NodeTypeCPA
	}
	if node.Role == "" {
		node.Role = NodeRoleFollower
	}
	if node.Status == "" {
		node.Status = NodeStatusActive
	}
	metaJSON := "{}"
	if node.Metadata != nil {
		if raw, err := json.Marshal(node.Metadata); err == nil {
			metaJSON = string(raw)
		}
	}
	now := time.Now().UnixMilli()
	var lastSeenMS sql.NullInt64
	if node.LastSeenAt != nil {
		lastSeenMS = sql.NullInt64{Int64: node.LastSeenAt.UnixMilli(), Valid: true}
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO cluster_nodes
			(node_id, type, role, endpoint, status, name, management_key, metadata,
			 last_seen_at_ms, created_at_ms, updated_at_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(node_id) DO UPDATE SET
			type = excluded.type,
			role = excluded.role,
			endpoint = excluded.endpoint,
			status = excluded.status,
			name = excluded.name,
			management_key = excluded.management_key,
			metadata = excluded.metadata,
			last_seen_at_ms = excluded.last_seen_at_ms,
			updated_at_ms = excluded.updated_at_ms`,
		node.ID, node.Type, node.Role, node.Endpoint, node.Status, node.Name,
		node.ManagementKey, metaJSON, lastSeenMS, now, now)
	return err
}

// DeleteNode removes a cluster node by ID.
func (s *Store) DeleteNode(ctx context.Context, id string) error {
	if s.db == nil {
		return errors.New("database is nil")
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM cluster_nodes WHERE node_id = ?`, id)
	return err
}

// TouchNode updates the last_seen_at for a node.
func (s *Store) TouchNode(ctx context.Context, id string) error {
	if s.db == nil {
		return errors.New("database is nil")
	}
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx,
		`UPDATE cluster_nodes SET last_seen_at_ms = ?, updated_at_ms = ? WHERE node_id = ?`,
		now, now, id)
	return err
}

// HeartbeatNode records a node heartbeat, returning the updated node and whether
// the node existed. A non-empty status or payload (e.g. version, platform,
// capabilities) refreshes the node's metadata/status; empty fields only refresh
// last_seen_at.
func (s *Store) HeartbeatNode(ctx context.Context, id string, status string, payload map[string]any) (ClusterNode, bool, error) {
	if s.db == nil {
		return ClusterNode{}, false, errors.New("database is nil")
	}
	if id == "" {
		return ClusterNode{}, false, errors.New("node id is required")
	}
	now := time.Now().UnixMilli()

	var sets []string
	var args []any
	if status != "" {
		sets = append(sets, "status = ?")
		args = append(args, status)
	}
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return ClusterNode{}, false, fmt.Errorf("encode heartbeat metadata: %w", err)
		}
		sets = append(sets, "metadata = ?")
		args = append(args, string(raw))
	}
	sets = append(sets, "last_seen_at_ms = ?", "updated_at_ms = ?")
	args = append(args, now, now, id) // WHERE node_id = ? is the last placeholder

	stmt := "UPDATE cluster_nodes SET " + strings.Join(sets, ", ") + " WHERE node_id = ?"
	res, err := s.db.ExecContext(ctx, stmt, args...)
	if err != nil {
		return ClusterNode{}, false, fmt.Errorf("heartbeat node: %w", err)
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ClusterNode{}, false, nil
	}
	node, err := s.GetNode(ctx, id)
	if err != nil {
		return ClusterNode{}, true, err
	}
	return node, true, nil
}

// LoadConfigSnapshot returns all config key-value pairs.
func (s *Store) LoadConfigSnapshot(ctx context.Context) ([]ConfigSnapshot, error) {
	if s.db == nil {
		return nil, errors.New("database is nil")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, key, value, version, updated_at_ms FROM cluster_config ORDER BY key`)
	if err != nil {
		return nil, fmt.Errorf("load config snapshot: %w", err)
	}
	defer rows.Close()
	var items []ConfigSnapshot
	for rows.Next() {
		var item ConfigSnapshot
		var updatedMS int64
		if err := rows.Scan(&item.ID, &item.Key, &item.Value, &item.Version, &updatedMS); err != nil {
			return nil, err
		}
		item.UpdatedAt = time.UnixMilli(updatedMS)
		items = append(items, item)
	}
	return items, rows.Err()
}

// UpsertConfigValue inserts or updates a config key-value pair.
func (s *Store) UpsertConfigValue(ctx context.Context, key, value string) error {
	if s.db == nil {
		return errors.New("database is nil")
	}
	if key == "" {
		return errors.New("config key is required")
	}
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO cluster_config (key, value, version, updated_at_ms)
		 VALUES (?, ?, 1, ?)
		 ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			version = cluster_config.version + 1,
			updated_at_ms = excluded.updated_at_ms`,
		key, value, now)
	return err
}

// DeleteConfigValue removes a config key.
func (s *Store) DeleteConfigValue(ctx context.Context, key string) error {
	if s.db == nil {
		return errors.New("database is nil")
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM cluster_config WHERE key = ?`, key)
	return err
}

// LoadHomeConnection returns the delegated Home master endpoint.
func (s *Store) LoadHomeConnection(ctx context.Context) (HomeConnection, error) {
	if s.db == nil {
		return HomeConnection{}, errors.New("database is nil")
	}
	var raw string
	err := s.db.QueryRowContext(ctx,
		`SELECT value FROM cluster_config WHERE key = ?`, clusterHomeConnKey).Scan(&raw)
	if err == sql.ErrNoRows {
		return HomeConnection{}, nil
	}
	if err != nil {
		return HomeConnection{}, err
	}
	var conn HomeConnection
	if err := json.Unmarshal([]byte(raw), &conn); err != nil {
		return HomeConnection{}, fmt.Errorf("decode home connection: %w", err)
	}
	return conn, nil
}

// SaveHomeConnection persists the delegated Home master endpoint.
func (s *Store) SaveHomeConnection(ctx context.Context, conn HomeConnection) error {
	raw, err := json.Marshal(conn)
	if err != nil {
		return err
	}
	return s.UpsertConfigValue(ctx, clusterHomeConnKey, string(raw))
}

func scanNode(rows *sql.Rows) (ClusterNode, error) {
	var node ClusterNode
	var metaJSON string
	var lastSeenMS sql.NullInt64
	var createdMS, updatedMS int64
	if err := rows.Scan(
		&node.ID, &node.Type, &node.Role, &node.Endpoint, &node.Status, &node.Name,
		&node.ManagementKey, &metaJSON, &lastSeenMS, &createdMS, &updatedMS,
	); err != nil {
		return ClusterNode{}, err
	}
	if metaJSON != "" {
		_ = json.Unmarshal([]byte(metaJSON), &node.Metadata)
	}
	if lastSeenMS.Valid {
		t := time.UnixMilli(lastSeenMS.Int64)
		node.LastSeenAt = &t
	}
	node.CreatedAt = time.UnixMilli(createdMS)
	node.UpdatedAt = time.UnixMilli(updatedMS)
	return node, nil
}

func scanNodeRow(row *sql.Row) (ClusterNode, error) {
	var node ClusterNode
	var metaJSON string
	var lastSeenMS sql.NullInt64
	var createdMS, updatedMS int64
	if err := row.Scan(
		&node.ID, &node.Type, &node.Role, &node.Endpoint, &node.Status, &node.Name,
		&node.ManagementKey, &metaJSON, &lastSeenMS, &createdMS, &updatedMS,
	); err != nil {
		return ClusterNode{}, err
	}
	if metaJSON != "" {
		_ = json.Unmarshal([]byte(metaJSON), &node.Metadata)
	}
	if lastSeenMS.Valid {
		t := time.UnixMilli(lastSeenMS.Int64)
		node.LastSeenAt = &t
	}
	node.CreatedAt = time.UnixMilli(createdMS)
	node.UpdatedAt = time.UnixMilli(updatedMS)
	return node, nil
}
