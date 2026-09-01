// Package service implements a lightweight local proxy service that can be
// started/stopped from the management panel. Phase 1 provides SOCKS5 and HTTP
// proxy listeners on a single TCP port with optional password authentication.
//
// Shadowsocks AEAD encryption and UDP relay are reserved for Phase 2.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"sync"
	"time"
)

// SettingKey is the SQLite settings key under which the service config is
// persisted.
const SettingKey = "charitable.proxy.service.v1"

// EncryptionMethod constants. Phase 1 only supports "none" (plain SOCKS5/HTTP
// with optional password auth). Phase 2 will add Shadowsocks ciphers.
const (
	EncryptionNone = "none"
)

// Config is the persisted service configuration.
type Config struct {
	ListenAddr       string `json:"listen_addr"`
	TCPPort          int    `json:"tcp_port"`
	UDPPort          int    `json:"udp_port"`
	Password         string `json:"password"`
	EncryptionMethod string `json:"encryption_method"`
	AutoRegister     bool   `json:"auto_register"`
	Enabled          bool   `json:"enabled"`
}

// DefaultConfig returns a safe default configuration bound to localhost.
func DefaultConfig() Config {
	return Config{
		ListenAddr:       "127.0.0.1",
		TCPPort:          0, // 0 means not configured / disabled
		UDPPort:          0,
		Password:         "",
		EncryptionMethod: EncryptionNone,
		AutoRegister:     false,
		Enabled:          false,
	}
}

// Validate checks the config for obvious errors.
func (c Config) Validate() error {
	if c.ListenAddr == "" {
		return errors.New("listen_addr is required")
	}
	if c.TCPPort < 0 || c.TCPPort > 65535 {
		return errors.New("tcp_port out of range")
	}
	if c.UDPPort < 0 || c.UDPPort > 65535 {
		return errors.New("udp_port out of range")
	}
	if c.EncryptionMethod != "" && c.EncryptionMethod != EncryptionNone {
		if !IsSSCipher(c.EncryptionMethod) {
			return fmt.Errorf("encryption_method %q not supported", c.EncryptionMethod)
		}
		if c.Password == "" {
			return errors.New("password is required for shadowsocks encryption")
		}
	}
	// Non-localhost listen addresses require a password.
	if !isLoopback(c.ListenAddr) && c.Password == "" {
		return errors.New("password is required when listening on non-loopback addresses")
	}
	return nil
}

// ComponentStatus describes the runtime state of a single listener.
type ComponentStatus struct {
	Running bool   `json:"running"`
	Error   string `json:"error,omitempty"`
}

// Status is the full runtime status of the proxy service.
type Status struct {
	Running   bool            `json:"running"`
	Enabled   bool            `json:"enabled"`
	ListenAddr string         `json:"listen_addr"`
	TCPPort   int             `json:"tcp_port"`
	UDPPort   int             `json:"udp_port"`
	TCP       ComponentStatus `json:"tcp"`
	UDP       ComponentStatus `json:"udp"`
	StartedAt *time.Time      `json:"started_at,omitempty"`
}

// Service manages the local proxy listeners.
type Service struct {
	mu      sync.Mutex
	cfg     Config
	tcpLn   net.Listener
	udpConn *net.UDPConn
	tcpErr  string
	udpErr  string
	startedAt time.Time
	running bool
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// New creates a new Service with the given configuration. The service is not
// started; call Start explicitly.
func New(cfg Config) *Service {
	return &Service{cfg: cfg}
}

// Config returns the current configuration.
func (s *Service) Config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// UpdateConfig replaces the configuration. If the service is running, the
// caller must call Restart to apply the new config.
func (s *Service) UpdateConfig(cfg Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
}

// Status returns the current runtime status.
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{
		Running:    s.running,
		Enabled:    s.cfg.Enabled,
		ListenAddr: s.cfg.ListenAddr,
		TCPPort:    s.cfg.TCPPort,
		UDPPort:    s.cfg.UDPPort,
		TCP:        ComponentStatus{Running: s.tcpLn != nil, Error: s.tcpErr},
		UDP:        ComponentStatus{Running: s.udpConn != nil, Error: s.udpErr},
	}
	if s.running && !s.startedAt.IsZero() {
		t := s.startedAt
		st.StartedAt = &t
	}
	return st
}

// Start begins listening on the configured TCP (and optionally UDP) ports.
// If already running, it returns nil without restarting.
func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return nil
	}
	cfg := s.cfg
	s.mu.Unlock()

	if err := cfg.Validate(); err != nil {
		return err
	}
	if cfg.TCPPort == 0 {
		return errors.New("tcp_port is required to start")
	}

	innerCtx, cancel := context.WithCancel(ctx)

	tcpAddr := fmt.Sprintf("%s:%d", cfg.ListenAddr, cfg.TCPPort)
	tcpLn, err := net.Listen("tcp", tcpAddr)
	if err != nil {
		cancel()
		return fmt.Errorf("listen tcp %s: %w", tcpAddr, err)
	}

	var udpConn *net.UDPConn
	var udpErrStr string
	if cfg.UDPPort > 0 {
		udpAddr := &net.UDPAddr{IP: net.ParseIP(cfg.ListenAddr), Port: cfg.UDPPort}
		conn, errUDP := net.ListenUDP("udp", udpAddr)
		if errUDP != nil {
			udpErrStr = errUDP.Error()
			log.Printf("proxy-service: udp listen %s: %v", udpAddr, errUDP)
		} else {
			udpConn = conn
		}
	}

	s.mu.Lock()
	s.tcpLn = tcpLn
	s.udpConn = udpConn
	s.tcpErr = ""
	s.udpErr = udpErrStr
	s.running = true
	s.startedAt = time.Now()
	s.cancel = cancel
	s.mu.Unlock()

	// TCP accept loop — SOCKS5 + HTTP proxy on the same port.
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.serveTCP(innerCtx, tcpLn, cfg.EncryptionMethod, cfg.Password)
	}()

	if udpConn != nil {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.serveUDP(innerCtx, udpConn, cfg.EncryptionMethod, cfg.Password)
		}()
	}

	log.Printf("proxy-service: started tcp=%s udp_port=%d", tcpAddr, cfg.UDPPort)
	return nil
}

// Stop shuts down all listeners and waits for goroutines to exit.
func (s *Service) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	tcpLn := s.tcpLn
	udpConn := s.udpConn
	cancel := s.cancel
	s.tcpLn = nil
	s.udpConn = nil
	s.cancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if tcpLn != nil {
		_ = tcpLn.Close()
	}
	if udpConn != nil {
		_ = udpConn.Close()
	}
	s.wg.Wait()
	s.mu.Lock()
	s.tcpErr = ""
	s.udpErr = ""
	s.mu.Unlock()
	log.Printf("proxy-service: stopped")
}

// Restart stops (if running) and starts again with the current config.
func (s *Service) Restart(ctx context.Context) error {
	s.Stop()
	return s.Start(ctx)
}

// Shutdown is an alias for Stop, intended for graceful process exit.
func (s *Service) Shutdown(_ context.Context) error {
	s.Stop()
	return nil
}

// MarshalConfig serializes the config to JSON bytes.
func MarshalConfig(cfg Config) ([]byte, error) {
	return json.Marshal(cfg)
}

// UnmarshalConfig deserializes config from JSON bytes, applying defaults.
func UnmarshalConfig(raw []byte) (Config, error) {
	cfg := DefaultConfig()
	if len(raw) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return DefaultConfig(), err
	}
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = DefaultConfig().ListenAddr
	}
	if cfg.EncryptionMethod == "" {
		cfg.EncryptionMethod = EncryptionNone
	}
	return cfg, nil
}

func isLoopback(addr string) bool {
	if addr == "localhost" || addr == "127.0.0.1" || addr == "::1" {
		return true
	}
	ip := net.ParseIP(addr)
	return ip != nil && ip.IsLoopback()
}
