package service

import "crypto/rand"

// readRandom fills b with cryptographically secure random bytes.
func readRandom(b []byte) (int, error) {
	return rand.Read(b)
}

// randomSalt generates a random salt of the given size.
func randomSalt(size int) ([]byte, error) {
	salt := make([]byte, size)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return salt, nil
}
