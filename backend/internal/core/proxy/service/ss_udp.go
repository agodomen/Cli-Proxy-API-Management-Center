package service

import (
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"sync"
	"time"
)

// ssUDPSession tracks a single client's UDP relay session.
type ssUDPSession struct {
	clientAddr *net.UDPAddr
	session    *SessionAEAD
	lastSeen   time.Time
}

// serveSSUDP runs the Shadowsocks AEAD UDP relay loop. Each incoming UDP
// packet is decrypted to extract the target address + payload, forwarded to
// the target, and the response is encrypted and sent back to the client.
//
// The SS AEAD UDP format per packet:
//   [salt][encrypted: [atyp][addr][port][payload]]
//
// Each packet is independently encrypted with its own salt and nonce counter
// starting from zero.
func (s *Service) serveSSUDP(ctx context.Context, conn *net.UDPConn, method, password string) {
	info, err := GetCipherInfo(method)
	if err != nil {
		return
	}
	masterKey := DeriveSSKey(password, info.KeySize)

	// Track active target→client mappings for relaying responses.
	var mu sync.Mutex
	sessions := make(map[string]*net.UDPConn) // target addr → target conn

	buf := make([]byte, 65535)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, clientAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
			}
			continue
		}
		if n < info.SaltSize {
			continue
		}

		salt := make([]byte, info.SaltSize)
		copy(salt, buf[:info.SaltSize])

		session, err := NewSessionAEAD(info, masterKey, salt)
		if err != nil {
			continue
		}

		// Decrypt the entire packet (after salt) as a single AEAD chunk.
		// In SS AEAD UDP, the format is: salt + AEAD(nonce=0, plaintext)
		// where plaintext = [atyp][addr][port][payload]
		// Unlike TCP, there's no length prefix — the whole remaining data
		// is one AEAD ciphertext.
		tagSize := session.TagSize()
		ciphertext := buf[info.SaltSize:n]
		if len(ciphertext) < tagSize {
			continue
		}
		plaintext, err := session.aead.Open(nil, session.nonce, ciphertext, nil)
		if err != nil {
			continue
		}

		host, port, payload, err := parseSSAddress(plaintext)
		if err != nil || port == 0 {
			continue
		}

		targetAddr := &net.UDPAddr{IP: net.ParseIP(host), Port: port}
		if targetAddr.IP == nil {
			// Resolve domain name.
			resolved, err := net.ResolveUDPAddr("udp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
			if err != nil {
				continue
			}
			targetAddr = resolved
		}

		// Forward payload to target.
		targetKey := targetAddr.String()
		mu.Lock()
		targetConn, ok := sessions[targetKey]
		if !ok {
			tc, err := net.DialUDP("udp", nil, targetAddr)
			if err != nil {
				mu.Unlock()
				continue
			}
			sessions[targetKey] = tc
			targetConn = tc

			// Start a relay goroutine for responses from this target.
			go s.relaySSUDPResponse(ctx, conn, targetConn, clientAddr, masterKey, info, targetKey, &mu, sessions)
		}
		mu.Unlock()

		_, _ = targetConn.Write(payload)
	}
}

// relaySSUDPResponse reads responses from a target UDP socket, encrypts them,
// and sends them back to the original client. Each response packet gets a
// fresh salt and nonce=0 encryption.
func (s *Service) relaySSUDPResponse(
	ctx context.Context,
	clientConn *net.UDPConn,
	targetConn *net.UDPConn,
	clientAddr *net.UDPAddr,
	masterKey []byte,
	info CipherInfo,
	targetKey string,
	mu *sync.Mutex,
	sessions map[string]*net.UDPConn,
) {
	buf := make([]byte, 65535)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_ = targetConn.SetReadDeadline(time.Now().Add(30 * time.Second))
		n, _, err := targetConn.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
			}
			if nerr, ok := err.(net.Error); ok && nerr.Timeout() {
				// Idle timeout — clean up this target session.
				mu.Lock()
				delete(sessions, targetKey)
				mu.Unlock()
				_ = targetConn.Close()
				return
			}
			continue
		}
		if n == 0 {
			continue
		}

		// Generate a fresh salt for the response.
		salt := make([]byte, info.SaltSize)
		if _, err := readRandom(salt); err != nil {
			continue
		}

		session, err := NewSessionAEAD(info, masterKey, salt)
		if err != nil {
			continue
		}

		// Build the response plaintext: [atyp][addr][port][payload]
		// Use the target's address as the response source address.
		// For simplicity, use domain type with the target host.
		respAddr := buildSSUDPResponseAddr(targetConn.RemoteAddr(), buf[:n])
		if respAddr == nil {
			continue
		}

		// Encrypt the entire response as one AEAD chunk with nonce=0.
		ciphertext := session.aead.Seal(nil, session.nonce, respAddr, nil)

		// Prepend salt.
		packet := append(salt, ciphertext...)
		_, _ = clientConn.WriteToUDP(packet, clientAddr)
	}
}

// buildSSUDPResponseAddr builds the SS address header + payload for a UDP
// response. The source address is derived from the target's remote address.
func buildSSUDPResponseAddr(remoteAddr net.Addr, payload []byte) []byte {
	host, portStr, err := net.SplitHostPort(remoteAddr.String())
	if err != nil {
		return nil
	}
	var port int
	fmt.Sscanf(portStr, "%d", &port)

	if udpAddr, ok := remoteAddr.(*net.UDPAddr); ok {
		port = udpAddr.Port
		host = udpAddr.IP.String()
	}

	ip := net.ParseIP(host)
	var addr []byte
	if ip != nil {
		if v4 := ip.To4(); v4 != nil {
			addr = []byte{ssAtypIPv4}
			addr = append(addr, v4...)
		} else {
			addr = []byte{ssAtypIPv6}
			addr = append(addr, ip.To16()...)
		}
	} else {
		addr = []byte{ssAtypDomain, byte(len(host))}
		addr = append(addr, []byte(host)...)
	}

	portBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(portBuf, uint16(port))
	addr = append(addr, portBuf...)
	addr = append(addr, payload...)
	return addr
}
