package probe

import "testing"

func TestStatusFromFailure(t *testing.T) {
	for _, test := range []struct {
		code int64
		want int
	}{
		{code: 401, want: -401},
		{code: 429, want: -429},
		{code: 500, want: -500},
		{code: 0, want: 0},
		{code: 200, want: 0},
	} {
		if got := statusFromFailure(test.code); got != test.want {
			t.Fatalf("statusFromFailure(%d)=%d, want %d", test.code, got, test.want)
		}
	}
}

func TestStatusFromSuccess(t *testing.T) {
	for _, test := range []struct {
		current int
		code    int64
		want    int
	}{
		{current: 1, code: 200, want: 200},
		{current: 0, code: 201, want: 201},
		{current: -401, code: 200, want: 200},
		{current: -1, code: 200, want: 0},
		{current: 1, code: 0, want: 1},
	} {
		if got := statusFromSuccess(test.current, test.code); got != test.want {
			t.Fatalf("statusFromSuccess(%d, %d)=%d, want %d", test.current, test.code, got, test.want)
		}
	}
}
