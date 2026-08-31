// Package cluster manages the CPAMC cluster node registry, config snapshot
// storage, and config push to follower nodes.
//
// CPAMC acts as the super-admin (master) node. It stores cluster metadata in
// SQLite, serializes config to YAML when pushing to CPA follower nodes, and
// delegates to CLIProxyAPIHome for CPAHome cluster topology and config
// distribution.
package cluster

import "time"

// Node type values.
const (
	NodeTypeCPA     = "cpa"      // CLIProxyAPI service (reads YAML config)
	NodeTypeCPAHome = "cpa-home" // CLIProxyAPIHome service (DB-driven, has leader election)
	NodeTypeCPAMC   = "cpamc"    // This project's service node
)

// Node role values.
const (
	NodeRoleMaster   = "master"   // Metadata node with read/write config authority
	NodeRoleFollower = "follower" // Passive node that receives pushed config
)

// Node status values.
const (
	NodeStatusActive  = "active"
	NodeStatusDraining = "draining"
	NodeStatusOffline  = "offline"
)

// ClusterNode represents a registered node in the CPAMC cluster.
type ClusterNode struct {
	ID          string            `json:"id"`
	Type        string            `json:"type"`         // cpa | cpa-home | cpamc
	Role       string            `json:"role"`         // master | follower
	Endpoint   string            `json:"endpoint"`     // base URL for management API
	Status     string            `json:"status"`       // active | draining | offline
	Name       string            `json:"name"`         // human-friendly label
	ManagementKey string         `json:"managementKey,omitempty"` // auth key for pushing config
	Metadata   map[string]any    `json:"metadata,omitempty"`     // version, platform, capabilities
	LastSeenAt *time.Time        `json:"lastSeenAt,omitempty"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}

// HomeConnection holds the delegated CLIProxyAPIHome master endpoint.
type HomeConnection struct {
	BaseURL       string `json:"baseUrl"`
	ManagementKey string `json:"managementKey,omitempty"`
	// Role indicates whether the connected Home is a master or follower.
	Role string `json:"role,omitempty"`
}

// ConfigSnapshot is the metadata-driven config stored in SQLite. When pushed to
// CPA follower nodes it is serialized to YAML format.
type ConfigSnapshot struct {
	ID        int64     `json:"-"`
	Key       string    `json:"key"`        // config root key (e.g. "plugins", "api-keys")
	Value     string    `json:"value"`     // JSON-encoded value
	Version   int64     `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}
