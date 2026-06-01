package chat_completions

import (
	. "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/constant"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/interfaces"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/translator/translator"
)

func init() {
	translator.Register(
		OpenAI,
		Claude,
		ConvertOpenAIRequestToClaude,
		interfaces.TranslateResponse{
			Stream:    ConvertClaudeResponseToOpenAI,
			NonStream: ConvertClaudeResponseToOpenAINonStream,
		},
	)
}
