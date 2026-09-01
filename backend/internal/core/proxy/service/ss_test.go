package service

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

func TestDeriveSSKey(t *testing.T) {
	key := DeriveSSKey("test", 16)
	if len(key) != 16 {
		t.Fatalf("expected 16-byte key, got %d", len(key))
	}
	key2 := DeriveSSKey("test", 16)
	if string(key) != string(key2) {
		t.Fatalf("key derivation is not deterministic")
	}
	// Different password should produce different key.
	key3 := DeriveSSKey("other", 16)
	if string(key) == string(key3) {
		t.Fatalf("different passwords should produce different keys")
	}
}

func TestSessionAEADEncryptDecrypt(t *testing.T) {
	info, err := GetCipherInfo("aes-256-gcm")
	if err != nil {
		t.Fatalf("get cipher: %v", err)
	}
	masterKey := DeriveSSKey("testpassword", info.KeySize)
	salt, _ := randomSalt(info.SaltSize)

	enc, err := NewSessionAEAD(info, masterKey, salt)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	dec, _ := NewSessionAEAD(info, masterKey, salt)

	plaintext := []byte("hello shadowsocks")
	encrypted := enc.Encrypt(plaintext)
	decrypted, err := dec.Decrypt(encrypted)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(decrypted) != string(plaintext) {
		t.Fatalf("expected %q, got %q", plaintext, decrypted)
	}
}

func TestSessionAEADPayloadChunk(t *testing.T) {
	info, _ := GetCipherInfo("chacha20-ietf-poly1305")
	masterKey := DeriveSSKey("testpw", info.KeySize)
	salt, _ := randomSalt(info.SaltSize)

	enc, _ := NewSessionAEAD(info, masterKey, salt)
	dec, _ := NewSessionAEAD(info, masterKey, salt)

	payload := []byte("this is a test payload for chunk encryption")
	encrypted := enc.EncryptPayload(payload)

	tagSize := enc.TagSize()
	expectedLen := (2 + tagSize) + (len(payload) + tagSize)
	if len(encrypted) != expectedLen {
		t.Fatalf("unexpected encrypted length: got %d, want %d", len(encrypted), expectedLen)
	}

	decrypted, err := dec.DecryptChunk(&byteSliceReader{data: encrypted})
	if err != nil {
		t.Fatalf("decrypt chunk: %v", err)
	}
	if string(decrypted) != string(payload) {
		t.Fatalf("expected %q, got %q", payload, decrypted)
	}
}

func TestSupportedSSCiphers(t *testing.T) {
	ciphers := SupportedSSCiphers()
	if len(ciphers) != 3 {
		t.Fatalf("expected 3 ciphers, got %d", len(ciphers))
	}
	for _, c := range ciphers {
		if !IsSSCipher(c) {
			t.Fatalf("cipher %s not recognized", c)
		}
	}
}

func TestConfigValidateSS(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{"valid aes-256-gcm", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "aes-256-gcm", Password: "pw"}, false},
		{"valid aes-128-gcm", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "aes-128-gcm", Password: "pw"}, false},
		{"valid chacha20", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "chacha20-ietf-poly1305", Password: "pw"}, false},
		{"ss without password", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "aes-256-gcm"}, true},
		{"unsupported cipher", Config{ListenAddr: "127.0.0.1", TCPPort: 1080, EncryptionMethod: "rc4-md5", Password: "pw"}, true},
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

func TestParseSSAddress(t *testing.T) {
	t.Run("domain", func(t *testing.T) {
		data := []byte{ssAtypDomain, 9}
		data = append(data, []byte("localhost")...)
		data = append(data, 0, 80)
		data = append(data, []byte("payload")...)
		host, port, rest, err := parseSSAddress(data)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if host != "localhost" || port != 80 || string(rest) != "payload" {
			t.Fatalf("unexpected: host=%s port=%d rest=%s", host, port, rest)
		}
	})

	t.Run("ipv4", func(t *testing.T) {
		data := []byte{ssAtypIPv4, 127, 0, 0, 1, 0x1F, 0x90}
		host, port, rest, err := parseSSAddress(data)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if host != "127.0.0.1" || port != 8080 || len(rest) != 0 {
			t.Fatalf("unexpected: host=%s port=%d rest=%v", host, port, rest)
		}
	})

	t.Run("ipv6", func(t *testing.T) {
		data := []byte{ssAtypIPv6}
		data = append(data, []byte{0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1}...)
		data = append(data, 0x1F, 0x90)
		host, port, _, err := parseSSAddress(data)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if host != "::1" || port != 8080 {
			t.Fatalf("unexpected: host=%s port=%d", host, port)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		_, _, _, err := parseSSAddress([]byte{0x99})
		if err == nil {
			t.Fatal("expected error for invalid atyp")
		}
	})
}

func TestSSTCPRelay(t *testing.T) {
	for _, method := range SupportedSSCiphers() {
		t.Run(method, func(t *testing.T) {
			testSSTCPRelayWithCipher(t, method)
		})
	}
}

func testSSTCPRelayWithCipher(t *testing.T, method string) {
	target := httptestServer(t)
	port := freePort(t)
	svc := New(Config{
		ListenAddr:       "127.0.0.1",
		TCPPort:          port,
		Password:         "testpassword",
		EncryptionMethod: method,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer svc.Stop()

	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	info, _ := GetCipherInfo(method)
	masterKey := DeriveSSKey("testpassword", info.KeySize)
	salt, _ := randomSalt(info.SaltSize)

	// Client→server session (for encrypting our request).
	encSession, _ := NewSessionAEAD(info, masterKey, salt)
	// Server→client session (for decrypting response — same key+salt, nonce from 0).
	decSession, _ := NewSessionAEAD(info, masterKey, salt)

	// Write salt.
	conn.Write(salt)

	// Build address header + HTTP request.
	host, portStr, _ := net.SplitHostPort(target[len("http://"):])
	var targetPort int
	fmt.Sscanf(portStr, "%d", &targetPort)

	ip := net.ParseIP(host)
	var addrHeader []byte
	if ip != nil {
		if v4 := ip.To4(); v4 != nil {
			addrHeader = []byte{ssAtypIPv4}
			addrHeader = append(addrHeader, v4...)
		} else {
			addrHeader = []byte{ssAtypIPv6}
			addrHeader = append(addrHeader, ip.To16()...)
		}
	} else {
		addrHeader = []byte{ssAtypDomain, byte(len(host))}
		addrHeader = append(addrHeader, []byte(host)...)
	}
	portBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(portBuf, uint16(targetPort))
	addrHeader = append(addrHeader, portBuf...)

	httpReq := "GET / HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n"
	firstChunk := append(addrHeader, []byte(httpReq)...)

	encFirst := encSession.EncryptPayload(firstChunk)
	conn.Write(encFirst)

	// Read and decrypt response.
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	reader := &connChunkReader{conn: conn}
	var response []byte
	for {
		payload, err := decSession.DecryptChunk(reader)
		if err != nil {
			break
		}
		if payload == nil {
			break
		}
		response = append(response, payload...)
		if len(response) > 0 && contains(response, "200 OK") {
			break
		}
	}
	if !contains(response, "200 OK") {
		t.Errorf("expected 200 OK in response, got: %s", string(response[:min(100, len(response))]))
	}
}

func TestSSUDPCipherRoundTrip(t *testing.T) {
	info, _ := GetCipherInfo("aes-256-gcm")
	masterKey := DeriveSSKey("testpw", info.KeySize)

	salt, _ := randomSalt(info.SaltSize)
	encSession, _ := NewSessionAEAD(info, masterKey, salt)

	plaintext := []byte{ssAtypDomain, 9, 'l', 'o', 'c', 'a', 'l', 'h', 'o', 's', 't', 0, 80, 'h', 'e', 'l', 'l', 'o'}
	ciphertext := encSession.aead.Seal(nil, encSession.nonce, plaintext, nil)

	packet := append(salt, ciphertext...)

	// Decrypt.
	recvSalt := packet[:info.SaltSize]
	recvCiphertext := packet[info.SaltSize:]
	decSession, _ := NewSessionAEAD(info, masterKey, recvSalt)
	decrypted, err := decSession.aead.Open(nil, decSession.nonce, recvCiphertext, nil)
	if err != nil {
		t.Fatalf("decrypt udp packet: %v", err)
	}
	if string(decrypted) != string(plaintext) {
		t.Fatalf("mismatch")
	}
}

// ── Helpers ──

func contains(s []byte, substr string) bool {
	return len(s) >= len(substr) && indexOf(s, []byte(substr)) >= 0
}

func indexOf(s, sub []byte) int {
	for i := 0; i <= len(s)-len(sub); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if s[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// byteSliceReader implements chunkReader for testing.
type byteSliceReader struct {
	data []byte
	pos  int
	mu   sync.Mutex
}

func (r *byteSliceReader) ReadN(n int) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pos+n > len(r.data) {
		return nil, io.EOF
	}
	buf := r.data[r.pos : r.pos+n]
	r.pos += n
	return buf, nil
}
