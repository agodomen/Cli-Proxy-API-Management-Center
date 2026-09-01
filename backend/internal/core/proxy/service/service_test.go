package service

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return port
}

func TestConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{"valid loopback no password", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "none"}, false},
		{"valid loopback with password", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, Password: "secret", EncryptionMethod: "none"}, false},
		{"non-loopback without password", Config{ListenAddr: "0.0.0.0", TCPPort: 1080, EncryptionMethod: "none"}, true},
		{"non-loopback with password", Config{ListenAddr: "0.0.0.0", TCPPort: 1080, Password: "secret", EncryptionMethod: "none"}, false},
		{"empty listen addr", Config{ListenAddr: "", TCPPort: 1080}, true},
		{"port out of range", Config{ListenAddr: "127.0.0.1", TCPPort: 99999}, true},
		{"unsupported encryption", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "aes-256-gcm"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestUnmarshalConfig(t *testing.T) {
	t.Run("empty bytes returns default", func(t *testing.T) {
		cfg, err := UnmarshalConfig(nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cfg.ListenAddr != "127.0.0.1" {
			t.Errorf("expected default listen addr, got %s", cfg.ListenAddr)
		}
		if cfg.EncryptionMethod != "none" {
			t.Errorf("expected default encryption none, got %s", cfg.EncryptionMethod)
		}
	})

	t.Run("valid json", func(t *testing.T) {
		raw := []byte(`{"listen_addr":"0.0.0.0","tcp_port":1080,"password":"pw","encryption_method":"none","enabled":true}`)
		cfg, err := UnmarshalConfig(raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cfg.ListenAddr != "0.0.0.0" || cfg.TCPPort != 1080 || cfg.Password != "pw" || !cfg.Enabled {
			t.Errorf("unexpected config: %+v", cfg)
		}
	})
}

func TestServiceStartStop(t *testing.T) {
	port := freePort(t)
	svc := New(Config{
		ListenAddr:       "127.0.0.1",
		TCPPort:          port,
		EncryptionMethod: "none",
	})

	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}

	st := svc.Status()
	if !st.Running || !st.TCP.Running {
		t.Fatalf("expected running, got %+v", st)
	}

	// Verify the listener is actually accepting connections.
	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	_ = conn.Close()

	svc.Stop()

	st = svc.Status()
	if st.Running {
		t.Fatalf("expected not running after stop")
	}
}

func TestServiceStartTwice(t *testing.T) {
	port := freePort(t)
	svc := New(Config{ListenAddr: "127.0.0.1", TCPPort: port, EncryptionMethod: "none"})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("first start: %v", err)
	}
	// Second start should be a no-op (no error).
	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("second start: %v", err)
	}
	svc.Stop()
}

func TestServiceRestart(t *testing.T) {
	port := freePort(t)
	svc := New(Config{ListenAddr: "127.0.0.1", TCPPort: port, EncryptionMethod: "none"})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := svc.Restart(context.Background()); err != nil {
		t.Fatalf("restart: %v", err)
	}
	st := svc.Status()
	if !st.Running {
		t.Fatalf("expected running after restart")
	}
	svc.Stop()
}

func TestSOCKS5ConnectNoAuth(t *testing.T) {
	// Start a target HTTP server.
	target := httptestServer(t)
	// Start the proxy service.
	port := freePort(t)
	svc := New(Config{ListenAddr: "127.0.0.1", TCPPort: port, EncryptionMethod: "none"})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer svc.Stop()

	// Connect via SOCKS5.
	proxyURL, _ := url.Parse(fmt.Sprintf("socks5://127.0.0.1:%d", port))
	client := &http.Client{
		Transport: &http.Transport{
			Dial: func(network, addr string) (net.Conn, error) {
				return socks5Dial("127.0.0.1", port, addr)
			},
		},
	}
	_ = proxyURL // suppress unused

	resp, err := client.Get(target)
	if err != nil {
		t.Fatalf("socks5 get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestSOCKS5ConnectWithPassword(t *testing.T) {
	target := httptestServer(t)
	port := freePort(t)
	svc := New(Config{ListenAddr: "127.0.0.1", TCPPort: port, Password: "secret", EncryptionMethod: "none"})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer svc.Stop()

	// Should fail without password.
	_, err := socks5Dial("127.0.0.1", port, target)
	if err == nil {
		t.Fatalf("expected error without password")
	}

	// Should succeed with password.
	client := &http.Client{
		Transport: &http.Transport{
			Dial: func(network, addr string) (net.Conn, error) {
				return socks5DialAuth("127.0.0.1", port, "user", "secret", addr)
			},
		},
	}
	resp, err := client.Get(target)
	if err != nil {
		t.Fatalf("socks5 get with auth: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestHTTPProxyConnect(t *testing.T) {
	target := httptestServer(t)
	port := freePort(t)
	svc := New(Config{ListenAddr: "127.0.0.1", TCPPort: port, EncryptionMethod: "none"})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer svc.Stop()

	proxyURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}
	resp, err := client.Get(target)
	if err != nil {
		t.Fatalf("http proxy get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

// httptestServer starts a minimal HTTP server returning 200 OK.
func httptestServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 1024)
				c.Read(buf)
				c.Write([]byte("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"))
			}(conn)
		}
	}()
	t.Cleanup(func() { _ = ln.Close() })
	return "http://" + addr
}

// socks5Dial performs a minimal SOCKS5 CONNECT without auth.
func socks5Dial(proxyHost string, proxyPort int, target string) (net.Conn, error) {
	return socks5DialAuth(proxyHost, proxyPort, "", "", target)
}

// socks5DialAuth performs a SOCKS5 CONNECT with optional username/password.
func socks5DialAuth(proxyHost string, proxyPort int, user, pass, target string) (net.Conn, error) {
	conn, err := net.Dial("tcp", net.JoinHostPort(proxyHost, strconv.Itoa(proxyPort)))
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Auth negotiation.
	if user != "" || pass != "" {
		if _, err := conn.Write([]byte{0x05, 0x01, 0x02}); err != nil {
			conn.Close()
			return nil, err
		}
		resp := make([]byte, 2)
		if _, err := io.ReadFull(conn, resp); err != nil {
			conn.Close()
			return nil, err
		}
		if resp[1] != 0x02 {
			conn.Close()
			return nil, fmt.Errorf("auth method not accepted: %d", resp[1])
		}
		// Send credentials.
		cred := []byte{0x01, byte(len(user))}
		cred = append(cred, []byte(user)...)
		cred = append(cred, byte(len(pass)))
		cred = append(cred, []byte(pass)...)
		if _, err := conn.Write(cred); err != nil {
			conn.Close()
			return nil, err
		}
		authResp := make([]byte, 2)
		if _, err := io.ReadFull(conn, authResp); err != nil {
			conn.Close()
			return nil, err
		}
		if authResp[1] != 0x00 {
			conn.Close()
			return nil, fmt.Errorf("auth failed")
		}
	} else {
		if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
			conn.Close()
			return nil, err
		}
		resp := make([]byte, 2)
		if _, err := io.ReadFull(conn, resp); err != nil {
			conn.Close()
			return nil, err
		}
		if resp[1] != 0x00 {
			conn.Close()
			return nil, fmt.Errorf("no-auth not accepted: %d", resp[1])
		}
	}

	// Parse target host:port.
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		conn.Close()
		return nil, err
	}
	port := 0
	fmt.Sscanf(portStr, "%d", &port)

	// CONNECT request.
	req := []byte{0x05, 0x01, 0x00, 0x03, byte(len(host))}
	req = append(req, []byte(host)...)
	portBytes := []byte{byte(port >> 8), byte(port & 0xff)}
	req = append(req, portBytes...)
	if _, err := conn.Write(req); err != nil {
		conn.Close()
		return nil, err
	}

	// Read reply: VER, REP, RSV, ATYP, BND.ADDR, BND.PORT
	reply := make([]byte, 4)
	if _, err := io.ReadFull(conn, reply); err != nil {
		conn.Close()
		return nil, err
	}
	if reply[1] != 0x00 {
		conn.Close()
		return nil, fmt.Errorf("connect failed: rep=%d", reply[1])
	}

	// Read bound address.
	switch reply[3] {
	case 0x01:
		bnd := make([]byte, 4)
		if _, err := io.ReadFull(conn, bnd); err != nil {
			conn.Close()
			return nil, err
		}
	case 0x03:
		lenBuf := make([]byte, 1)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			conn.Close()
			return nil, err
		}
		bnd := make([]byte, int(lenBuf[0]))
		if _, err := io.ReadFull(conn, bnd); err != nil {
			conn.Close()
			return nil, err
		}
	case 0x04:
		bnd := make([]byte, 16)
		if _, err := io.ReadFull(conn, bnd); err != nil {
			conn.Close()
			return nil, err
		}
	}
	// Read bound port.
	bndPort := make([]byte, 2)
	if _, err := io.ReadFull(conn, bndPort); err != nil {
		conn.Close()
		return nil, err
	}

	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}
