package charitable

import (
	"bytes"
	"context"
	"crypto/md5"
	cryptorand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ── Data models ──

type Channel struct {
	ChannelID   int64  `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	Description string `json:"description"`
	Status      int    `json:"status"`
	Param       string `json:"param"`
	URL         string `json:"url,omitempty"`
	CreateAt    string `json:"create_at"`
	UpdateAt    string `json:"update_at"`
}

type Provider struct {
	ProviderID    int64  `json:"provider_id"`
	ProviderName  string `json:"provider_name"`
	Description   string `json:"description"`
	ChannelID     *int64 `json:"channel_id,omitempty"`
	Status        int    `json:"status"`
	BaseURL       string `json:"base_url"`
	ProtocolType  string `json:"protocol_type"`
	CPAConfigType string `json:"cpa_config_type"`
	ProbePolicy   string `json:"probe_policy"`
	Param         string `json:"param"`
	CreateAt      string `json:"create_at"`
	UpdateAt      string `json:"update_at"`
}

// AuthDetail is the upgraded auth entity stored in cpa_auth_detail.
// Compatibility aliases api_key / api_type are filled for auth_type=1.
type AuthDetail struct {
	ID          int64  `json:"id"`
	AuthIndex   string `json:"auth_index"`
	AuthType    int    `json:"auth_type"`
	AuthValue   string `json:"auth_value"`
	AuthInfo    string `json:"auth_info"`
	Content     string `json:"content,omitempty"`
	Status      int    `json:"status"`
	Priority    int    `json:"priority"`
	ExpiresAtMS *int64 `json:"expires_at_ms,omitempty"`
	ProbePolicy string `json:"probe_policy"`
	Param       string `json:"param"`
	ProviderID  *int64 `json:"provider_id,omitempty"`
	OwnerID     *int64 `json:"owner_id,omitempty"`
	CreateAt    string `json:"create_at"`
	UpdateAt    string `json:"update_at"`
	Remark      string `json:"remark,omitempty"`

	// Compatibility fields for existing Keys UI / API clients.
	APIKey  string `json:"api_key,omitempty"`
	APIType int    `json:"api_type,omitempty"`
}

func (detail *AuthDetail) UnmarshalJSON(data []byte) error {
	type authDetailAlias AuthDetail
	payload := struct {
		*authDetailAlias
		AuthInfo json.RawMessage `json:"auth_info"`
		OwnerID  json.RawMessage `json:"owner_id"`
	}{
		authDetailAlias: (*authDetailAlias)(detail),
	}

	*detail = AuthDetail{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}

	authInfo, err := decodeJSONStringOrObject(payload.AuthInfo)
	if err != nil {
		return fmt.Errorf("decode auth_info: %w", err)
	}
	detail.AuthInfo = authInfo

	ownerID, err := decodeOptionalInt64(payload.OwnerID)
	if err != nil {
		return fmt.Errorf("decode owner_id: %w", err)
	}
	detail.OwnerID = ownerID
	return nil
}

func decodeJSONStringOrObject(raw json.RawMessage) (string, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "", nil
	}
	if strings.HasPrefix(trimmed, `"`) {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return "", err
		}
		return value, nil
	}
	if !strings.HasPrefix(trimmed, "{") {
		return "", errors.New("must be a JSON string or object")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return "", err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return "", err
	}
	return compact.String(), nil
}

func decodeOptionalInt64(raw json.RawMessage) (*int64, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	if strings.HasPrefix(trimmed, `"`) {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		trimmed = strings.TrimSpace(value)
		if trimmed == "" {
			return nil, nil
		}
	}
	value, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// APIKey is retained as an alias type name for gradual migration.
type APIKey = AuthDetail

// ProxyDetail stores proxy-side auth configuration in cpa_proxy_detail.
type ProxyDetail struct {
	ID         int64  `json:"id"`
	ProxyIndex string `json:"proxy_index"`
	ProxyType  int    `json:"proxy_type"`
	ProxyValue string `json:"proxy_value"`
	ProxyInfo  string `json:"proxy_info"`
	Content    string `json:"content,omitempty"`
	Status     int    `json:"status"`
	Priority   int    `json:"priority"`
	Param      string `json:"param"`
	OwnerID    *int64 `json:"owner_id,omitempty"`
	CreateAt   string `json:"create_at"`
	UpdateAt   string `json:"update_at"`
	Remark     string `json:"remark,omitempty"`
}

// ClashSubscription is a managed, time-bounded Clash YAML feed.
// ProxyIDs are persisted as a JSON array so the relationship remains owned by
// the secondary-development schema and is independent from community tables.
type ClashSubscription struct {
	ID               int64    `json:"id"`
	Token            string   `json:"token"`
	SubscriptionType int      `json:"subscription_type"`
	ProxyIDs         []int64  `json:"proxy_ids"`
	ProxyURLs        []string `json:"proxy_urls"`
	AccessCount      int64    `json:"access_count"`
	EffectiveAt      string   `json:"effective_at"`
	ExpiresAt        *string  `json:"expires_at,omitempty"`
	CreateAt         string   `json:"create_at"`
	UpdateAt         string   `json:"update_at"`
}

const (
	ClashSubscriptionTypeNodes     = 2
	ClashSubscriptionTypeComposite = 3
)

func (detail *ProxyDetail) UnmarshalJSON(data []byte) error {
	type proxyDetailAlias ProxyDetail
	payload := struct {
		*proxyDetailAlias
		OwnerID json.RawMessage `json:"owner_id"`
	}{
		proxyDetailAlias: (*proxyDetailAlias)(detail),
	}

	*detail = ProxyDetail{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	ownerID, err := decodeOptionalInt64(payload.OwnerID)
	if err != nil {
		return fmt.Errorf("decode owner_id: %w", err)
	}
	detail.OwnerID = ownerID
	return nil
}

func normalizeSubscriptionProxyIDs(ids []int64) ([]int64, error) {
	seen := make(map[int64]struct{}, len(ids))
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, errors.New("invalid_proxy_id")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	if len(result) > 500 {
		return nil, errors.New("subscription_proxy_limit_exceeded")
	}
	return result, nil
}

func subscriptionToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := cryptorand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func scanClashSubscription(scanner interface{ Scan(...any) error }) (ClashSubscription, error) {
	var sub ClashSubscription
	var rawIDs, rawURLs string
	var expires sql.NullString
	if err := scanner.Scan(&sub.ID, &sub.Token, &sub.SubscriptionType, &rawIDs, &rawURLs, &sub.AccessCount, &sub.EffectiveAt, &expires, &sub.CreateAt, &sub.UpdateAt); err != nil {
		return ClashSubscription{}, err
	}
	if err := json.Unmarshal([]byte(rawIDs), &sub.ProxyIDs); err != nil {
		return ClashSubscription{}, fmt.Errorf("decode subscription proxy ids: %w", err)
	}
	if sub.ProxyIDs == nil {
		sub.ProxyIDs = []int64{}
	}
	if err := json.Unmarshal([]byte(rawURLs), &sub.ProxyURLs); err != nil {
		return ClashSubscription{}, fmt.Errorf("decode subscription proxy urls: %w", err)
	}
	if sub.ProxyURLs == nil {
		sub.ProxyURLs = []string{}
	}
	if expires.Valid && strings.TrimSpace(expires.String) != "" {
		value := expires.String
		sub.ExpiresAt = &value
	}
	return sub, nil
}

func (s *CharitableStore) ListClashSubscriptions(ctx context.Context, p ListParams) (PageResult[ClashSubscription], error) {
	var total int64
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM cpa_clash_subscription").Scan(&total); err != nil {
		return PageResult[ClashSubscription]{}, err
	}
	page, pageSize := normalizePage(p.Page, p.PageSize)
	rows, err := s.db.QueryContext(ctx, `SELECT id, token, subscription_type, proxy_ids, proxy_urls, access_count, effective_at, expires_at, create_at, update_at
		FROM cpa_clash_subscription ORDER BY id DESC LIMIT ? OFFSET ?`, pageSize, (page-1)*pageSize)
	if err != nil {
		return PageResult[ClashSubscription]{}, err
	}
	defer rows.Close()
	items := make([]ClashSubscription, 0, pageSize)
	for rows.Next() {
		sub, err := scanClashSubscription(rows)
		if err != nil {
			return PageResult[ClashSubscription]{}, err
		}
		items = append(items, sub)
	}
	return PageResult[ClashSubscription]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

func (s *CharitableStore) GetClashSubscription(ctx context.Context, id int64) (ClashSubscription, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, token, subscription_type, proxy_ids, proxy_urls, access_count, effective_at, expires_at, create_at, update_at
		FROM cpa_clash_subscription WHERE id=?`, id)
	sub, err := scanClashSubscription(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ClashSubscription{}, errors.New("subscription_not_found")
	}
	return sub, err
}

func (s *CharitableStore) GetClashSubscriptionByToken(ctx context.Context, token string) (ClashSubscription, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, token, subscription_type, proxy_ids, proxy_urls, access_count, effective_at, expires_at, create_at, update_at
		FROM cpa_clash_subscription WHERE token=?`, token)
	sub, err := scanClashSubscription(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ClashSubscription{}, errors.New("subscription_not_found")
	}
	return sub, err
}

func (s *CharitableStore) CreateClashSubscription(ctx context.Context, sub *ClashSubscription) error {
	ids, err := normalizeSubscriptionProxyIDs(sub.ProxyIDs)
	if err != nil {
		return err
	}
	sub.ProxyIDs = ids
	if sub.SubscriptionType == 0 {
		sub.SubscriptionType = ClashSubscriptionTypeNodes
	}
	if strings.TrimSpace(sub.Token) == "" {
		sub.Token, err = subscriptionToken()
		if err != nil {
			return err
		}
	}
	rawIDs, _ := json.Marshal(ids)
	rawURLs, _ := json.Marshal(sub.ProxyURLs)
	result, err := s.db.ExecContext(ctx, `INSERT INTO cpa_clash_subscription (token, subscription_type, proxy_ids, proxy_urls, effective_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)`, sub.Token, sub.SubscriptionType, string(rawIDs), string(rawURLs), sub.EffectiveAt, nullStringPtr(sub.ExpiresAt))
	if err != nil {
		return err
	}
	sub.ID, _ = result.LastInsertId()
	return s.GetClashSubscriptionInto(ctx, sub.ID, sub)
}

func (s *CharitableStore) UpdateClashSubscription(ctx context.Context, id int64, sub *ClashSubscription) error {
	ids, err := normalizeSubscriptionProxyIDs(sub.ProxyIDs)
	if err != nil {
		return err
	}
	sub.ProxyIDs = ids
	rawIDs, _ := json.Marshal(ids)
	rawURLs, _ := json.Marshal(sub.ProxyURLs)
	result, err := s.db.ExecContext(ctx, `UPDATE cpa_clash_subscription SET subscription_type=?, proxy_ids=?, proxy_urls=?, effective_at=?, expires_at=?, update_at=CURRENT_TIMESTAMP WHERE id=?`,
		sub.SubscriptionType, string(rawIDs), string(rawURLs), sub.EffectiveAt, nullStringPtr(sub.ExpiresAt), id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return errors.New("subscription_not_found")
	}
	return s.GetClashSubscriptionInto(ctx, id, sub)
}

func (s *CharitableStore) GetClashSubscriptionInto(ctx context.Context, id int64, target *ClashSubscription) error {
	item, err := s.GetClashSubscription(ctx, id)
	if err != nil {
		return err
	}
	*target = item
	return nil
}

func (s *CharitableStore) DeleteClashSubscription(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM cpa_clash_subscription WHERE id=?", id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return errors.New("subscription_not_found")
	}
	return nil
}

// IncrementClashSubscriptionAccess validates the active window and increments
// access_count in one write. The returned record is the current subscription.
func (s *CharitableStore) IncrementClashSubscriptionAccess(ctx context.Context, token string, now time.Time) (ClashSubscription, error) {
	sub, err := s.GetClashSubscriptionByToken(ctx, token)
	if err != nil {
		return ClashSubscription{}, err
	}
	effective, err := parseStoredSubscriptionTime(sub.EffectiveAt)
	if err != nil || now.Before(effective) {
		return ClashSubscription{}, errors.New("subscription_not_active")
	}
	if sub.ExpiresAt != nil {
		expires, parseErr := parseStoredSubscriptionTime(*sub.ExpiresAt)
		if parseErr != nil || !now.Before(expires) {
			return ClashSubscription{}, errors.New("subscription_expired")
		}
	}
	if _, err := s.db.ExecContext(ctx, "UPDATE cpa_clash_subscription SET access_count=access_count+1, update_at=CURRENT_TIMESTAMP WHERE token=?", token); err != nil {
		return ClashSubscription{}, err
	}
	return s.GetClashSubscriptionByToken(ctx, token)
}

func parseStoredSubscriptionTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, errors.New("invalid_subscription_time")
}

func nullStringPtr(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return *value
}

// ── List request / response ──

type ListParams struct {
	Page           int
	PageSize       int
	Search         string
	BaseURL        string
	ChannelID      *int64
	ProviderID     *int64
	ProviderIDs    []int64
	Status         *int
	StatusDomain   string
	Priority       *int
	AllStatus      bool
	APIType        *int
	ProxyType      *int
	CredentialKind string
}

type PageResult[T any] struct {
	Page       int   `json:"page"`
	PageSize   int   `json:"page_size"`
	TotalItems int64 `json:"total_items"`
	Items      []T   `json:"items"`
}

// KeyStatusCount is the distribution item used by the key status filter.
type KeyStatusCount struct {
	Status int   `json:"status"`
	Count  int64 `json:"count"`
}

// ── Store ──

type CharitableStore struct {
	db *sql.DB
}

func NewCharitableStore(db *sql.DB) *CharitableStore {
	return &CharitableStore{db: db}
}

// ──────────────────────────────────────────────────────────────────────────────
// Channel CRUD
// ──────────────────────────────────────────────────────────────────────────────

func (s *CharitableStore) ListChannels(ctx context.Context, p ListParams) (PageResult[Channel], error) {
	where, args := buildChannelWhere(p)

	var total int64
	if err := s.db.QueryRowContext(ctx,
		"SELECT count(*) FROM cpa_channel_info"+where, args...,
	).Scan(&total); err != nil {
		return PageResult[Channel]{}, err
	}

	page, pageSize := normalizePage(p.Page, p.PageSize)
	query := "SELECT channel_id, channel_name, description, status, param, url, create_at, update_at" +
		" FROM cpa_channel_info" + where +
		" ORDER BY channel_id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return PageResult[Channel]{}, err
	}
	defer rows.Close()

	items := make([]Channel, 0, pageSize)
	for rows.Next() {
		var c Channel
		var url sql.NullString
		if err := rows.Scan(&c.ChannelID, &c.ChannelName, &c.Description, &c.Status, &c.Param, &url, &c.CreateAt, &c.UpdateAt); err != nil {
			return PageResult[Channel]{}, err
		}
		c.URL = url.String
		items = append(items, c)
	}
	return PageResult[Channel]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

func (s *CharitableStore) GetChannel(ctx context.Context, id int64) (Channel, error) {
	var c Channel
	var url sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT channel_id, channel_name, description, status, param, url, create_at, update_at FROM cpa_channel_info WHERE channel_id=?", id,
	).Scan(&c.ChannelID, &c.ChannelName, &c.Description, &c.Status, &c.Param, &url, &c.CreateAt, &c.UpdateAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Channel{}, errors.New("channel_not_found")
	}
	if err != nil {
		return Channel{}, err
	}
	c.URL = url.String
	return c, nil
}

func (s *CharitableStore) CreateChannel(ctx context.Context, c *Channel) error {
	if c.Status == 0 {
		c.Status = 1
	}
	return s.createChannel(ctx, c)
}

func (s *CharitableStore) CreateChannelWithStatus(ctx context.Context, c *Channel) error {
	return s.createChannel(ctx, c)
}

func (s *CharitableStore) createChannel(ctx context.Context, c *Channel) error {
	if err := validateJSON(c.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	result, err := s.db.ExecContext(ctx,
		"INSERT INTO cpa_channel_info (channel_name, description, status, param, url) VALUES (?, ?, ?, ?, ?)",
		c.ChannelName, c.Description, c.Status, defaultJSON(c.Param), nullString(c.URL),
	)
	if err != nil {
		return err
	}
	c.ChannelID, _ = result.LastInsertId()
	return nil
}

func (s *CharitableStore) UpdateChannel(ctx context.Context, id int64, c *Channel) error {
	if err := validateJSON(c.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	res, err := s.db.ExecContext(ctx,
		"UPDATE cpa_channel_info SET channel_name=?, description=?, status=?, param=?, url=?, update_at=CURRENT_TIMESTAMP WHERE channel_id=?",
		c.ChannelName, c.Description, c.Status, defaultJSON(c.Param), nullString(c.URL), id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("channel_not_found")
	}
	return nil
}

// DeleteChannel performs a soft delete by setting status=-1.
func (s *CharitableStore) DeleteChannel(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx,
		"UPDATE cpa_channel_info SET status=-1, update_at=CURRENT_TIMESTAMP WHERE channel_id=?", id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("channel_not_found")
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────────────────
// Provider CRUD
// ──────────────────────────────────────────────────────────────────────────────

func (s *CharitableStore) ListProviders(ctx context.Context, p ListParams) (PageResult[Provider], error) {
	where, args := buildProviderWhere(p)

	var total int64
	if err := s.db.QueryRowContext(ctx,
		"SELECT count(*) FROM cpa_provider_info"+where, args...,
	).Scan(&total); err != nil {
		return PageResult[Provider]{}, err
	}

	page, pageSize := normalizePage(p.Page, p.PageSize)
	query := "SELECT provider_id, provider_name, description, channel_id, status, base_url, protocol_type, cpa_config_type, probe_policy, param, create_at, update_at" +
		" FROM cpa_provider_info" + where +
		" ORDER BY provider_id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return PageResult[Provider]{}, err
	}
	defer rows.Close()

	items := make([]Provider, 0, pageSize)
	for rows.Next() {
		var p Provider
		var channelID sql.NullInt64
		if err := rows.Scan(&p.ProviderID, &p.ProviderName, &p.Description, &channelID, &p.Status, &p.BaseURL, &p.ProtocolType, &p.CPAConfigType, &p.ProbePolicy, &p.Param, &p.CreateAt, &p.UpdateAt); err != nil {
			return PageResult[Provider]{}, err
		}
		if channelID.Valid {
			v := channelID.Int64
			p.ChannelID = &v
		}
		items = append(items, p)
	}
	return PageResult[Provider]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

func (s *CharitableStore) GetProvider(ctx context.Context, id int64) (Provider, error) {
	var p Provider
	var channelID sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		"SELECT provider_id, provider_name, description, channel_id, status, base_url, protocol_type, cpa_config_type, probe_policy, param, create_at, update_at FROM cpa_provider_info WHERE provider_id=?", id,
	).Scan(&p.ProviderID, &p.ProviderName, &p.Description, &channelID, &p.Status, &p.BaseURL, &p.ProtocolType, &p.CPAConfigType, &p.ProbePolicy, &p.Param, &p.CreateAt, &p.UpdateAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Provider{}, errors.New("provider_not_found")
	}
	if err != nil {
		return Provider{}, err
	}
	if channelID.Valid {
		v := channelID.Int64
		p.ChannelID = &v
	}
	return p, nil
}

func (s *CharitableStore) CreateProvider(ctx context.Context, p *Provider) error {
	if p.Status == 0 {
		p.Status = 1
	}
	return s.createProvider(ctx, p)
}

func (s *CharitableStore) CreateProviderWithStatus(ctx context.Context, p *Provider) error {
	return s.createProvider(ctx, p)
}

func (s *CharitableStore) createProvider(ctx context.Context, p *Provider) error {
	normalizeProviderIntegration(p)
	if err := validateJSON(p.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	if err := validateJSON(p.ProbePolicy); err != nil {
		return errors.New("invalid_probe_policy_json")
	}

	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		result, err := s.db.ExecContext(ctx,
			"INSERT INTO cpa_provider_info (provider_name, description, channel_id, status, base_url, protocol_type, cpa_config_type, probe_policy, param) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			p.ProviderName, p.Description, nullInt64(p.ChannelID), p.Status, p.BaseURL, p.ProtocolType, p.CPAConfigType, defaultJSON(p.ProbePolicy), defaultJSON(p.Param),
		)
		if err != nil {
			// If channel_id is missing/invalid under FK enforcement, retry without channel.
			if p.ChannelID != nil && strings.Contains(strings.ToLower(err.Error()), "foreign key") {
				p.ChannelID = nil
				result, err = s.db.ExecContext(ctx,
					"INSERT INTO cpa_provider_info (provider_name, description, channel_id, status, base_url, protocol_type, cpa_config_type, probe_policy, param) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
					p.ProviderName, p.Description, nil, p.Status, p.BaseURL, p.ProtocolType, p.CPAConfigType, defaultJSON(p.ProbePolicy), defaultJSON(p.Param),
				)
			}
		}
		if err == nil {
			p.ProviderID, _ = result.LastInsertId()
			return nil
		}
		lastErr = err
		if !isSQLiteBusy(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(40*(attempt+1)) * time.Millisecond):
		}
	}
	return lastErr
}

func (s *CharitableStore) UpdateProvider(ctx context.Context, id int64, p *Provider) error {
	normalizeProviderIntegration(p)
	if err := validateJSON(p.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	if err := validateJSON(p.ProbePolicy); err != nil {
		return errors.New("invalid_probe_policy_json")
	}
	res, err := s.db.ExecContext(ctx,
		"UPDATE cpa_provider_info SET provider_name=?, description=?, channel_id=?, status=?, base_url=?, protocol_type=?, cpa_config_type=?, probe_policy=?, param=?, update_at=CURRENT_TIMESTAMP WHERE provider_id=?",
		p.ProviderName, p.Description, nullInt64(p.ChannelID), p.Status, p.BaseURL, p.ProtocolType, p.CPAConfigType, defaultJSON(p.ProbePolicy), defaultJSON(p.Param), id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("provider_not_found")
	}
	return nil
}

func normalizeProviderIntegration(p *Provider) {
	p.ProtocolType = normalizeProtocolTypeList(p.ProtocolType)
	p.CPAConfigType = strings.TrimSpace(p.CPAConfigType)
	if p.ProtocolType == "" {
		p.ProtocolType = "openai_compatible"
	}
	if p.CPAConfigType == "" {
		// Prefer CPA target matching the first selected protocol.
		first := strings.Split(p.ProtocolType, ",")[0]
		switch first {
		case "anthropic":
			p.CPAConfigType = "claude-api-key"
		case "gemini":
			p.CPAConfigType = "gemini-api-key"
		case "codex":
			p.CPAConfigType = "codex-api-key"
		case "vertex":
			p.CPAConfigType = "vertex-api-key"
		default:
			p.CPAConfigType = "openai-compatibility"
		}
	}
}

// normalizeProtocolTypeList accepts a single protocol or comma-separated multi-select
// list, de-duplicates, and keeps a stable order matching the product option list.
func normalizeProtocolTypeList(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// Normalize separators to commas so Split stays simple.
	raw = strings.Map(func(r rune) rune {
		switch r {
		case ';', '|', ' ', 9, 10, 13:
			return ','
		default:
			return r
		}
	}, raw)
	order := []string{"openai_compatible", "anthropic", "gemini", "codex", "vertex"}
	seen := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		token := strings.TrimSpace(part)
		if token != "" {
			seen[token] = true
		}
	}
	out := make([]string, 0, len(order))
	for _, name := range order {
		if seen[name] {
			out = append(out, name)
		}
	}
	for token := range seen {
		found := false
		for _, known := range order {
			if token == known {
				found = true
				break
			}
		}
		if !found {
			out = append(out, token)
		}
	}
	return strings.Join(out, ",")
}

// PrimaryProtocolType returns the first selected protocol for probe/sync consumers
// that still operate on a single adapter.
func PrimaryProtocolType(raw string) string {
	normalized := normalizeProtocolTypeList(raw)
	if normalized == "" {
		return "openai_compatible"
	}
	return strings.Split(normalized, ",")[0]
}

// DeleteProvider performs a soft delete by setting status=-1.
func (s *CharitableStore) DeleteProvider(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx,
		"UPDATE cpa_provider_info SET status=-1, update_at=CURRENT_TIMESTAMP WHERE provider_id=?", id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("provider_not_found")
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────────────────
// Auth / Key CRUD (cpa_auth_detail, with Keys API compatibility)
// ──────────────────────────────────────────────────────────────────────────────

func (s *CharitableStore) ListKeys(ctx context.Context, p ListParams) (PageResult[APIKey], error) {
	where, args := buildAuthWhere(p)

	var total int64
	if err := s.db.QueryRowContext(ctx,
		"SELECT count(*) FROM cpa_auth_detail"+where, args...,
	).Scan(&total); err != nil {
		return PageResult[APIKey]{}, err
	}

	page, pageSize := normalizePage(p.Page, p.PageSize)
	query := "SELECT id, auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, create_at, update_at, remark" +
		" FROM cpa_auth_detail" + where +
		" ORDER BY id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return PageResult[APIKey]{}, err
	}
	defer rows.Close()

	items := make([]APIKey, 0, pageSize)
	for rows.Next() {
		item, err := scanAuthDetail(rows)
		if err != nil {
			return PageResult[APIKey]{}, err
		}
		items = append(items, item)
	}
	return PageResult[APIKey]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

// ListKeyStatusCounts returns concrete auth status codes after applying every
// list filter except status itself. This is deliberately separate from
// ListKeys pagination so a large result set can still expose all status codes.
func (s *CharitableStore) ListKeyStatusCounts(ctx context.Context, p ListParams) ([]KeyStatusCount, error) {
	p.Status = nil
	p.StatusDomain = ""
	where, args := buildAuthWhere(p)
	rows, err := s.db.QueryContext(ctx,
		"SELECT status, count(*) FROM cpa_auth_detail"+where+" GROUP BY status ORDER BY status DESC", args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]KeyStatusCount, 0)
	for rows.Next() {
		var item KeyStatusCount
		if err := rows.Scan(&item.Status, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *CharitableStore) GetKey(ctx context.Context, id int64) (APIKey, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, create_at, update_at, remark FROM cpa_auth_detail WHERE id=?", id,
	)
	item, err := scanAuthDetail(row)
	if errors.Is(err, sql.ErrNoRows) {
		return APIKey{}, errors.New("key_not_found")
	}
	return item, err
}

func (s *CharitableStore) GetKeyByIndex(ctx context.Context, authIndex string) (APIKey, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, create_at, update_at, remark FROM cpa_auth_detail WHERE auth_index=?",
		strings.TrimSpace(authIndex),
	)
	item, err := scanAuthDetail(row)
	if errors.Is(err, sql.ErrNoRows) {
		return APIKey{}, errors.New("key_not_found")
	}
	return item, err
}

// GetKeyByFileName returns the latest auth row whose auth_info.file_name matches.
// Matching is case-insensitive and ignores path separators in the stored name.
func (s *CharitableStore) GetKeyByFileName(ctx context.Context, fileName string) (APIKey, error) {
	name := strings.TrimSpace(fileName)
	if name == "" {
		return APIKey{}, errors.New("key_not_found")
	}
	// Prefer exact lower(file_name) match on JSON metadata.
	row := s.db.QueryRowContext(ctx, `
		SELECT id, auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, create_at, update_at, remark
		FROM cpa_auth_detail
		WHERE json_valid(auth_info)
		  AND json_type(auth_info) = 'object'
		  AND lower(coalesce(json_extract(auth_info, '$.file_name'), '')) = lower(?)
		ORDER BY datetime(update_at) DESC, id DESC
		LIMIT 1`, name)
	item, err := scanAuthDetail(row)
	if errors.Is(err, sql.ErrNoRows) {
		return APIKey{}, errors.New("key_not_found")
	}
	return item, err
}

func (s *CharitableStore) CreateKey(ctx context.Context, k *APIKey) error {
	if err := normalizeAuthDetail(k); err != nil {
		return err
	}
	s.resolveProviderIDFromAuthInfo(ctx, k)
	if err := validateJSON(k.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	if err := validateJSON(k.ProbePolicy); err != nil {
		return errors.New("invalid_probe_policy_json")
	}
	result, err := s.db.ExecContext(ctx,
		`INSERT INTO cpa_auth_detail (auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, remark)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		k.AuthIndex, k.AuthType, k.AuthValue, k.AuthInfo, nullString(k.Content), k.Status, k.Priority,
		nullInt64(k.ExpiresAtMS), defaultJSON(k.ProbePolicy), defaultJSON(k.Param), nullInt64(k.ProviderID), nullInt64(k.OwnerID), nullString(k.Remark),
	)
	if err != nil {
		if isUniqueConflict(err) {
			return errors.New("auth_index_conflict")
		}
		return err
	}
	k.ID, _ = result.LastInsertId()
	hydrateAuthCompat(k)
	return nil
}

func (s *CharitableStore) UpdateKey(ctx context.Context, id int64, k *APIKey) error {
	if err := normalizeAuthDetail(k); err != nil {
		return err
	}
	s.resolveProviderIDFromAuthInfo(ctx, k)
	if err := validateJSON(k.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	if err := validateJSON(k.ProbePolicy); err != nil {
		return errors.New("invalid_probe_policy_json")
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE cpa_auth_detail SET auth_index=?, auth_type=?, auth_value=?, auth_info=?, content=?, status=?, priority=?,
		 expires_at_ms=?, probe_policy=?, param=?, provider_id=?, owner_id=?, remark=?, update_at=CURRENT_TIMESTAMP WHERE id=?`,
		k.AuthIndex, k.AuthType, k.AuthValue, k.AuthInfo, nullString(k.Content), k.Status, k.Priority,
		nullInt64(k.ExpiresAtMS), defaultJSON(k.ProbePolicy), defaultJSON(k.Param), nullInt64(k.ProviderID), nullInt64(k.OwnerID), nullString(k.Remark), id,
	)
	if err != nil {
		if isUniqueConflict(err) {
			return errors.New("auth_index_conflict")
		}
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("key_not_found")
	}
	hydrateAuthCompat(k)
	return nil
}

// UpsertKey treats auth_index as the business key. A missing index is derived
// from auth_value (or content), while a supplied index is preserved verbatim.
func (s *CharitableStore) UpsertKey(ctx context.Context, k *APIKey) (bool, error) {
	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		created, err := s.upsertKeyOnce(ctx, k)
		if err == nil {
			return created, nil
		}
		lastErr = err
		if !isSQLiteBusy(err) {
			return false, err
		}
		// Exponential-ish backoff for sqlite lock contention under batch sync.
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(time.Duration(40*(attempt+1)) * time.Millisecond):
		}
	}
	return false, lastErr
}

func (s *CharitableStore) upsertKeyOnce(ctx context.Context, k *APIKey) (bool, error) {
	if err := normalizeAuthDetail(k); err != nil {
		return false, err
	}
	s.resolveProviderIDFromAuthInfo(ctx, k)
	if err := validateJSON(k.Param); err != nil {
		return false, errors.New("invalid_param_json")
	}
	if err := validateJSON(k.ProbePolicy); err != nil {
		return false, errors.New("invalid_probe_policy_json")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	created := false
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM cpa_auth_detail WHERE auth_index=?",
		k.AuthIndex,
	).Scan(&id)
	switch {
	case err == nil:
		_, err = tx.ExecContext(ctx,
			`UPDATE cpa_auth_detail SET auth_type=?, auth_value=?, auth_info=?, content=?, status=?, priority=?, expires_at_ms=?,
			 probe_policy=?, param=?, provider_id=?, owner_id=?, remark=?, update_at=CURRENT_TIMESTAMP WHERE id=?`,
			k.AuthType, k.AuthValue, k.AuthInfo, nullString(k.Content), k.Status, k.Priority, nullInt64(k.ExpiresAtMS),
			defaultJSON(k.ProbePolicy), defaultJSON(k.Param), nullInt64(k.ProviderID), nullInt64(k.OwnerID), nullString(k.Remark), id,
		)
		if err != nil {
			return false, err
		}
	case errors.Is(err, sql.ErrNoRows):
		result, insertErr := tx.ExecContext(ctx,
			`INSERT INTO cpa_auth_detail (auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, remark)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			k.AuthIndex, k.AuthType, k.AuthValue, k.AuthInfo, nullString(k.Content), k.Status, k.Priority,
			nullInt64(k.ExpiresAtMS), defaultJSON(k.ProbePolicy), defaultJSON(k.Param), nullInt64(k.ProviderID), nullInt64(k.OwnerID), nullString(k.Remark),
		)
		if insertErr != nil {
			if isUniqueConflict(insertErr) {
				return false, errors.New("auth_index_conflict")
			}
			return false, insertErr
		}
		id, _ = result.LastInsertId()
		created = true
	default:
		return false, err
	}

	row := tx.QueryRowContext(ctx,
		"SELECT id, auth_index, auth_type, auth_value, auth_info, content, status, priority, expires_at_ms, probe_policy, param, provider_id, owner_id, create_at, update_at, remark FROM cpa_auth_detail WHERE id=?",
		id,
	)
	saved, err := scanAuthDetail(row)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	*k = saved
	return created, nil
}

func (s *CharitableStore) DeleteKey(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM cpa_auth_detail WHERE id=?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("key_not_found")
	}
	return nil
}

func (s *CharitableStore) UpdateKeyParam(ctx context.Context, id int64, param string) error {
	if err := validateJSON(param); err != nil {
		return errors.New("invalid_param_json")
	}
	res, err := s.db.ExecContext(ctx,
		"UPDATE cpa_auth_detail SET param=?, update_at=CURRENT_TIMESTAMP WHERE id=?",
		defaultJSON(param), id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("key_not_found")
	}
	return nil
}

func (s *CharitableStore) BatchDeleteKeys(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	res, err := s.db.ExecContext(ctx,
		"DELETE FROM cpa_auth_detail WHERE id IN ("+strings.Join(placeholders, ",")+")", args...,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *CharitableStore) BatchToggleKeys(ctx context.Context, ids []int64, status int) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids)+1)
	args = append(args, status)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	res, err := s.db.ExecContext(ctx,
		"UPDATE cpa_auth_detail SET status=?, update_at=CURRENT_TIMESTAMP WHERE id IN ("+strings.Join(placeholders, ",")+")", args...,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ──────────────────────────────────────────────────────────────────────────────
// Proxy CRUD (cpa_proxy_detail)
// ──────────────────────────────────────────────────────────────────────────────

func (s *CharitableStore) ListProxies(ctx context.Context, p ListParams) (PageResult[ProxyDetail], error) {
	where, args := buildProxyWhere(p)
	var total int64
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM cpa_proxy_detail"+where, args...).Scan(&total); err != nil {
		return PageResult[ProxyDetail]{}, err
	}
	page, pageSize := normalizePage(p.Page, p.PageSize)
	query := "SELECT id, proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, create_at, update_at, remark" +
		" FROM cpa_proxy_detail" + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return PageResult[ProxyDetail]{}, err
	}
	defer rows.Close()
	items := make([]ProxyDetail, 0, pageSize)
	for rows.Next() {
		item, err := scanProxyDetail(rows)
		if err != nil {
			return PageResult[ProxyDetail]{}, err
		}
		items = append(items, item)
	}
	return PageResult[ProxyDetail]{Page: page, PageSize: pageSize, TotalItems: total, Items: items}, rows.Err()
}

func (s *CharitableStore) GetProxy(ctx context.Context, id int64) (ProxyDetail, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, create_at, update_at, remark FROM cpa_proxy_detail WHERE id=?", id,
	)
	item, err := scanProxyDetail(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProxyDetail{}, errors.New("proxy_not_found")
	}
	return item, err
}

func (s *CharitableStore) GetProxyByIndex(ctx context.Context, proxyIndex string) (ProxyDetail, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, create_at, update_at, remark FROM cpa_proxy_detail WHERE proxy_index=?",
		strings.TrimSpace(proxyIndex),
	)
	item, err := scanProxyDetail(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProxyDetail{}, errors.New("proxy_not_found")
	}
	return item, err
}

func (s *CharitableStore) GetProxyByValue(ctx context.Context, proxyValue string) (ProxyDetail, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, create_at, update_at, remark FROM cpa_proxy_detail WHERE proxy_value=?",
		strings.TrimSpace(proxyValue),
	)
	item, err := scanProxyDetail(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProxyDetail{}, errors.New("proxy_not_found")
	}
	return item, err
}

func (s *CharitableStore) GetProxyIDsByValue(ctx context.Context, proxyValue string) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id FROM cpa_proxy_detail WHERE proxy_value=?", strings.TrimSpace(proxyValue))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, errors.New("proxy_not_found")
	}
	return ids, nil
}

func (s *CharitableStore) CreateProxy(ctx context.Context, p *ProxyDetail) error {
	if err := normalizeProxyDetail(p); err != nil {
		return err
	}
	if err := validateJSON(p.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	result, err := s.db.ExecContext(ctx,
		`INSERT INTO cpa_proxy_detail (proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, remark)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ProxyIndex, p.ProxyType, p.ProxyValue, p.ProxyInfo, nullString(p.Content), p.Status, p.Priority,
		defaultJSON(p.Param), nullInt64(p.OwnerID), nullString(p.Remark),
	)
	if err != nil {
		if isUniqueConflict(err) {
			return errors.New("proxy_index_conflict")
		}
		return err
	}
	p.ID, _ = result.LastInsertId()
	return nil
}

func (s *CharitableStore) UpdateProxy(ctx context.Context, id int64, p *ProxyDetail) error {
	if err := normalizeProxyDetail(p); err != nil {
		return err
	}
	if err := validateJSON(p.Param); err != nil {
		return errors.New("invalid_param_json")
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE cpa_proxy_detail SET proxy_index=?, proxy_type=?, proxy_value=?, proxy_info=?, content=?, status=?, priority=?,
		 param=?, owner_id=?, remark=?, update_at=CURRENT_TIMESTAMP WHERE id=?`,
		p.ProxyIndex, p.ProxyType, p.ProxyValue, p.ProxyInfo, nullString(p.Content), p.Status, p.Priority,
		defaultJSON(p.Param), nullInt64(p.OwnerID), nullString(p.Remark), id,
	)
	if err != nil {
		if isUniqueConflict(err) {
			return errors.New("proxy_index_conflict")
		}
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("proxy_not_found")
	}
	return nil
}

// UpsertProxy treats proxy_index as the business key. A missing index is
// derived from proxy_value (or content), while a supplied index is preserved.
func (s *CharitableStore) UpsertProxy(ctx context.Context, p *ProxyDetail) (bool, error) {
	if err := normalizeProxyDetail(p); err != nil {
		return false, err
	}
	if err := validateJSON(p.Param); err != nil {
		return false, errors.New("invalid_param_json")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	created := false
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM cpa_proxy_detail WHERE proxy_index=?",
		p.ProxyIndex,
	).Scan(&id)
	switch {
	case err == nil:
		_, err = tx.ExecContext(ctx,
			`UPDATE cpa_proxy_detail SET proxy_type=?, proxy_value=?, proxy_info=?, content=?, status=?, priority=?, param=?, owner_id=?, remark=?, update_at=CURRENT_TIMESTAMP WHERE id=?`,
			p.ProxyType, p.ProxyValue, p.ProxyInfo, nullString(p.Content), p.Status, p.Priority, defaultJSON(p.Param), nullInt64(p.OwnerID), nullString(p.Remark), id,
		)
		if err != nil {
			return false, err
		}
	case errors.Is(err, sql.ErrNoRows):
		result, insertErr := tx.ExecContext(ctx,
			`INSERT INTO cpa_proxy_detail (proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, remark)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.ProxyIndex, p.ProxyType, p.ProxyValue, p.ProxyInfo, nullString(p.Content), p.Status, p.Priority,
			defaultJSON(p.Param), nullInt64(p.OwnerID), nullString(p.Remark),
		)
		if insertErr != nil {
			if isUniqueConflict(insertErr) {
				return false, errors.New("proxy_index_conflict")
			}
			return false, insertErr
		}
		id, _ = result.LastInsertId()
		created = true
	default:
		return false, err
	}

	row := tx.QueryRowContext(ctx,
		"SELECT id, proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, create_at, update_at, remark FROM cpa_proxy_detail WHERE id=?",
		id,
	)
	saved, err := scanProxyDetail(row)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	*p = saved
	return created, nil
}

func (s *CharitableStore) DeleteProxy(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM cpa_proxy_detail WHERE id=?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("proxy_not_found")
	}
	return nil
}

func (s *CharitableStore) BatchDeleteProxies(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for index, id := range ids {
		placeholders[index] = "?"
		args[index] = id
	}
	res, err := s.db.ExecContext(ctx, "DELETE FROM cpa_proxy_detail WHERE id IN ("+strings.Join(placeholders, ",")+")", args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *CharitableStore) GetProxiesByIDs(ctx context.Context, ids []int64) ([]ProxyDetail, error) {
	if len(ids) == 0 {
		return []ProxyDetail{}, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for index, id := range ids {
		placeholders[index] = "?"
		args[index] = id
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, proxy_index, proxy_type, proxy_value, proxy_info, content, status, priority, param, owner_id, create_at, update_at, remark FROM cpa_proxy_detail WHERE id IN ("+strings.Join(placeholders, ",")+")",
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ProxyDetail, 0, len(ids))
	for rows.Next() {
		item, err := scanProxyDetail(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// GetKeyFullParam returns the merged param for a key by walking key → provider → channel.
// The merge is NOT affected by soft-delete status of provider or channel.
func (s *CharitableStore) GetKeyFullParam(ctx context.Context, keyID int64) (map[string]any, *APIKey, error) {
	// Step 1: query key
	var keyParam string
	var providerID sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		"SELECT param, provider_id FROM cpa_auth_detail WHERE id=?", keyID,
	).Scan(&keyParam, &providerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errors.New("key_not_found")
	}
	if err != nil {
		return nil, nil, err
	}

	providerParam := "{}"
	channelParam := "{}"

	// Step 2: query provider (if linked)
	if providerID.Valid {
		var channelID sql.NullInt64
		err = s.db.QueryRowContext(ctx,
			"SELECT param, channel_id FROM cpa_provider_info WHERE provider_id=?", providerID.Int64,
		).Scan(&providerParam, &channelID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, nil, err
		}

		// Step 3: query channel (if linked)
		if err == nil && channelID.Valid {
			err = s.db.QueryRowContext(ctx,
				"SELECT param FROM cpa_channel_info WHERE channel_id=?", channelID.Int64,
			).Scan(&channelParam)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, nil, err
			}
			if errors.Is(err, sql.ErrNoRows) {
				channelParam = "{}"
			}
		}
	}

	merged, err := MergeParams(channelParam, providerParam, keyParam)
	if err != nil {
		return nil, nil, err
	}
	return merged, nil, nil
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 500 {
		pageSize = 500
	}
	return page, pageSize
}

func defaultJSON(value string) string {
	if strings.TrimSpace(value) == "" {
		return "{}"
	}
	return value
}

func validateJSON(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "{}" {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}

func nullString(v string) sql.NullString {
	if v == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: v, Valid: true}
}

func nullInt64(v *int64) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *v, Valid: true}
}

// buildChannelWhere builds the WHERE clause for channel list queries.
// Default filter: status = 1 (exclude soft-deleted records).
func buildChannelWhere(p ListParams) (string, []any) {
	var conditions []string
	var args []any

	if p.Status != nil {
		conditions = append(conditions, "status = ?")
		args = append(args, *p.Status)
	} else if !p.AllStatus {
		conditions = append(conditions, "status = 1")
	}

	if p.Search != "" {
		like := "%" + p.Search + "%"
		conditions = append(conditions, "(channel_name LIKE ? OR description LIKE ? OR url LIKE ? OR param LIKE ?)")
		args = append(args, like, like, like, like)
	}

	if len(conditions) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

// buildProviderWhere builds the WHERE clause for provider list queries.
// Default filter: status = 1.
func buildProviderWhere(p ListParams) (string, []any) {
	var conditions []string
	var args []any

	if p.Status != nil {
		conditions = append(conditions, "status = ?")
		args = append(args, *p.Status)
	} else if !p.AllStatus {
		conditions = append(conditions, "status = 1")
	}

	if p.ChannelID != nil {
		conditions = append(conditions, "channel_id = ?")
		args = append(args, *p.ChannelID)
	}
	if p.Search != "" {
		like := "%" + p.Search + "%"
		conditions = append(conditions, "(provider_name LIKE ? OR description LIKE ? OR base_url LIKE ? OR param LIKE ?)")
		args = append(args, like, like, like, like)
	}
	if p.BaseURL != "" {
		conditions = append(conditions, "base_url LIKE ?")
		args = append(args, "%"+p.BaseURL+"%")
	}

	if len(conditions) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

// authFileCredentialSQLCondition matches auth-file style credentials used by the UI.
const authFileCredentialSQLCondition = `(
	auth_type > 1
	OR (
		json_valid(auth_info) AND json_type(auth_info) = 'object'
		AND (
			nullif(trim(coalesce(json_extract(auth_info, '$.file_name'), '')), '') IS NOT NULL
			OR lower(coalesce(json_extract(auth_info, '$.credential_type'), '')) IN ('oauth2', 'oidc', 'service_account')
		)
	)
)`

// buildAuthWhere builds the WHERE clause for auth/key list queries.
// No default status filter for auth rows (unlike channels/providers).
func buildAuthWhere(p ListParams) (string, []any) {
	var conditions []string
	var args []any

	if len(p.ProviderIDs) > 0 {
		placeholders := make([]string, 0, len(p.ProviderIDs))
		for _, id := range p.ProviderIDs {
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		conditions = append(conditions, "provider_id IN ("+strings.Join(placeholders, ",")+")")
	} else if p.ProviderID != nil {
		conditions = append(conditions, "provider_id = ?")
		args = append(args, *p.ProviderID)
	}
	if p.Status != nil {
		conditions = append(conditions, "status = ?")
		args = append(args, *p.Status)
	} else {
		switch p.StatusDomain {
		case "valid":
			conditions = append(conditions, "status > 0")
		case "unknown":
			conditions = append(conditions, "status = 0")
		case "invalid":
			conditions = append(conditions, "status < 0")
		case "expired":
			conditions = append(conditions, "status < 0 AND status != -2")
		case "disabled":
			conditions = append(conditions, "status = -2")
		}
	}
	if p.Priority != nil {
		conditions = append(conditions, "priority = ?")
		args = append(args, *p.Priority)
	}
	// api_type is stored in versioned auth_info JSON; legacy integer text remains readable.
	if p.APIType != nil && *p.APIType > 1 {
		conditions = append(conditions, `CAST(CASE WHEN json_valid(auth_info) AND json_type(auth_info) = 'object' THEN json_extract(auth_info, '$.api_type') ELSE auth_info END AS INTEGER) % ? = 0`)
		args = append(args, *p.APIType)
	}
	// credential_kind mirrors frontend isAuthFileCredential():
	// file_name present, oauth/oidc/service_account credential_type, or auth_type > 1.
	switch strings.TrimSpace(p.CredentialKind) {
	case "auth_file":
		conditions = append(conditions, authFileCredentialSQLCondition)
	case "api_key":
		conditions = append(conditions, "NOT ("+authFileCredentialSQLCondition+")")
	}
	if p.Search != "" {
		like := "%" + p.Search + "%"
		conditions = append(conditions, "(auth_index LIKE ? OR auth_value LIKE ? OR content LIKE ? OR remark LIKE ? OR param LIKE ? OR auth_info LIKE ?)")
		args = append(args, like, like, like, like, like, like)
	}

	if len(conditions) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

func buildProxyWhere(p ListParams) (string, []any) {
	var conditions []string
	var args []any
	if p.Status != nil {
		conditions = append(conditions, "status = ?")
		args = append(args, *p.Status)
	}
	if p.ProxyType != nil {
		conditions = append(conditions, "proxy_type = ?")
		args = append(args, *p.ProxyType)
	}
	for _, term := range strings.Fields(p.Search) {
		like := "%" + escapeLikePattern(term) + "%"
		conditions = append(conditions, `(proxy_index LIKE ? ESCAPE '\' OR proxy_value LIKE ? ESCAPE '\' OR proxy_info LIKE ? ESCAPE '\' OR content LIKE ? ESCAPE '\' OR remark LIKE ? ESCAPE '\' OR param LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like, like, like, like)
	}
	if len(conditions) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

func escapeLikePattern(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	return strings.ReplaceAll(value, `_`, `\_`)
}

type authScanner interface {
	Scan(dest ...any) error
}

func scanAuthDetail(row authScanner) (APIKey, error) {
	var k APIKey
	var content, remark, probePolicy sql.NullString
	var providerID, ownerID, expiresAtMS sql.NullInt64
	if err := row.Scan(
		&k.ID, &k.AuthIndex, &k.AuthType, &k.AuthValue, &k.AuthInfo, &content, &k.Status, &k.Priority, &expiresAtMS, &probePolicy, &k.Param,
		&providerID, &ownerID, &k.CreateAt, &k.UpdateAt, &remark,
	); err != nil {
		return APIKey{}, err
	}
	k.Content = content.String
	k.Remark = remark.String
	k.ProbePolicy = defaultJSON(probePolicy.String)
	if expiresAtMS.Valid {
		value := expiresAtMS.Int64
		k.ExpiresAtMS = &value
	}
	if providerID.Valid {
		v := providerID.Int64
		k.ProviderID = &v
	}
	if ownerID.Valid {
		v := ownerID.Int64
		k.OwnerID = &v
	}
	hydrateAuthCompat(&k)
	return k, nil
}

func scanProxyDetail(row authScanner) (ProxyDetail, error) {
	var p ProxyDetail
	var content, remark sql.NullString
	var ownerID sql.NullInt64
	if err := row.Scan(
		&p.ID, &p.ProxyIndex, &p.ProxyType, &p.ProxyValue, &p.ProxyInfo, &content, &p.Status, &p.Priority, &p.Param,
		&ownerID, &p.CreateAt, &p.UpdateAt, &remark,
	); err != nil {
		return ProxyDetail{}, err
	}
	p.Content = content.String
	p.Remark = remark.String
	if ownerID.Valid {
		v := ownerID.Int64
		p.OwnerID = &v
	}
	return p, nil
}

// resolveProviderIDFromAuthInfo fills ProviderID when the payload omits it and
// auth_info contains a base_url that matches an existing cpa_provider_info row.
// Matching uses normalizeBaseURL (trim, scheme, strip common API path suffixes).
// No match leaves ProviderID unchanged; lookup failures are ignored so key writes
// still succeed without a provider binding.
func (s *CharitableStore) resolveProviderIDFromAuthInfo(ctx context.Context, k *APIKey) {
	if k == nil || (k.ProviderID != nil && *k.ProviderID > 0) {
		return
	}
	baseURL := extractBaseURLFromAuthInfo(k.AuthInfo)
	if baseURL == "" {
		return
	}
	pv, err := s.findProviderByBaseURL(ctx, baseURL, 0)
	if err != nil || pv == nil || pv.ProviderID <= 0 {
		return
	}
	id := pv.ProviderID
	k.ProviderID = &id
}

func extractBaseURLFromAuthInfo(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(trimmed), &metadata); err != nil || metadata == nil {
		return ""
	}
	for _, key := range []string{"base_url", "baseUrl", "baseURL"} {
		if value, ok := metadata[key]; ok {
			if text, ok := value.(string); ok {
				if normalized := normalizeBaseURL(text); normalized != "" {
					return normalized
				}
			}
		}
	}
	return ""
}

func normalizeAuthDetail(k *APIKey) error {
	if k.AuthType == 0 {
		k.AuthType = 1
	}
	if k.AuthType < 1 || k.AuthType > 5 {
		return errors.New("unsupported_auth_type")
	}
	// Accept legacy payload fields.
	if strings.TrimSpace(k.AuthValue) == "" && strings.TrimSpace(k.APIKey) != "" {
		k.AuthValue = k.APIKey
	}
	info, err := normalizeAuthInfo(k.AuthInfo, k.AuthType, k.APIType)
	if err != nil {
		return errors.New("invalid_auth_info")
	}
	k.AuthInfo = info
	if k.AuthType > 1 && strings.TrimSpace(k.AuthValue) != "" {
		var structured any
		if json.Unmarshal([]byte(k.AuthValue), &structured) != nil || structured == nil {
			return errors.New("invalid_auth_value_json")
		}
	}
	k.AuthIndex = strings.TrimSpace(k.AuthIndex)
	if k.AuthIndex == "" {
		index, err := BuildAuthIndex(k.AuthValue, k.Content)
		if err != nil {
			return err
		}
		k.AuthIndex = index
	}
	k.ProbePolicy = defaultJSON(k.ProbePolicy)
	hydrateAuthCompat(k)
	return nil
}

func normalizeProxyDetail(p *ProxyDetail) error {
	p.ProxyValue = strings.TrimSpace(p.ProxyValue)
	p.ProxyInfo = strings.TrimSpace(p.ProxyInfo)
	p.Content = strings.TrimSpace(p.Content)
	p.Remark = strings.TrimSpace(p.Remark)
	p.ProxyIndex = strings.TrimSpace(p.ProxyIndex)
	if p.ProxyIndex == "" && p.ProxyValue == "" && p.Content == "" {
		return errors.New("proxy_value_required")
	}
	// Unknown is the automatic mode; resolve it from the URI before persistence.
	if p.ProxyType <= 0 || p.ProxyType == ProxyTypeUnknown {
		p.ProxyType = DetectProxyType(p.ProxyValue)
	}
	if p.ProxyType <= 0 {
		p.ProxyType = ProxyTypeUnknown
	}
	if p.ProxyInfo == "" {
		p.ProxyInfo = `{"privacy":"public"}`
	}
	if p.ProxyIndex == "" {
		index, err := BuildProxyIndex(p.ProxyValue, p.Content)
		if err != nil {
			return err
		}
		p.ProxyIndex = index
	}
	return nil
}

func hydrateAuthCompat(k *APIKey) {
	if k.AuthType == 1 {
		k.APIKey = k.AuthValue
	}
	if info, err := parseAuthInfo(k.AuthInfo); err == nil {
		k.APIType = info.APIType
	}
}

type authInfoDocument struct {
	SchemaVersion  int      `json:"schema_version"`
	CredentialType string   `json:"credential_type"`
	APIType        int      `json:"api_type"`
	Protocols      []string `json:"protocols"`
}

func parseAuthInfo(raw string) (authInfoDocument, error) {
	var info authInfoDocument
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &info); err == nil && info.CredentialType != "" {
		if info.APIType < 1 {
			info.APIType = 1
		}
		return info, nil
	}
	legacy, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return authInfoDocument{}, err
	}
	return authInfoDocument{SchemaVersion: 1, CredentialType: "api_key", APIType: legacy}, nil
}

func normalizeAuthInfo(raw string, authType int, compatibilityAPIType int) (string, error) {
	metadata := map[string]any{}
	trimmed := strings.TrimSpace(raw)
	if trimmed != "" {
		if err := json.Unmarshal([]byte(trimmed), &metadata); err != nil || metadata == nil {
			legacy, legacyErr := strconv.Atoi(trimmed)
			if legacyErr != nil {
				return "", errors.New("invalid_auth_info")
			}
			metadata["api_type"] = legacy
		}
	}
	apiType := compatibilityAPIType
	if value, ok := metadata["api_type"].(float64); ok && int(value) > 0 {
		apiType = int(value)
	}
	if apiType < 1 {
		apiType = 1
	}
	metadata["schema_version"] = 1
	metadata["credential_type"] = authCredentialTypeName(authType)
	metadata["api_type"] = apiType
	metadata["protocols"] = protocolNames(apiType)
	sanitizeAuthInfoMetadata(metadata)
	encoded, err := json.Marshal(metadata)
	return string(encoded), err
}

func sanitizeAuthInfoMetadata(value any) {
	sensitive := map[string]struct{}{
		"api_key": {}, "apikey": {}, "access_token": {}, "accesstoken": {},
		"refresh_token": {}, "refreshtoken": {}, "id_token": {}, "idtoken": {},
		"session_token": {}, "sessiontoken": {}, "private_key": {}, "privatekey": {},
		"authorization": {}, "cookie": {}, "cookies": {},
	}
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case map[string]any:
			for key, item := range typed {
				if _, blocked := sensitive[strings.ToLower(key)]; blocked {
					delete(typed, key)
					continue
				}
				walk(item)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		}
	}
	walk(value)
}

func authCredentialTypeName(authType int) string {
	switch authType {
	case 2:
		return "service_account"
	case 3:
		return "oauth2"
	case 4:
		return "oidc"
	case 5:
		return "api_key_set"
	default:
		return "api_key"
	}
}

func protocolNames(apiType int) []string {
	protocols := make([]string, 0, 4)
	for _, item := range []struct {
		prime int
		name  string
	}{{2, "openai"}, {3, "anthropic"}, {5, "gemini"}, {7, "openai_responses"}} {
		if apiType > 1 && apiType%item.prime == 0 {
			protocols = append(protocols, item.name)
		}
	}
	return protocols
}

// BuildAuthIndex hashes auth_value first; falls back to content when auth_value is empty.
func BuildAuthIndex(authValue, content string) (string, error) {
	source := strings.TrimSpace(authValue)
	if source == "" {
		source = strings.TrimSpace(content)
	}
	if source == "" {
		return "", errors.New("auth_index_source_required")
	}
	sum := md5.Sum([]byte(source))
	return hex.EncodeToString(sum[:]), nil
}

// ── Service-provider sync ──────────────────────────────────────────────────────

type SyncModel struct {
	Name  string `json:"name"`
	Alias string `json:"alias,omitempty"`
}

type SyncEntry struct {
	BaseURL      string      `json:"base_url"`
	APIKey       string      `json:"api_key"`
	Protocols    []string    `json:"protocols,omitempty"`
	ProviderName string      `json:"provider_name,omitempty"`
	Models       []SyncModel `json:"models,omitempty"`
	TestModel    string      `json:"test_model,omitempty"`
}

type SyncResult struct {
	Synced      int `json:"synced"`
	UpdatedKeys int `json:"updated_keys,omitempty"`
	Skipped     int `json:"skipped"`
	Total       int `json:"total"`
	// Updated tracks how many existing providers had their model list refreshed.
	Updated int `json:"updated,omitempty"`
}

func (s *CharitableStore) SyncServiceProvidersToKeys(ctx context.Context, entries []SyncEntry, updateModels bool) (SyncResult, error) {
	var result SyncResult
	result.Total = len(entries)

	// Ensure "localhost" channel exists.
	localhostCh, err := s.ensureLocalhostChannel(ctx)
	if err != nil {
		return result, err
	}

	// Group models by base URL so multiple keys for the same provider share one model list.
	modelsByBase := map[string][]SyncModel{}
	namesByBase := map[string]string{}
	testModelByBase := map[string]string{}
	for _, entry := range entries {
		base := normalizeBaseURL(entry.BaseURL)
		if base == "" {
			continue
		}
		if name := strings.TrimSpace(entry.ProviderName); name != "" {
			namesByBase[base] = name
		}
		if testModel := strings.TrimSpace(entry.TestModel); testModel != "" {
			testModelByBase[base] = testModel
		}
		if len(entry.Models) > 0 {
			modelsByBase[base] = mergeSyncModels(modelsByBase[base], entry.Models)
		}
	}

	for _, entry := range entries {
		base := normalizeBaseURL(entry.BaseURL)
		apiKey := strings.TrimSpace(entry.APIKey)
		if base == "" || apiKey == "" {
			result.Skipped++
			continue
		}

		// Compute api_type from protocols.
		apiType := computeApiTypeFromStrings(entry.Protocols)
		if apiType == 0 {
			apiType = 2 // default openai-compatible
		}

		// Find or create provider by base_url.
		pv, err := s.findProviderByBaseURL(ctx, base, localhostCh.ChannelID)
		if err != nil {
			result.Skipped++
			continue
		}

		models := modelsByBase[base]
		if models == nil {
			models = normalizeSyncModels(entry.Models)
		}
		testModel := testModelByBase[base]
		if testModel == "" {
			testModel = strings.TrimSpace(entry.TestModel)
		}
		providerName := namesByBase[base]
		if providerName == "" {
			providerName = strings.TrimSpace(entry.ProviderName)
		}
		if providerName == "" {
			providerName = hostLabel(base)
		}

		if pv == nil {
			pv = &Provider{
				ProviderName: providerName,
				ChannelID:    &localhostCh.ChannelID,
				Status:       1,
				BaseURL:      base,
				Param:        buildProviderParam(models, testModel),
			}
			if err := s.CreateProviderWithStatus(ctx, pv); err != nil {
				result.Skipped++
				continue
			}
		} else {
			// Always keep models available for probe features when the source has them.
			// updateModels=true forces overwrite; otherwise only fill empty model lists.
			changed, err := s.applyProviderModels(ctx, pv, providerName, models, testModel, updateModels)
			if err != nil {
				result.Skipped++
				continue
			}
			if changed {
				result.Updated++
			}
		}

		// Upsert key by its deterministic auth_index. CPA is the source of truth
		// for this reverse-sync operation, so duplicate credentials are overwritten.
		pvID := pv.ProviderID
		key := APIKey{
			AuthValue:  apiKey,
			AuthType:   1,
			APIType:    apiType,
			Status:     1,
			Priority:   0,
			Param:      "{}",
			ProviderID: &pvID,
		}
		if err := normalizeAuthDetail(&key); err != nil {
			result.Skipped++
			continue
		}
		var existingID int64
		err = s.db.QueryRowContext(ctx, "SELECT id FROM cpa_auth_detail WHERE auth_index=?", key.AuthIndex).Scan(&existingID)
		if err == nil {
			if err := s.UpdateKey(ctx, existingID, &key); err != nil {
				result.Skipped++
				continue
			}
			result.UpdatedKeys++
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			result.Skipped++
			continue
		}
		if err := s.CreateKey(ctx, &key); err != nil {
			result.Skipped++
			continue
		}
		result.Synced++
	}

	return result, nil
}

func buildProviderParam(models []SyncModel, testModel string) string {
	payload := map[string]any{}
	normalized := normalizeSyncModels(models)
	if len(normalized) > 0 {
		items := make([]map[string]string, 0, len(normalized))
		for _, model := range normalized {
			item := map[string]string{"name": model.Name}
			if model.Alias != "" {
				item["alias"] = model.Alias
			} else {
				item["alias"] = model.Name
			}
			items = append(items, item)
		}
		payload["models"] = items
	}
	if testModel = strings.TrimSpace(testModel); testModel != "" {
		payload["test_model"] = testModel
	}
	if len(payload) == 0 {
		return "{}"
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func normalizeSyncModels(models []SyncModel) []SyncModel {
	if len(models) == 0 {
		return nil
	}
	out := make([]SyncModel, 0, len(models))
	seen := map[string]bool{}
	for _, model := range models {
		name := strings.TrimSpace(model.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		alias := strings.TrimSpace(model.Alias)
		if alias == "" {
			alias = name
		}
		out = append(out, SyncModel{Name: name, Alias: alias})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func mergeSyncModels(existing, incoming []SyncModel) []SyncModel {
	return normalizeSyncModels(append(append([]SyncModel{}, existing...), incoming...))
}

func providerHasModels(param string) bool {
	obj := parseJSON(param)
	raw, ok := obj["models"]
	if !ok || raw == nil {
		return false
	}
	switch v := raw.(type) {
	case []any:
		return len(v) > 0
	case []map[string]any:
		return len(v) > 0
	default:
		return false
	}
}

func (s *CharitableStore) applyProviderModels(
	ctx context.Context,
	pv *Provider,
	providerName string,
	models []SyncModel,
	testModel string,
	force bool,
) (bool, error) {
	if pv == nil {
		return false, nil
	}
	normalized := normalizeSyncModels(models)
	testModel = strings.TrimSpace(testModel)
	if len(normalized) == 0 && testModel == "" && strings.TrimSpace(providerName) == "" {
		return false, nil
	}

	current := parseJSON(pv.Param)
	changed := false

	// Provider name can be refreshed when empty or still just the host label.
	if name := strings.TrimSpace(providerName); name != "" && name != pv.ProviderName {
		// Prefer a more descriptive source name over auto-generated host labels.
		if strings.TrimSpace(pv.ProviderName) == "" || pv.ProviderName == hostLabel(pv.BaseURL) {
			pv.ProviderName = name
			changed = true
		}
	}

	if len(normalized) > 0 && (force || !providerHasModels(pv.Param)) {
		items := make([]any, 0, len(normalized))
		for _, model := range normalized {
			items = append(items, map[string]any{
				"name":  model.Name,
				"alias": model.Alias,
			})
		}
		current["models"] = items
		changed = true
	}
	if testModel != "" {
		if existing, _ := current["test_model"].(string); force || strings.TrimSpace(existing) == "" {
			if strings.TrimSpace(existing) != testModel {
				current["test_model"] = testModel
				changed = true
			}
		}
	}
	if !changed {
		return false, nil
	}

	raw, err := json.Marshal(current)
	if err != nil {
		return false, err
	}
	pv.Param = string(raw)
	if err := s.UpdateProvider(ctx, pv.ProviderID, pv); err != nil {
		return false, err
	}
	return true, nil
}

func (s *CharitableStore) ensureLocalhostChannel(ctx context.Context) (*Channel, error) {
	// Try to find existing "localhost" channel.
	list, err := s.ListChannels(ctx, ListParams{Page: 1, PageSize: 10, Search: "localhost"})
	if err != nil {
		return nil, err
	}
	for i := range list.Items {
		if list.Items[i].ChannelName == "localhost" && list.Items[i].Status >= 0 {
			return &list.Items[i], nil
		}
	}
	// Create it.
	ch := &Channel{
		ChannelName: "localhost",
		Status:      1,
		Param:       "{}",
	}
	if err := s.CreateChannelWithStatus(ctx, ch); err != nil {
		return nil, err
	}
	return ch, nil
}

func computeApiTypeFromStrings(protocols []string) int {
	if len(protocols) == 0 {
		return 0
	}
	primes := map[string]int{
		"openai": 2, "anthropic": 3, "gemini": 5, "openai_responses": 7,
	}
	product := 1
	seen := map[string]bool{}
	for _, p := range protocols {
		p = strings.ToLower(strings.TrimSpace(p))
		if seen[p] {
			continue
		}
		seen[p] = true
		if v, ok := primes[p]; ok {
			product *= v
		}
	}
	if product == 1 {
		return 0
	}
	return product
}

func isSQLiteBusy(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "database is locked") ||
		strings.Contains(msg, "database table is locked") ||
		strings.Contains(msg, "sqlite_busy") ||
		strings.Contains(msg, "locked")
}

func isUniqueConflict(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "constraint failed")
}

var ProxyTypeLabels = map[int]string{
	1:  "unknown",
	2:  "vmess",
	3:  "vless",
	4:  "socks",
	5:  "http",
	6:  "trojan",
	7:  "shadowsocks",
	8:  "shadowsocksr",
	9:  "hysteria",
	10: "tuic",
	11: "naiveproxy",
	12: "juicity",
	13: "overtls",
	14: "wireguard",
	15: "freedom",
	16: "blackhole",
	17: "dokodemo-door",
}

const (
	ProxyTypeUnknown      = 1
	ProxyTypeVMess        = 2
	ProxyTypeVLESS        = 3
	ProxyTypeSOCKS        = 4
	ProxyTypeHTTP         = 5
	ProxyTypeTrojan       = 6
	ProxyTypeShadowsocks  = 7
	ProxyTypeShadowsocksR = 8
	ProxyTypeHysteria     = 9
	ProxyTypeTUIC         = 10
	ProxyTypeNaiveProxy   = 11
	ProxyTypeJuicity      = 12
	ProxyTypeOvertls      = 13
	ProxyTypeWireGuard    = 14
	ProxyTypeFreedom      = 15
	ProxyTypeBlackhole    = 16
	ProxyTypeDokodemoDoor = 17
)

func DetectProxyType(uri string) int {
	raw := strings.TrimSpace(uri)
	if raw == "" {
		return ProxyTypeUnknown
	}
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "vmess://"):
		return ProxyTypeVMess
	case strings.HasPrefix(lower, "vless://"):
		return ProxyTypeVLESS
	case strings.HasPrefix(lower, "socks5://"), strings.HasPrefix(lower, "socks4://"), strings.HasPrefix(lower, "socks://"):
		return ProxyTypeSOCKS
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		return ProxyTypeHTTP
	case strings.HasPrefix(lower, "trojan://"):
		return ProxyTypeTrojan
	case strings.HasPrefix(lower, "ss://"):
		return ProxyTypeShadowsocks
	case strings.HasPrefix(lower, "ssr://"):
		return ProxyTypeShadowsocksR
	case strings.HasPrefix(lower, "hysteria://"), strings.HasPrefix(lower, "hy2://"), strings.HasPrefix(lower, "hysteria2://"):
		return ProxyTypeHysteria
	case strings.HasPrefix(lower, "tuic://"):
		return ProxyTypeTUIC
	case strings.HasPrefix(lower, "naive://"), strings.HasPrefix(lower, "naive+https://"):
		return ProxyTypeNaiveProxy
	case strings.HasPrefix(lower, "juicity://"):
		return ProxyTypeJuicity
	case strings.HasPrefix(lower, "overtls://"):
		return ProxyTypeOvertls
	case strings.HasPrefix(lower, "wireguard://"), strings.HasPrefix(lower, "wg://"):
		return ProxyTypeWireGuard
	case strings.HasPrefix(lower, "freedom://"):
		return ProxyTypeFreedom
	case strings.HasPrefix(lower, "blackhole://"):
		return ProxyTypeBlackhole
	case strings.HasPrefix(lower, "dokodemo-door://"):
		return ProxyTypeDokodemoDoor
	default:
		return ProxyTypeUnknown
	}
}

func ProxyTypeLabel(proxyType int) string {
	if label, ok := ProxyTypeLabels[proxyType]; ok && label != "" {
		return label
	}
	return "unknown"
}

func BuildProxyIndex(proxyValue, content string) (string, error) {
	source := strings.TrimSpace(proxyValue)
	if source == "" {
		source = strings.TrimSpace(content)
	}
	if source == "" {
		return "", errors.New("proxy_index_source_required")
	}
	sum := md5.Sum([]byte(source))
	return hex.EncodeToString(sum[:]), nil
}
