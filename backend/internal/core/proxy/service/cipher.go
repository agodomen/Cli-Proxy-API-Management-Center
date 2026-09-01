// Package service — Shadowsocks AEAD cipher support.
//
// Implements the Shadowsocks AEAD (2017) key derivation and per-connection
// session subkey derivation as described in the Shadowsocks protocol spec.
// Supported ciphers:
//   - aes-128-gcm, aes-256-gcm (crypto/aes + crypto/cipher GCM)
//   - chacha20-ietf-poly1305 (golang.org/x/crypto/chacha20poly1305)
//
// The 2022-blake3 variants are intentionally omitted for now; they require a
// different key derivation and header format.
package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strings"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/hkdf"
)

// CipherInfo describes a Shadowsocks AEAD cipher.
type CipherInfo struct {
	KeySize   int // master key size in bytes
	SaltSize  int // salt size in bytes
	NonceSize int // AEAD nonce size in bytes
	TagSize   int // AEAD tag size in bytes
	NewAEAD   func(key []byte) (cipher.AEAD, error)
}

var ssCiphers = map[string]CipherInfo{
	"aes-128-gcm": {
		KeySize:   16,
		SaltSize:  16,
		NonceSize: 12,
		TagSize:   16,
		NewAEAD: func(key []byte) (cipher.AEAD, error) {
			block, err := aes.NewCipher(key)
			if err != nil {
				return nil, err
			}
			return cipher.NewGCM(block)
		},
	},
	"aes-256-gcm": {
		KeySize:   32,
		SaltSize:  32,
		NonceSize: 12,
		TagSize:   16,
		NewAEAD: func(key []byte) (cipher.AEAD, error) {
			block, err := aes.NewCipher(key)
			if err != nil {
				return nil, err
			}
			return cipher.NewGCM(block)
		},
	},
	"chacha20-ietf-poly1305": {
		KeySize:   32,
		SaltSize:  32,
		NonceSize: 12,
		TagSize:   16,
		NewAEAD: func(key []byte) (cipher.AEAD, error) {
			return chacha20poly1305.New(key)
		},
	},
}

// SupportedSSCiphers returns the list of supported cipher method names.
func SupportedSSCiphers() []string {
	return []string{"aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"}
}

// IsSSCipher reports whether the given method name is a supported AEAD cipher.
func IsSSCipher(method string) bool {
	_, ok := ssCiphers[strings.ToLower(method)]
	return ok
}

// GetCipherInfo returns the CipherInfo for the given method, or an error.
func GetCipherInfo(method string) (CipherInfo, error) {
	info, ok := ssCiphers[strings.ToLower(method)]
	if !ok {
		return CipherInfo{}, errors.New("unsupported cipher: " + method)
	}
	return info, nil
}

// DeriveSSKey derives the master key from a password using the Shadowsocks
// EVP_BytesToKey (MD5) key derivation function.
func DeriveSSKey(password string, keySize int) []byte {
	const md5Len = 16
	var buf, prev []byte
	for len(buf) < keySize {
		h := hmac.New(sha1.New, prev) //nolint:gosec // Shadowsocks spec uses SHA1
		h.Write([]byte(password))
		h.Write(buf)
		prev = h.Sum(nil)[:md5Len]
		buf = append(buf, prev...)
	}
	return buf[:keySize]
}

// SessionAEAD holds the per-connection AEAD cipher and nonce counter.
type SessionAEAD struct {
	aead      cipher.AEAD
	salt      []byte
	nonce     []byte
	nonceSize int
}

// NewSessionAEAD derives a session subkey from the master key and salt, then
// creates the AEAD cipher. The salt is used as the HKDF info parameter.
func NewSessionAEAD(info CipherInfo, masterKey, salt []byte) (*SessionAEAD, error) {
	if len(salt) != info.SaltSize {
		return nil, errors.New("salt size mismatch")
	}
	subkey := make([]byte, info.KeySize)
	if _, err := hkdf.New(sha256.New, masterKey, salt, []byte("ss-subkey")).Read(subkey); err != nil {
		return nil, err
	}
	aead, err := info.NewAEAD(subkey)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, info.NonceSize)
	return &SessionAEAD{aead: aead, salt: salt, nonce: nonce, nonceSize: info.NonceSize}, nil
}

// Encrypt encrypts plaintext and appends the AEAD tag. The nonce is
// incremented after each call (little-endian counter).
func (s *SessionAEAD) Encrypt(plaintext []byte) []byte {
	ciphertext := s.aead.Seal(nil, s.nonce, plaintext, nil)
	s.incrementNonce()
	return ciphertext
}

// Decrypt decrypts a single AEAD chunk (ciphertext + tag). The nonce is
// incremented after each call.
func (s *SessionAEAD) Decrypt(ciphertext []byte) ([]byte, error) {
	plaintext, err := s.aead.Open(nil, s.nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	s.incrementNonce()
	return plaintext, nil
}

// TagSize returns the AEAD tag size.
func (s *SessionAEAD) TagSize() int { return s.aead.Overhead() }

// incrementNonce increments the nonce as a little-endian counter.
func (s *SessionAEAD) incrementNonce() {
	for i := 0; i < len(s.nonce); i++ {
		s.nonce[i]++
		if s.nonce[i] != 0 {
			break
		}
	}
}

// MaxPayloadSize is the maximum Shadowsocks AEAD payload chunk size.
const MaxPayloadSize = 0xFFFF

// EncryptPayload encrypts a payload using the Shadowsocks AEAD chunk format:
// [2-byte length][length tag][payload][payload tag]
func (s *SessionAEAD) EncryptPayload(payload []byte) []byte {
	// Length prefix (2 bytes big-endian) + tag.
	lenBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(lenBuf, uint16(len(payload)))
	encLen := s.aead.Seal(nil, s.nonce, lenBuf, nil)
	s.incrementNonce()

	// Payload + tag.
	encPayload := s.aead.Seal(nil, s.nonce, payload, nil)
	s.incrementNonce()

	return append(encLen, encPayload...)
}

// DecryptChunk reads and decrypts one AEAD chunk from the reader. Returns the
// decrypted payload. A zero-length chunk signals end-of-stream.
func (s *SessionAEAD) DecryptChunk(reader chunkReader) ([]byte, error) {
	tagSize := s.aead.Overhead()

	// Read encrypted length (2 + tag).
	encLen, err := reader.ReadN(2 + tagSize)
	if err != nil {
		return nil, err
	}
	lenBuf, err := s.aead.Open(nil, s.nonce, encLen, nil)
	if err != nil {
		return nil, errors.New("decrypt length: " + err.Error())
	}
	s.incrementNonce()

	payloadLen := binary.BigEndian.Uint16(lenBuf)
	if payloadLen == 0 {
		return nil, nil // end of stream
	}

	// Read encrypted payload (payloadLen + tag).
	encPayload, err := reader.ReadN(int(payloadLen) + tagSize)
	if err != nil {
		return nil, err
	}
	plaintext, err := s.aead.Open(nil, s.nonce, encPayload, nil)
	if err != nil {
		return nil, errors.New("decrypt payload: " + err.Error())
	}
	s.incrementNonce()

	return plaintext, nil
}

// chunkReader is a minimal interface for reading exact byte counts.
type chunkReader interface {
	ReadN(n int) ([]byte, error)
}
