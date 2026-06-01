package responses

import (
	. "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/constant"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/interfaces"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/translator/translator"
)

func init() {
	translator.Register(
		OpenaiResponse,
		OpenAI,
		ConvertOpenAIResponsesRequestToOpenAIChatCompletions,
		interfaces.TranslateResponse{
			Stream:    ConvertOpenAIChatCompletionsResponseToOpenAIResponses,
			NonStream: ConvertOpenAIChatCompletionsResponseToOpenAIResponsesNonStream,
		},
	)
}
