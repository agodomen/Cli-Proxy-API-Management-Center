package service

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"
)

// SS address type constants (same encoding as SOCKS5).
const (
	ssAtypIPv4   = 0x01
	ssAtypDomain = 0x03
	ssAtypIPv6   = 0x04
)

// serveSSTCP handles a single Shadowsocks AEAD TCP connection. The first
// `saltSize` bytes of the connection are the salt, followed by the encrypted
// address header, then encrypted payload chunks.
//
// Per the Shadowsocks AEAD spec, each direction (client→server and
// server→client) uses its own nonce counter starting from zero, both derived
// from the same master key and salt.
func serveSSTCP(conn net.Conn, method, password string) error {
	defer conn.Close()

	info, err := GetCipherInfo(method)
	if err != nil {
		return err
	}

	masterKey := DeriveSSKey(password, info.KeySize)

	// Read salt.
	salt := make([]byte, info.SaltSize)
	if _, err := io.ReadFull(conn, salt); err != nil {
		return fmt.Errorf("read salt: %w", err)
	}

	// Separate sessions for each direction, both starting nonce at 0.
	decSession, err := NewSessionAEAD(info, masterKey, salt)
	if err != nil {
		return fmt.Errorf("dec session: %w", err)
	}
	encSession, err := NewSessionAEAD(info, masterKey, salt)
	if err != nil {
		return fmt.Errorf("enc session: %w", err)
	}

	reader := &connChunkReader{conn: conn}

	// Decrypt the first chunk — it contains the target address header.
	addrChunk, err := decSession.DecryptChunk(reader)
	if err != nil {
		return fmt.Errorf("decrypt addr chunk: %w", err)
	}
	if len(addrChunk) == 0 {
		return errors.New("empty address chunk")
	}

	host, port, rest, err := parseSSAddress(addrChunk)
	if err != nil {
		return err
	}

	// The rest of the first chunk may contain initial payload data.
	target := net.JoinHostPort(host, strconv.Itoa(port))
	remote, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		return fmt.Errorf("dial %s: %w", target, err)
	}
	defer remote.Close()

	if len(rest) > 0 {
		_, _ = remote.Write(rest)
	}

	// Bidirectional relay.
	done := make(chan struct{}, 2)

	// client → remote (decrypt)
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			payload, err := decSession.DecryptChunk(reader)
			if err != nil {
				return
			}
			if payload == nil {
				return // end of stream
			}
			if _, err := remote.Write(payload); err != nil {
				return
			}
		}
	}()

	// remote → client (encrypt)
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, MaxPayloadSize)
		for {
			n, err := remote.Read(buf)
			if n > 0 {
				encrypted := encSession.EncryptPayload(buf[:n])
				if _, werr := conn.Write(encrypted); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	<-done
	return nil
}

// parseSSAddress parses a Shadowsocks address header: [atyp][addr][port(2)].
// Returns host, port, remaining bytes (initial payload), and error.
func parseSSAddress(data []byte) (host string, port int, rest []byte, err error) {
	if len(data) < 1 {
		return "", 0, nil, errors.New("empty address header")
	}
	atyp := data[0]
	data = data[1:]

	switch atyp {
	case ssAtypIPv4:
		if len(data) < 4+2 {
			return "", 0, nil, errors.New("invalid IPv4 address")
		}
		host = net.IP(data[:4]).String()
		data = data[4:]
	case ssAtypDomain:
		if len(data) < 1 {
			return "", 0, nil, errors.New("invalid domain length")
		}
		domainLen := int(data[0])
		data = data[1:]
		if len(data) < domainLen+2 {
			return "", 0, nil, errors.New("invalid domain address")
		}
		host = string(data[:domainLen])
		data = data[domainLen:]
	case ssAtypIPv6:
		if len(data) < 16+2 {
			return "", 0, nil, errors.New("invalid IPv6 address")
		}
		host = net.IP(data[:16]).String()
		data = data[16:]
	default:
		return "", 0, nil, fmt.Errorf("unsupported address type: %d", atyp)
	}

	if len(data) < 2 {
		return "", 0, nil, errors.New("missing port")
	}
	port = int(binary.BigEndian.Uint16(data[:2]))
	rest = data[2:]
	return host, port, rest, nil
}

// connChunkReader adapts a net.Conn to the chunkReader interface.
type connChunkReader struct {
	conn net.Conn
}

func (r *connChunkReader) ReadN(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(r.conn, buf); err != nil {
		return nil, err
	}
	return buf, nil
}
