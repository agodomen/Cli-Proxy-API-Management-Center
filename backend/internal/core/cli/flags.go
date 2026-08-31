package cli

import "strings"

// communityFlags is the set of command-line flags that indicate the user
// wants community CLI mode (OAuth login, TUI, Home, etc.) rather than the
// default cpamc management-center mode.
var communityFlags = map[string]bool{
	"-codex-login":            true,
	"-codex-device-login":     true,
	"-claude-login":           true,
	"-antigravity-login":      true,
	"-kimi-login":             true,
	"-xai-login":              true,
	"-no-browser":             true,
	"-oauth-callback-port":    true,
	"-vertex-import":         true,
	"-vertex-import-prefix":   true,
	"-config":                 true,
	"-password":               true,
	"-home-jwt":               true,
	"-home-disable-cluster-discovery": true,
	"-tui":                    true,
	"-standalone":              true,
	"-local-model":            true,
	// long-form equivalents
	"--codex-login":            true,
	"--codex-device-login":     true,
	"--claude-login":           true,
	"--antigravity-login":      true,
	"--kimi-login":             true,
	"--xai-login":              true,
	"--no-browser":             true,
	"--oauth-callback-port":    true,
	"--vertex-import":         true,
	"--vertex-import-prefix":   true,
	"--config":                 true,
	"--password":               true,
	"--home-jwt":               true,
	"--home-disable-cluster-discovery": true,
	"--tui":                    true,
	"--standalone":              true,
	"--local-model":            true,
}

// HasCommunityFlags reports whether args contain any flag that indicates
// the user wants community CLI mode. When true, cpamc should delegate to
// cli.Run() instead of starting the management-center server.
func HasCommunityFlags(args []string) bool {
	for _, arg := range args {
		// Extract the flag name (strip =value suffix)
		flagName := arg
		if idx := strings.IndexByte(arg, '='); idx >= 0 {
			flagName = arg[:idx]
		}
		if communityFlags[flagName] {
			return true
		}
	}
	return false
}
