package charitable

import (
	"strings"
	"testing"
)

func TestExtractUserSampleObfuscatedSleepingFace(t *testing.T) {
	text := `https: :sleeping_face://ooi.li00.xyz/

sk-JH4EjPJcKo94bPDfJoOMs7vYTXJYY6qAVou14NJMN5iRBaou

如果用不了的话我就先撤下去`
	res := ExtractCredentialsFromText(text)
	if len(res.Items) == 0 {
		t.Fatal("no items")
	}
	found := false
	for _, item := range res.Items {
		t.Logf("item source=%s baseUrl=%q apiKey=%q", item.Source, item.BaseURL, item.APIKey)
		if strings.Contains(item.BaseURL, "https://ooi.li00.xyz") && strings.HasPrefix(item.APIKey, "sk-JH4EjPJc") {
			found = true
		}
	}
	if !found {
		t.Fatalf("failed to extract both url and key: %+v", res.Items)
	}
}
