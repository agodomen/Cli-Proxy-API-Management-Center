package localengine

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/usage"
	cliproxyusage "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/sdk/cliproxy/usage"
	"github.com/gin-gonic/gin"
)

type recordingIngestor struct {
	events []usage.Event
	ctxErr error
}

func (ingestor *recordingIngestor) IngestUsageEvents(ctx context.Context, events []usage.Event) error {
	ingestor.events = append(ingestor.events, events...)
	ingestor.ctxErr = ctx.Err()
	return nil
}

func TestUsagePluginConvertsAndIngestsRecord(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ginContext, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	request.Header.Set("X-Request-ID", "request-1")
	ginContext.Request = request
	requestCtx, cancel := context.WithCancel(context.WithValue(context.Background(), "gin", ginContext))
	cancel()

	ingestor := &recordingIngestor{}
	plugin := newUsagePlugin(ingestor)
	plugin.HandleUsage(requestCtx, cliproxyusage.Record{
		Provider:    "codex",
		Model:       "gpt-5",
		Alias:       "gpt-latest",
		APIKey:      "secret-key",
		AuthID:      "auth-1",
		AuthType:    "api_key",
		RequestedAt: time.Unix(1_700_000_000, 0),
		Latency:     250 * time.Millisecond,
		Detail: cliproxyusage.Detail{
			InputTokens:  10,
			OutputTokens: 20,
			TotalTokens:  30,
		},
	})

	if len(ingestor.events) != 1 {
		t.Fatalf("events = %d", len(ingestor.events))
	}
	if ingestor.ctxErr != nil {
		t.Fatalf("ingest context error = %v", ingestor.ctxErr)
	}
	event := ingestor.events[0]
	if event.RequestID != "request-1" || event.Method != http.MethodPost || event.Path != "/v1/chat/completions" {
		t.Fatalf("request metadata = %#v", event)
	}
	if event.Provider != "codex" || event.Model != "gpt-latest" || event.ResolvedModel != "gpt-5" {
		t.Fatalf("model metadata = %#v", event)
	}
	if event.AuthIndex != "auth-1" || event.TotalTokens != 30 || event.StatusCode != 200 {
		t.Fatalf("usage metadata = %#v", event)
	}
	if event.APIKeyHash == "" || strings.Contains(event.RawJSON, "secret-key") || !strings.Contains(event.RawJSON, `"engine":"local"`) {
		t.Fatalf("redacted raw JSON = %s", event.RawJSON)
	}
}
