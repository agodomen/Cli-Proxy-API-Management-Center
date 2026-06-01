package localengine

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/usage"
	cliproxyusage "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/sdk/cliproxy/usage"
	"github.com/gin-gonic/gin"
)

// UsageEventIngestor accepts normalized events from the embedded engine.
type UsageEventIngestor interface {
	IngestUsageEvents(ctx context.Context, events []usage.Event) error
}

type usagePlugin struct {
	ingestor UsageEventIngestor
}

func newUsagePlugin(ingestor UsageEventIngestor) *usagePlugin {
	return &usagePlugin{ingestor: ingestor}
}

func (plugin *usagePlugin) HandleUsage(ctx context.Context, record cliproxyusage.Record) {
	if plugin == nil || plugin.ingestor == nil {
		return
	}
	payload := usagePayload(ctx, record)
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("marshal local engine usage: %v", err)
		return
	}
	event, err := usage.NormalizeRaw(raw)
	if err != nil {
		log.Printf("normalize local engine usage: %v", err)
		return
	}
	ingestContext := context.Background()
	if ctx != nil {
		ingestContext = context.WithoutCancel(ctx)
	}
	if err := plugin.ingestor.IngestUsageEvents(ingestContext, []usage.Event{event}); err != nil {
		log.Printf("ingest local engine usage: %v", err)
	}
}

func usagePayload(ctx context.Context, record cliproxyusage.Record) map[string]any {
	requestedAt := record.RequestedAt
	if requestedAt.IsZero() {
		requestedAt = time.Now()
	}
	method, path, requestID := requestMetadata(ctx)
	statusCode := record.Fail.StatusCode
	if statusCode == 0 && !record.Failed {
		statusCode = 200
	}
	authIndex := strings.TrimSpace(record.AuthIndex)
	if authIndex == "" {
		authIndex = strings.TrimSpace(record.AuthID)
	}
	return map[string]any{
		"engine":                "local",
		"request_id":            requestID,
		"timestamp":             requestedAt.UTC().Format(time.RFC3339Nano),
		"provider":              record.Provider,
		"executor_type":         record.ExecutorType,
		"model":                 record.Model,
		"requested_model":       record.Alias,
		"method":                method,
		"path":                  path,
		"auth_type":             record.AuthType,
		"auth_index":            authIndex,
		"source":                record.Source,
		"api_key":               record.APIKey,
		"input_tokens":          record.Detail.InputTokens,
		"output_tokens":         record.Detail.OutputTokens,
		"reasoning_tokens":      record.Detail.ReasoningTokens,
		"cached_tokens":         record.Detail.CachedTokens,
		"cache_read_tokens":     record.Detail.CacheReadTokens,
		"cache_creation_tokens": record.Detail.CacheCreationTokens,
		"total_tokens":          record.Detail.TotalTokens,
		"latency_ms":            record.Latency.Milliseconds(),
		"ttft_ms":               record.TTFT.Milliseconds(),
		"failed":                record.Failed,
		"status_code":           statusCode,
		"error_message":         truncate(record.Fail.Body, 2048),
	}
}

func requestMetadata(ctx context.Context) (string, string, string) {
	ginContext, ok := ctx.Value("gin").(*gin.Context)
	if !ok || ginContext == nil || ginContext.Request == nil {
		return "", "", ""
	}
	request := ginContext.Request
	requestID := request.Header.Get("X-Request-ID")
	if requestID == "" {
		requestID = ginContext.Writer.Header().Get("X-Request-ID")
	}
	return request.Method, request.URL.Path, requestID
}

func truncate(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}
