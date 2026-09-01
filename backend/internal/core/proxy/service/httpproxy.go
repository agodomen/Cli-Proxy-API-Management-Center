package service

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// serveHTTPProxy handles an HTTP proxy request (either a CONNECT tunnel or a
// plain HTTP/HTTPS forward request).
func serveHTTPProxy(conn net.Conn, password string, firstLine string, reader *bufio.Reader) {
	defer conn.Close()

	// Parse the request line: METHOD URI HTTP/1.1
	parts := strings.SplitN(firstLine, " ", 3)
	if len(parts) < 2 {
		return
	}
	method := parts[0]
	uri := parts[1]

	// Read headers.
	headers := readHeaders(reader)

	// Auth check.
	if password != "" {
		if !checkProxyAuth(headers, password) {
			conn.Write([]byte("HTTP/1.1 407 Proxy Authentication Required\r\n"))
			conn.Write([]byte("Proxy-Authenticate: Basic realm=\"proxy\"\r\n"))
			conn.Write([]byte("Content-Length: 0\r\n\r\n"))
			return
		}
	}

	switch method {
	case http.MethodConnect:
		handleHTTPConnect(conn, uri)
	default:
		handleHTTPForward(conn, reader, method, uri, headers)
	}
}

// readHeaders reads all header lines until an empty line, returning them as
// a slice of raw "Key: Value" strings.
func readHeaders(reader *bufio.Reader) []string {
	var headers []string
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return headers
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			break
		}
		headers = append(headers, trimmed)
	}
	return headers
}

// checkProxyAuth verifies the Proxy-Authorization header (Basic).
func checkProxyAuth(headers []string, password string) bool {
	for _, h := range headers {
		if strings.HasPrefix(strings.ToLower(h), "proxy-authorization:") {
			value := strings.TrimSpace(h[len("Proxy-Authorization:"):])
			if !strings.HasPrefix(strings.ToLower(value), "basic ") {
				continue
			}
			encoded := strings.TrimSpace(value[6:])
			decoded, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				continue
			}
			// Format: username:password — we only check the password part.
			cred := string(decoded)
			if idx := strings.IndexByte(cred, ':'); idx >= 0 {
				cred = cred[idx+1:]
			}
			if cred == password {
				return true
			}
		}
	}
	return false
}

// handleHTTPConnect establishes a TCP tunnel for HTTPS CONNECT requests.
func handleHTTPConnect(conn net.Conn, uri string) {
	remote, err := net.DialTimeout("tcp", uri, 10*time.Second)
	if err != nil {
		conn.Write([]byte("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
		return
	}
	defer remote.Close()

	conn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(remote, conn)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(conn, remote)
		done <- struct{}{}
	}()
	<-done
}

// handleHTTPForward forwards a plain HTTP request to the target server.
func handleHTTPForward(conn net.Conn, reader *bufio.Reader, method, uri string, headers []string) {
	// Build a forwarded request.
	req, err := http.NewRequest(method, uri, reader)
	if err != nil {
		conn.Write([]byte("HTTP/1.1 400 Bad Request\r\n\r\n"))
		return
	}
	for _, h := range headers {
		idx := strings.IndexByte(h, ':')
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(h[:idx])
		val := strings.TrimSpace(h[idx+1:])
		lk := strings.ToLower(key)
		// Drop hop-by-hop and proxy-auth headers.
		if lk == "proxy-authorization" || lk == "proxy-connection" {
			continue
		}
		req.Header.Add(key, val)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		msg := fmt.Sprintf("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n%v\n", err)
		conn.Write([]byte(msg))
		return
	}
	defer resp.Body.Close()

	resp.Write(conn)
}
