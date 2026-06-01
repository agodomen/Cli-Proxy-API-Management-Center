package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/collector"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/config"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/httpapi"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/localengine"
	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/internal/core/store"
)

func main() {
	logManagementPasswordFromEnv()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	manager := collector.NewManager(cfg, db)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.CPAUpstreamURL != "" && cfg.ManagementKey != "" {
		manager.Start(ctx, collector.RuntimeConfig{
			CPAUpstreamURL: cfg.CPAUpstreamURL,
			ManagementKey:  cfg.ManagementKey,
			CollectorMode:  cfg.CollectorMode,
			Queue:          cfg.Queue,
			PopSide:        cfg.PopSide,
			BatchSize:      cfg.BatchSize,
			PollInterval:   cfg.PollInterval,
			TLSSkipVerify:  cfg.TLSSkipVerify,
		})
	} else if managerCfg, ok, err := db.LoadManagerConfig(ctx); err == nil && ok &&
		managerCfg.CPAConnection.CPABaseURL != "" && managerCfg.CPAConnection.ManagementKey != "" {
		if managerCollectorEnabled(managerCfg) {
			manager.Start(ctx, runtimeConfigFromManagerConfig(managerCfg, cfg))
		}
	} else if setup, ok, err := db.LoadSetup(ctx); err == nil && ok {
		manager.Start(ctx, collector.RuntimeConfig{
			CPAUpstreamURL: setup.CPAUpstreamURL,
			ManagementKey:  setup.ManagementKey,
			CollectorMode:  cfg.CollectorMode,
			Queue:          setup.Queue,
			PopSide:        setup.PopSide,
			BatchSize:      cfg.BatchSize,
			PollInterval:   cfg.PollInterval,
			TLSSkipVerify:  cfg.TLSSkipVerify,
		})
	} else if err != nil {
		log.Printf("load setup: %v", err)
	}

	apiServer := httpapi.New(cfg, db, manager)
	localRuntime, err := localengine.New(cfg.LocalEngine, manager)
	if err != nil {
		log.Fatalf("initialize local CLIProxyAPI engine: %v", err)
	}
	if localRuntime != nil {
		apiServer.SetLocalEngineStatus(func() any { return localRuntime.Status() })
	}

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	runtimeErrors := make(chan error, 2)
	go func() {
		log.Printf("cpamc listening on %s", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			runtimeErrors <- fmt.Errorf("cpamc HTTP server: %w", err)
		}
	}()
	if localRuntime != nil {
		go func() {
			status := localRuntime.Status()
			log.Printf("embedded CLIProxyAPI listening on %s", status.Address)
			if err := localRuntime.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				runtimeErrors <- fmt.Errorf("embedded CLIProxyAPI: %w", err)
			}
		}()
	}

	select {
	case <-ctx.Done():
	case runtimeErr := <-runtimeErrors:
		log.Printf("runtime stopped unexpectedly: %v", runtimeErr)
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	manager.Stop()
	if localRuntime != nil {
		if err := localRuntime.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown embedded CLIProxyAPI: %v", err)
		}
	}
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func runtimeConfigFromManagerConfig(managerCfg store.ManagerConfig, base config.Config) collector.RuntimeConfig {
	pollInterval := time.Duration(managerCfg.Collector.PollIntervalMS) * time.Millisecond
	if pollInterval <= 0 {
		pollInterval = base.PollInterval
	}
	batchSize := managerCfg.Collector.BatchSize
	if batchSize <= 0 {
		batchSize = base.BatchSize
	}
	return collector.RuntimeConfig{
		CPAUpstreamURL: managerCfg.CPAConnection.CPABaseURL,
		ManagementKey:  managerCfg.CPAConnection.ManagementKey,
		CollectorMode:  valueOr(managerCfg.Collector.CollectorMode, base.CollectorMode),
		Queue:          valueOr(managerCfg.Collector.Queue, base.Queue),
		PopSide:        valueOr(managerCfg.Collector.PopSide, base.PopSide),
		BatchSize:      batchSize,
		PollInterval:   pollInterval,
		TLSSkipVerify:  managerCfg.Collector.TLSSkipVerify,
	}
}

func valueOr(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func managerCollectorEnabled(managerCfg store.ManagerConfig) bool {
	return managerCfg.Collector.Enabled == nil || *managerCfg.Collector.Enabled
}

// logManagementPasswordFromEnv echoes MANAGEMENT_PASSWORD on process start so
// Docker / service console logs always surface the bootstrap login secret.
func logManagementPasswordFromEnv() {
	password := os.Getenv("MANAGEMENT_PASSWORD")
	if password == "" {
		return
	}
	log.Printf("MANAGEMENT_PASSWORD=%s", password)
}
