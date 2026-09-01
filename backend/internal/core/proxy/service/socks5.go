package service

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strconv"
	"time"
)

// SOCKS5 protocol constants (RFC 1928 / RFC 1929).
const (
	socks5Version             = 0x05
	socks5AuthNone            = 0x00
	socks5AuthUPwd            = 0x02
	socks5AuthNoneAcceptable  = 0xFF

	socks5AuthUPwdVersion = 0x01
	socks5AuthSuccess     = 0x00
	socks5AuthFailure     = 0x01

	socks5CmdConnect = 0x01
	socks5CmdUDP     = 0x03

	socks5AtypIPv4   = 0x01
	socks5AtypDomain = 0x03
	socks5AtypIPv6   = 0x04

	socks5RepSuccess            = 0x00
	socks5RepGeneralFailure    = 0x01
	socks5RepNotAllowed         = 0x02
	socks5RepNetworkUnreachable = 0x03
	socks5RepHostUnreachable    = 0x04
	socks5RepConnectionRefused  = 0x05
	socks5RepTTLExpired         = 0x06
	socks5RepCmdNotSupported   = 0x07
	socks5RepAddrNotSupported  = 0x08
)

// errNotSocks5 is returned by serveSocks5 when the first byte is not 0x05.
var errNotSocks5 = errors.New("not a socks5 connection")

// serveSocks5 handles a single SOCKS5 connection. It returns errNotSocks5
// when the first byte is not 0x05, allowing the caller to fall back to HTTP.
func serveSocks5(conn net.Conn, password string, firstByte byte) error {
	if firstByte != socks5Version {
		return errNotSocks5
	}
	defer conn.Close()

	// --- Authentication negotiation (RFC 1928 §3) ---
	// Client sent: VER(0x05), NMETHODS, METHODS...
	// We already consumed VER as firstByte; read NMETHODS next.
	nmBuf := [1]byte{}
	if _, err := io.ReadFull(conn, nmBuf[:]); err != nil {
		return nil
	}
	nMethods := int(nmBuf[0])
	if nMethods == 0 || nMethods > 255 {
		return nil
	}
	methods := make([]byte, nMethods)
	if _, err := io.ReadFull(conn, methods); err != nil {
		return nil
	}

	hasNone := false
	hasUPwd := false
	for _, m := range methods {
		if m == socks5AuthNone {
			hasNone = true
		}
		if m == socks5AuthUPwd {
			hasUPwd = true
		}
	}

	if password != "" {
		if !hasUPwd {
			conn.Write([]byte{socks5Version, socks5AuthNoneAcceptable})
			return nil
		}
		conn.Write([]byte{socks5Version, socks5AuthUPwd})

		// RFC 1929: VER, ULEN, UNAME, PLEN, PASSWD
		var ver [1]byte
		if _, err := io.ReadFull(conn, ver[:]); err != nil {
			return nil
		}
		if ver[0] != socks5AuthUPwdVersion {
			conn.Write([]byte{socks5AuthUPwdVersion, socks5AuthFailure})
			return nil
		}
		ulenBuf := [1]byte{}
		if _, err := io.ReadFull(conn, ulenBuf[:]); err != nil {
			return nil
		}
		if _, err := io.ReadFull(conn, make([]byte, int(ulenBuf[0]))); err != nil {
			return nil
		}
		plenBuf := [1]byte{}
		if _, err := io.ReadFull(conn, plenBuf[:]); err != nil {
			return nil
		}
		passwd := make([]byte, int(plenBuf[0]))
		if len(passwd) > 0 {
			if _, err := io.ReadFull(conn, passwd); err != nil {
				return nil
			}
		}
		if string(passwd) != password {
			conn.Write([]byte{socks5AuthUPwdVersion, socks5AuthFailure})
			return nil
		}
		conn.Write([]byte{socks5AuthUPwdVersion, socks5AuthSuccess})
	} else {
		if !hasNone {
			conn.Write([]byte{socks5Version, socks5AuthNoneAcceptable})
			return nil
		}
		conn.Write([]byte{socks5Version, socks5AuthNone})
	}

	// --- Request ---
	hdr := [4]byte{}
	if _, err := io.ReadFull(conn, hdr[:]); err != nil {
		return nil
	}
	if hdr[0] != socks5Version {
		return nil
	}

	switch hdr[1] {
	case socks5CmdConnect:
		handleSocks5Connect(conn, hdr[3])
	case socks5CmdUDP:
		writeSocks5Reply(conn, socks5RepCmdNotSupported, nil, 0)
	default:
		writeSocks5Reply(conn, socks5RepCmdNotSupported, nil, 0)
	}
	return nil
}

// handleSocks5Connect parses the destination address and tunnels traffic.
func handleSocks5Connect(conn net.Conn, atyp byte) {
	var host string

	switch atyp {
	case socks5AtypIPv4:
		buf := make([]byte, 4)
		if _, err := io.ReadFull(conn, buf); err != nil {
			return
		}
		host = net.IP(buf).String()
	case socks5AtypDomain:
		lenBuf := [1]byte{}
		if _, err := io.ReadFull(conn, lenBuf[:]); err != nil {
			return
		}
		domain := make([]byte, int(lenBuf[0]))
		if _, err := io.ReadFull(conn, domain); err != nil {
			return
		}
		host = string(domain)
	case socks5AtypIPv6:
		buf := make([]byte, 16)
		if _, err := io.ReadFull(conn, buf); err != nil {
			return
		}
		host = net.IP(buf).String()
	default:
		writeSocks5Reply(conn, socks5RepAddrNotSupported, nil, 0)
		return
	}

	portBuf := [2]byte{}
	if _, err := io.ReadFull(conn, portBuf[:]); err != nil {
		return
	}
	port := binary.BigEndian.Uint16(portBuf[:])

	target := net.JoinHostPort(host, strconv.Itoa(int(port)))
	remote, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		rep := socks5RepGeneralFailure
		var netErr net.Error
		if errors.As(err, &netErr) {
			if netErr.Timeout() {
				rep = socks5RepTTLExpired
			} else {
				rep = socks5RepHostUnreachable
			}
		}
		writeSocks5Reply(conn, byte(rep), nil, 0)
		return
	}
	defer remote.Close()

	var bndAddr net.IP
	var bndPort uint16
	if tcpAddr, ok := remote.LocalAddr().(*net.TCPAddr); ok {
		bndAddr = tcpAddr.IP
		bndPort = uint16(tcpAddr.Port)
	}
	writeSocks5Reply(conn, socks5RepSuccess, bndAddr, bndPort)

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

func writeSocks5Reply(conn net.Conn, rep byte, bndAddr net.IP, bndPort uint16) {
	var atyp byte
	var addr []byte
	if bndAddr == nil {
		atyp = socks5AtypIPv4
		addr = []byte{0, 0, 0, 0}
	} else if v4 := bndAddr.To4(); v4 != nil {
		atyp = socks5AtypIPv4
		addr = v4
	} else {
		atyp = socks5AtypIPv6
		addr = bndAddr.To16()
	}
	portBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(portBuf, bndPort)
	conn.Write([]byte{socks5Version, rep, 0x00, atyp})
	conn.Write(addr)
	conn.Write(portBuf)
}
