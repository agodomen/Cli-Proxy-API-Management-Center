package charitable

import "testing"

func TestMergeParams(t *testing.T) {
	tests := []struct {
		name     string
		channel  string
		provider string
		key      string
		want     map[string]any
	}{
		{
			name:     "all three levels",
			channel:  `{"a":"1","b":"2"}`,
			provider: `{"b":"3","c":"4"}`,
			key:      `{"c":"5","d":"6"}`,
			want: map[string]any{
				"a": "1", "b": "3", "c": "5", "d": "6",
			},
		},
		{
			name:     "empty channel and provider",
			channel:  "",
			provider: "",
			key:      `{"x":"1"}`,
			want:     map[string]any{"x": "1"},
		},
		{
			name:     "all empty",
			channel:  "",
			provider: "",
			key:      "",
			want:     map[string]any{},
		},
		{
			name:     "invalid JSON falls back to empty map",
			channel:  "not-json",
			provider: `{}`,
			key:      `{"valid":"yes"}`,
			want:     map[string]any{"valid": "yes"},
		},
		{
			name:     "key overrides channel and provider",
			channel:  `{"shared":"channel"}`,
			provider: `{"shared":"provider"}`,
			key:      `{"shared":"key"}`,
			want:     map[string]any{"shared": "key"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result, err := MergeParams(tc.channel, tc.provider, tc.key)
			if err != nil {
				t.Fatalf("merge error: %v", err)
			}
			if len(result) != len(tc.want) {
				t.Fatalf("merged len = %d, want %d, merged=%#v", len(result), len(tc.want), result)
			}
			for k, v := range tc.want {
				if result[k] != v {
					t.Fatalf("result[%q] = %v, want %v", k, result[k], v)
				}
			}
		})
	}
}

func TestParseJSON(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"", 0},
		{"{}", 0},
		{`{"a":1}`, 1},
		{"invalid", 0},
		{`  {"spaces":true}  `, 1},
	}

	for _, tc := range tests {
		m := parseJSON(tc.input)
		if len(m) != tc.want {
			t.Fatalf("parseJSON(%q) len = %d, want %d", tc.input, len(m), tc.want)
		}
	}
}

func TestSupportsProtocol(t *testing.T) {
	tests := []struct {
		apiType  int
		protocol int
		want     bool
	}{
		{6, 2, true},  // 6 % 2 == 0
		{6, 3, true},  // 6 % 3 == 0
		{7, 2, false}, // 7 % 2 != 0
		{0, 2, false}, // apiType <= 0
		{6, 0, false}, // protocol <= 0
	}

	for _, tc := range tests {
		got := SupportsProtocol(tc.apiType, tc.protocol)
		if got != tc.want {
			t.Fatalf("SupportsProtocol(%d, %d) = %v, want %v", tc.apiType, tc.protocol, got, tc.want)
		}
	}
}
