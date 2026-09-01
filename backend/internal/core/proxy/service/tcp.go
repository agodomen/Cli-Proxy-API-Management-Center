package service

import (
	"bufio"
	"context"
	"io"
	"log"
	"net"
	"time"
)

// serveTCP runs the TCP accept loop. When encryption is "none", it sniffs the
// first byte to dispatch between SOCKS5 and HTTP proxy. When a Shadowsocks
// AEAD cipher is configured, all connections are handled as SS TCP relay.
func (s *Service) serveTCP(ctx context.Context, ln net.Listener, encryption, password string) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
			}
			s.mu.Lock()
			running := s.running
			s.mu.Unlock()
			if !running {
				return
			}
			log.Printf("proxy-service: tcp accept error: %v", err)
			continue
		}

		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			if encryption != "" && encryption != EncryptionNone {
				// Shadowsocks AEAD TCP relay.
				if err := serveSSTCP(conn, encryption, password); err != nil {
					log.Printf("proxy-service: ss tcp: %v", err)
				}
				return
			}
			s.handleConn(ctx, conn, password)
		}()
	}
}

// handleConn reads the first byte and dispatches to SOCKS5 or HTTP proxy.
// Ownership of conn is transferred to the protocol handler which closes it.
func (s *Service) handleConn(_ context.Context, conn net.Conn, password string) {
	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))

	buf := make([]byte, 1)
	n, err := conn.Read(buf)
	if err != nil || n == 0 {
		_ = conn.Close()
		return
	}

	_ = conn.SetReadDeadline(time.Time{})

	firstByte := buf[0]

	if firstByte == socks5Version {
		_ = serveSocks5(conn, password, firstByte)
		return
	}

	reader := bufio.NewReader(conn)
	rest, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		_ = conn.Close()
		return
	}
	firstLine := string(firstByte) + rest
	serveHTTPProxy(conn, password, firstLine, reader)
}

// serveUDP runs the UDP relay loop. When encryption is "none", it drains
// packets (no-op). When a Shadowsocks AEAD cipher is configured, it runs the
// SS UDP relay.
func (s *Service) serveUDP(ctx context.Context, conn *net.UDPConn, encryption, password string) {
	if encryption != "" && encryption != EncryptionNone {
		s.serveSSUDP(ctx, conn, encryption, password)
		return
	}
	// No encryption — drain packets (plain UDP relay not supported).
	buf := make([]byte, 65535)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
			}
			continue
		}
	}
}
