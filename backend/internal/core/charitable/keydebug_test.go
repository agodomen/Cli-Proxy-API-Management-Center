package charitable

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/core/store"
)

func TestExtractCredentialsFromText(t *testing.T) {
	text := `base_url: https://api.example.com/v1
api_key: sk-test-abcdef1234567890
model: gpt-4o-mini`
	res := ExtractCredentialsFromText(text)
	if len(res.Items) == 0 {
		t.Fatal("expected items")
	}
	found := false
	for _, item := range res.Items {
		if strings.Contains(item.BaseURL, "api.example.com") && strings.HasPrefix(item.APIKey, "sk-test-") {
			found = true
		}
	}
	if !found {
		t.Fatalf("unexpected items: %+v", res.Items)
	}
}

func TestAPIKeyDebugSettingsRoundTrip(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	s, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	cs := NewCharitableStore(s.DB())
	saved, err := cs.SaveAPIKeyDebugSettings(context.Background(), APIKeyDebugSettings{
		SystemPrompt: "sys",
		ProbePrompt:  "1+1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.SystemPrompt != "sys" || saved.ProbePrompt != "1+1" {
		t.Fatalf("%+v", saved)
	}
	loaded, err := cs.GetAPIKeyDebugSettings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if loaded.SystemPrompt != "sys" {
		t.Fatalf("%+v", loaded)
	}
}

func TestSaveExtractedCredentialCreatesLocalhost(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	s, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	cs := NewCharitableStore(s.DB())
	res, err := cs.SaveExtractedCredential(context.Background(), SaveCredentialRequest{
		BaseURL: "https://demo.example.com/v1",
		APIKey:  "sk-demo-1234567890",
		Model:   "gpt-test",
		APIType: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Channel.ChannelName != "localhost" {
		t.Fatalf("channel=%s", res.Channel.ChannelName)
	}
	if !res.Created.Channel || !res.Created.Provider || !res.Created.Key {
		t.Fatalf("created=%+v", res.Created)
	}
}

func TestExtractObfuscatedURLWithEmojiNoise(t *testing.T) {
	text := `https: :sleeping_face://ooi.li00.xyz/

sk-JH4EjPJcKo94bPDfJoOMs7vYTXJYY6qAVou14NJMN5iRBaou

如果用不了的话我就先撤下去`
	res := ExtractCredentialsFromText(text)
	if len(res.Items) == 0 {
		t.Fatal("expected items")
	}
	foundURL, foundKey := false, false
	for _, item := range res.Items {
		if strings.Contains(item.BaseURL, "ooi.li00.xyz") {
			foundURL = true
		}
		if strings.HasPrefix(item.APIKey, "sk-JH4EjPJc") {
			foundKey = true
		}
	}
	if !foundURL || !foundKey {
		t.Fatalf("url=%v key=%v items=%+v", foundURL, foundKey, res.Items)
	}
}

func TestDeobfuscateURLLine(t *testing.T) {
	got := deobfuscateURLLine("https: 😴://ooi.li00.xyz/")
	if !strings.Contains(got, "https://ooi.li00.xyz") {
		t.Fatalf("got %q", got)
	}
}
