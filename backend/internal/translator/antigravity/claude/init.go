package claude

import (
	. "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/constant"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/interfaces"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/translator/translator"
)

func init() {
	translator.Register(
		Claude,
		Antigravity,
		ConvertClaudeRequestToAntigravity,
		interfaces.TranslateResponse{
			Stream:     ConvertAntigravityResponseToClaude,
			NonStream:  ConvertAntigravityResponseToClaudeNonStream,
			TokenCount: ClaudeTokenCount,
		},
	)
}
