package gemini

import (
	. "github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/constant"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/interfaces"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/translator/translator"
)

func init() {
	translator.Register(
		Gemini,
		Codex,
		ConvertGeminiRequestToCodex,
		interfaces.TranslateResponse{
			Stream:     ConvertCodexResponseToGemini,
			NonStream:  ConvertCodexResponseToGeminiNonStream,
			TokenCount: GeminiTokenCount,
		},
	)
}
