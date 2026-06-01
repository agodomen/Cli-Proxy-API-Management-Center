package claude

import (
	. "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/constant"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/interfaces"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/translator/translator"
)

func init() {
	translator.Register(
		Claude,
		Interactions,
		ConvertClaudeRequestToInteractions,
		interfaces.TranslateResponse{
			Stream:    ConvertInteractionsResponseToClaude,
			NonStream: ConvertInteractionsResponseToClaudeNonStream,
		},
	)
}
