package proxy

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestDynamicHTTPDoerRewritesDownloadButNotAPI(t *testing.T) {
	client := NewDynamicHTTPDoer(func() Resolution {
		return Resolution{AcceleratorBase: "https://gh-proxy.example/"}
	})

	previousTransport := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(req.URL.String())),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = previousTransport })

	for _, test := range []struct {
		url  string
		want string
	}{
		{
			url:  "https://github.com/owner/repo/releases/download/v1/plugin.zip",
			want: "https://gh-proxy.example/https://github.com/owner/repo/releases/download/v1/plugin.zip",
		},
		{
			url:  "https://api.github.com/repos/owner/repo/releases/latest",
			want: "https://api.github.com/repos/owner/repo/releases/latest",
		},
	} {
		req, errRequest := http.NewRequest(http.MethodGet, test.url, nil)
		if errRequest != nil {
			t.Fatal(errRequest)
		}
		resp, errDo := client.Do(req)
		if errDo != nil {
			t.Fatal(errDo)
		}
		body, errRead := io.ReadAll(resp.Body)
		if errRead != nil {
			t.Fatal(errRead)
		}
		_ = resp.Body.Close()
		if string(body) != test.want {
			t.Fatalf("request URL = %q, want %q", body, test.want)
		}
	}
}

func TestDynamicHTTPDoerDoesNotFollowRedirects(t *testing.T) {
	redirected := false
	previousTransport := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "redirected.example" {
			redirected = true
		}
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"https://redirected.example/file.zip"}},
			Body:       io.NopCloser(strings.NewReader("")),
			Request:    req,
		}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = previousTransport })

	req, errRequest := http.NewRequest(http.MethodGet, "https://github.com/owner/repo/file.zip", nil)
	if errRequest != nil {
		t.Fatal(errRequest)
	}
	resp, errDo := NewDynamicHTTPDoer(func() Resolution { return Resolution{} }).Do(req)
	if errDo != nil {
		t.Fatal(errDo)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusFound)
	}
	if redirected {
		t.Fatal("dynamic client followed redirect instead of returning it to plugin-store validation")
	}
}
