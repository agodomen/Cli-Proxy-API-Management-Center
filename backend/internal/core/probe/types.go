package probe

import "time"

const settingKey = "probe_service_config_v1"

// Config controls the asynchronous probe service that turns collected usage
// events into health signals and optional account HA actions.
type Config struct {
	Enabled               bool `json:"enabled"`
	AutoPriorityEnabled   bool `json:"autoPriorityEnabled"`
	AutoStatusEnabled     bool `json:"autoStatusEnabled"`
	AutoCPAAccountEnabled bool `json:"autoCpaAccountEnabled"`
	RenewExpiryOnSuccess  bool `json:"renewExpiryOnSuccess"`
	RenewalSeconds        int  `json:"renewalSeconds"`
	// WindowSeconds is the rolling evaluation window used by stats/policy.
	WindowSeconds int `json:"windowSeconds"`
	// Success boost / failure penalty applied to priority when auto-priority is on.
	PriorityBoost   int `json:"priorityBoost"`
	PriorityPenalty int `json:"priorityPenalty"`
	// FailureThreshold consecutive failures before auto-status marks a key invalid.
	FailureThreshold int `json:"failureThreshold"`
	// RecoveryThreshold consecutive successes before auto-status restores a key.
	RecoveryThreshold int `json:"recoveryThreshold"`
	// MinPriority / MaxPriority clamp for auto priority adjustments.
	MinPriority int `json:"minPriority"`
	MaxPriority int `json:"maxPriority"`
	// MaxActionsPerBatch limits how many side effects we apply after one collector batch.
	MaxActionsPerBatch int   `json:"maxActionsPerBatch"`
	UpdatedAtMS        int64 `json:"updatedAtMs,omitempty"`
}

func DefaultConfig() Config {
	return Config{
		Enabled:               false,
		AutoPriorityEnabled:   true,
		AutoStatusEnabled:     true,
		AutoCPAAccountEnabled: true,
		RenewExpiryOnSuccess:  false,
		RenewalSeconds:        86400,
		WindowSeconds:         3600,
		PriorityBoost:         1,
		PriorityPenalty:       2,
		FailureThreshold:      3,
		RecoveryThreshold:     2,
		MinPriority:           0,
		MaxPriority:           100,
		MaxActionsPerBatch:    50,
	}
}

func (c Config) Normalize() Config {
	next := c
	if next.WindowSeconds <= 0 {
		next.WindowSeconds = 3600
	}
	if next.PriorityBoost < 0 {
		next.PriorityBoost = 0
	}
	if next.PriorityPenalty < 0 {
		next.PriorityPenalty = 0
	}
	if next.FailureThreshold <= 0 {
		next.FailureThreshold = 3
	}
	if next.RecoveryThreshold <= 0 {
		next.RecoveryThreshold = 2
	}
	if next.MaxPriority <= next.MinPriority {
		next.MinPriority = 0
		next.MaxPriority = 100
	}
	if next.MaxActionsPerBatch <= 0 {
		next.MaxActionsPerBatch = 50
	}
	if next.RenewalSeconds <= 0 {
		next.RenewalSeconds = 86400
	}
	return next
}

type KeyPolicy struct {
	Enabled               *bool `json:"enabled,omitempty"`
	AutoPriorityEnabled   *bool `json:"autoPriorityEnabled,omitempty"`
	AutoStatusEnabled     *bool `json:"autoStatusEnabled,omitempty"`
	AutoCPAAccountEnabled *bool `json:"autoCpaAccountEnabled,omitempty"`
	RenewExpiryOnSuccess  *bool `json:"renewExpiryOnSuccess,omitempty"`
	RenewalSeconds        *int  `json:"renewalSeconds,omitempty"`
	PriorityBoost         *int  `json:"priorityBoost,omitempty"`
	PriorityPenalty       *int  `json:"priorityPenalty,omitempty"`
	FailureThreshold      *int  `json:"failureThreshold,omitempty"`
	RecoveryThreshold     *int  `json:"recoveryThreshold,omitempty"`
	MinPriority           *int  `json:"minPriority,omitempty"`
	MaxPriority           *int  `json:"maxPriority,omitempty"`
}

func (p KeyPolicy) Apply(base Config) (Config, bool) {
	enabled := p.Enabled == nil || *p.Enabled
	next := base
	applyBool := func(value *bool, target *bool) {
		if value != nil {
			*target = *value
		}
	}
	applyInt := func(value *int, target *int) {
		if value != nil {
			*target = *value
		}
	}
	applyBool(p.AutoPriorityEnabled, &next.AutoPriorityEnabled)
	applyBool(p.AutoStatusEnabled, &next.AutoStatusEnabled)
	applyBool(p.AutoCPAAccountEnabled, &next.AutoCPAAccountEnabled)
	applyBool(p.RenewExpiryOnSuccess, &next.RenewExpiryOnSuccess)
	applyInt(p.RenewalSeconds, &next.RenewalSeconds)
	applyInt(p.PriorityBoost, &next.PriorityBoost)
	applyInt(p.PriorityPenalty, &next.PriorityPenalty)
	applyInt(p.FailureThreshold, &next.FailureThreshold)
	applyInt(p.RecoveryThreshold, &next.RecoveryThreshold)
	applyInt(p.MinPriority, &next.MinPriority)
	applyInt(p.MaxPriority, &next.MaxPriority)
	return next.Normalize(), enabled
}

type Result struct {
	ID            int64  `json:"id"`
	EventHash     string `json:"event_hash"`
	RequestID     string `json:"request_id,omitempty"`
	TimestampMS   int64  `json:"timestamp_ms"`
	AuthIndex     string `json:"auth_index,omitempty"`
	APIKeyHash    string `json:"api_key_hash,omitempty"`
	KeyID         *int64 `json:"key_id,omitempty"`
	ProviderID    *int64 `json:"provider_id,omitempty"`
	ProviderName  string `json:"provider_name,omitempty"`
	Account       string `json:"account,omitempty"`
	AuthLabel     string `json:"auth_label,omitempty"`
	AuthFile      string `json:"auth_file,omitempty"`
	AuthProvider  string `json:"auth_provider,omitempty"`
	Model         string `json:"model,omitempty"`
	Endpoint      string `json:"endpoint,omitempty"`
	StatusCode    int64  `json:"status_code,omitempty"`
	LatencyMS     *int64 `json:"latency_ms,omitempty"`
	Failed        bool   `json:"failed"`
	Success       bool   `json:"success"`
	ErrorMessage  string `json:"error_message,omitempty"`
	ActionApplied string `json:"action_applied,omitempty"`
	ActionDetail  string `json:"action_detail,omitempty"`
	CreatedAtMS   int64  `json:"created_at_ms"`
}

type Summary struct {
	WindowSeconds  int     `json:"window_seconds"`
	TotalProbes    int64   `json:"total_probes"`
	SuccessCount   int64   `json:"success_count"`
	FailureCount   int64   `json:"failure_count"`
	SuccessRate    float64 `json:"success_rate"`
	UniqueKeys     int64   `json:"unique_keys"`
	UniqueAccounts int64   `json:"unique_accounts"`
	AvgLatencyMS   *int64  `json:"avg_latency_ms,omitempty"`
	LastProbeAtMS  int64   `json:"last_probe_at_ms,omitempty"`
	ActionsApplied int64   `json:"actions_applied"`
	Enabled        bool    `json:"enabled"`
	ServiceStatus  string  `json:"service_status"`
}

type KeyStat struct {
	KeyID           *int64  `json:"key_id,omitempty"`
	AuthIndex       string  `json:"auth_index,omitempty"`
	APIKeyHash      string  `json:"api_key_hash,omitempty"`
	ProviderID      *int64  `json:"provider_id,omitempty"`
	ProviderName    string  `json:"provider_name,omitempty"`
	Account         string  `json:"account,omitempty"`
	AuthLabel       string  `json:"auth_label,omitempty"`
	AuthFile        string  `json:"auth_file,omitempty"`
	AuthProvider    string  `json:"auth_provider,omitempty"`
	KeyStatus       *int    `json:"key_status,omitempty"`
	KeyPriority     *int    `json:"key_priority,omitempty"`
	TotalProbes     int64   `json:"total_probes"`
	SuccessCount    int64   `json:"success_count"`
	FailureCount    int64   `json:"failure_count"`
	SuccessRate     float64 `json:"success_rate"`
	AvgLatencyMS    *int64  `json:"avg_latency_ms,omitempty"`
	LastStatusCode  int64   `json:"last_status_code,omitempty"`
	LastFailed      bool    `json:"last_failed"`
	LastError       string  `json:"last_error,omitempty"`
	LastProbeAtMS   int64   `json:"last_probe_at_ms,omitempty"`
	ConsecutiveFail int64   `json:"consecutive_fail"`
	ConsecutiveOK   int64   `json:"consecutive_ok"`
	LastAction      string  `json:"last_action,omitempty"`
}

type ActionLog struct {
	ID          int64  `json:"id"`
	CreatedAtMS int64  `json:"created_at_ms"`
	AuthIndex   string `json:"auth_index,omitempty"`
	KeyID       *int64 `json:"key_id,omitempty"`
	Action      string `json:"action"`
	Detail      string `json:"detail,omitempty"`
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
}

type Status struct {
	Enabled           bool   `json:"enabled"`
	ServiceStatus     string `json:"service_status"`
	LastProcessedAtMS int64  `json:"last_processed_at_ms,omitempty"`
	TotalProcessed    int64  `json:"total_processed"`
	TotalActions      int64  `json:"total_actions"`
	QueueDepth        int    `json:"queue_depth"`
	DroppedBatches    int64  `json:"dropped_batches"`
	LastError         string `json:"last_error,omitempty"`
	Config            Config `json:"config"`
}

type ListParams struct {
	Page       int
	PageSize   int
	Search     string
	AuthIndex  string
	KeyID      *int64
	ProviderID *int64
	Success    *bool
	SinceMS    *int64
	UntilMS    *int64
}

type PageResult[T any] struct {
	Page       int   `json:"page"`
	PageSize   int   `json:"page_size"`
	TotalItems int64 `json:"total_items"`
	Items      []T   `json:"items"`
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func nowMS() int64 {
	return time.Now().UnixMilli()
}
