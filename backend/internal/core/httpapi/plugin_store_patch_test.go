package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	communitypluginstore "github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginstore"
)

// This file guards the behaviour added by
// backend/patches/0001-pluginstore-allow-github-signed-artifact-url.patch.
//
// The patch is the only local modification to an upstream file, so it is the
// most likely thing to be silently lost during a community sync. bin/
// check-upstream-drift.sh catches the file-level loss; these tests catch the
// behavioural loss, which is what actually breaks plugin installation.
//
// Scenario under test — the real production failure. The registry declares a
// clean artifact URL; GitHub answers with a 302 to its Release CDN, and that
// redirect target carries short-lived signature query parameters. Upstream
// re-validates every URL it follows, so without the patch the download fails at
// the redirect. Registry- and manifest-declared URLs are validated by a
// different, unpatched check and must keep rejecting such parameters.
//
// The exercised path is the real one: core's plugin store installs through
// sdk/pluginstore.
//
// Delete this file together with the patch once the fix lands upstream.

// artifactURL is what the registry declares: no sensitive query parameters.
const artifactURL = "https://downloads.example/sample-provider_0.4.0_linux_amd64.zip"

// signedCDNURL mimics a GitHub Release CDN redirect target: an allowed host
// carrying short-lived signature query parameters.
const signedCDNURL = "https://objects.githubusercontent.com/plugins/sample-provider_0.4.0_linux_amd64.zip?token=SHORT-LIVED&X-Amz-Signature=deadbeef"

// foreignSignedCDNURL carries the same parameters on a host that must keep being
// rejected, so the exemption cannot silently widen.
const foreignSignedCDNURL = "https://cdn.example/sample-provider_0.4.0_linux_amd64.zip?token=SHORT-LIVED"

const sensitiveQueryRejection = "sensitive query parameter"

func TestPluginStoreAllowsGitHubSignedArtifactRedirect(t *testing.T) {
	root, errInstall := installDirectPluginViaRedirect(t, signedCDNURL)
	if errInstall != nil {
		if strings.Contains(errInstall.Error(), sensitiveQueryRejection) {
			t.Fatalf("GitHub CDN 签名重定向被拒绝，说明 patches/0001-pluginstore-allow-github-signed-artifact-url.patch 已丢失：%v", errInstall)
		}
		t.Fatalf("InstallManifest() error = %v", errInstall)
	}
	installed := filepath.Join(root, "linux", "amd64", "sample-provider-v0.4.0.so")
	data, errRead := os.ReadFile(installed)
	if errRead != nil {
		t.Fatalf("ReadFile(%s) error = %v", installed, errRead)
	}
	if string(data) != "library-data" {
		t.Fatalf("installed payload = %q, want %q", data, "library-data")
	}
}

func TestPluginStoreStillRejectsNonGitHubSignedRedirect(t *testing.T) {
	_, errInstall := installDirectPluginViaRedirect(t, foreignSignedCDNURL)
	if errInstall == nil {
		t.Fatal("非 GitHub 主机的敏感查询参数重定向必须仍被拒绝，当前放行范围过宽")
	}
	if !strings.Contains(errInstall.Error(), sensitiveQueryRejection) {
		t.Fatalf("error = %v, want %q rejection", errInstall, sensitiveQueryRejection)
	}
}

// installDirectPluginViaRedirect drives a direct-install manifest whose clean
// artifact URL redirects to cdnURL, with every response served from memory.
func installDirectPluginViaRedirect(t *testing.T, cdnURL string) (string, error) {
	t.Helper()

	root := t.TempDir()
	archive := makePluginZip(t, "sample-provider.so", "library-data")
	checksum := sha256.Sum256(archive)
	registryURL := "https://registry.example/registry.json"
	registry := `{
		"schema_version": 2,
		"plugins": [{
			"id": "sample-provider",
			"name": "Sample Provider",
			"description": "Adds sample provider support.",
			"author": "author-name",
			"version": "0.4.0",
			"install": {
				"type": "direct",
				"artifacts": [{
					"goos": "linux",
					"goarch": "amd64",
					"url": "` + artifactURL + `",
					"sha256": "` + hex.EncodeToString(checksum[:]) + `"
				}]
			}
		}]
	}`

	client := communitypluginstore.NewClient(staticHTTPDoer{
		bodies:    map[string][]byte{registryURL: []byte(registry), cdnURL: archive},
		redirects: map[string]string{artifactURL: cdnURL},
	}, registryURL)

	_, err := client.InstallManifest(context.Background(), communitypluginstore.Manifest{
		SchemaVersion: communitypluginstore.SchemaVersionV2,
		ID:            "sample-provider",
		Version:       "0.4.0",
		SourceURL:     registryURL,
		Install:       communitypluginstore.InstallPlan{Type: communitypluginstore.InstallTypeDirect},
	}, communitypluginstore.InstallOptions{
		PluginsDir: root,
		GOOS:       "linux",
		GOARCH:     "amd64",
	})
	return root, err
}

// staticHTTPDoer serves canned redirects and bodies by exact URL and 404s
// anything else, so a test can never reach the network.
type staticHTTPDoer struct {
	bodies    map[string][]byte
	redirects map[string]string
}

func (d staticHTTPDoer) Do(req *http.Request) (*http.Response, error) {
	requested := req.URL.String()
	if location, ok := d.redirects[requested]; ok {
		header := make(http.Header)
		header.Set("Location", location)
		return &http.Response{
			StatusCode: http.StatusFound,
			Status:     "302 Found",
			Header:     header,
			Body:       io.NopCloser(bytes.NewReader(nil)),
			Request:    req,
		}, nil
	}
	body, ok := d.bodies[requested]
	if !ok {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Status:     "404 Not Found",
			Header:     make(http.Header),
			Body:       io.NopCloser(bytes.NewReader(nil)),
			Request:    req,
		}, nil
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(body)),
		Request:    req,
	}, nil
}

func makePluginZip(t *testing.T, name string, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	entry, errCreate := writer.Create(name)
	if errCreate != nil {
		t.Fatalf("zip Create() error = %v", errCreate)
	}
	if _, errWrite := entry.Write([]byte(content)); errWrite != nil {
		t.Fatalf("zip Write() error = %v", errWrite)
	}
	if errClose := writer.Close(); errClose != nil {
		t.Fatalf("zip Close() error = %v", errClose)
	}
	return buf.Bytes()
}
