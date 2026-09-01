package upstreamcontract

import (
	"strings"
	"testing"

	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
	"gopkg.in/yaml.v3"
)

// configKey is one YAML key path in the engine's config.yaml that the二开 code
// reads or rewrites textually. Struct-field access is checked by the compiler;
// these are the ones that are not.
type configKey struct {
	path   []string
	caller string
}

// requiredConfigKeys covers the YAML paths written by
// internal/core/localengine/runtime.go via setNestedScalar. That helper creates
// any missing key, so an upstream rename would not error — it would silently
// write a key nobody reads, and management auth would quietly stop working.
var requiredConfigKeys = []configKey{
	{[]string{"remote-management", "secret-key"}, "internal/core/localengine/runtime.go injectManagementSecretFromEnv"},
	{[]string{"remote-management", "allow-remote"}, "internal/core/localengine/runtime.go injectManagementSecretFromEnv"},

	// Read paths that core resolves by name rather than through a typed field.
	{[]string{"proxy-url"}, "internal/core/httpapi/server.go system proxy mode"},
	{[]string{"plugins", "dir"}, "internal/core/httpapi/plugin_store.go"},
	{[]string{"plugins", "configs"}, "internal/core/httpapi/plugin_store.go"},
}

func TestUpstreamConfigKeysExist(t *testing.T) {
	// Marshal the upstream config struct so the assertion runs against real yaml
	// tags rather than a copy of them.
	data, err := yaml.Marshal(&sdkconfig.Config{})
	if err != nil {
		t.Fatalf("yaml.Marshal(sdkconfig.Config) error = %v", err)
	}

	var root yaml.Node
	if errUnmarshal := yaml.Unmarshal(data, &root); errUnmarshal != nil {
		t.Fatalf("yaml.Unmarshal error = %v", errUnmarshal)
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 {
		t.Fatal("上游 config 序列化结果不是 YAML 文档，需人工复核本测试")
	}

	for _, want := range requiredConfigKeys {
		if !nodeHasPath(root.Content[0], want.path) {
			t.Errorf("上游 config.yaml 已不存在键 %q（调用方：%s）\n顶层可用键：%s",
				strings.Join(want.path, "."), want.caller,
				strings.Join(topLevelKeys(root.Content[0]), ", "))
		}
	}
}

// nodeHasPath walks mapping keys. Zero-valued nested structs still serialize
// their keys, so presence here means the key exists in the schema.
func nodeHasPath(node *yaml.Node, path []string) bool {
	current := node
	for _, key := range path {
		if current == nil || current.Kind != yaml.MappingNode {
			return false
		}
		var next *yaml.Node
		for i := 0; i+1 < len(current.Content); i += 2 {
			if current.Content[i].Value == key {
				next = current.Content[i+1]
				break
			}
		}
		if next == nil {
			return false
		}
		current = next
	}
	return true
}

func topLevelKeys(node *yaml.Node) []string {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	out := make([]string, 0, len(node.Content)/2)
	for i := 0; i < len(node.Content); i += 2 {
		out = append(out, node.Content[i].Value)
	}
	return out
}
