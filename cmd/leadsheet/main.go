package main

import (
	"context"
	"fmt"
	"github.com/jazware/leadsheet.fm/pkg/httpclient"
	"github.com/jazware/leadsheet.fm/pkg/tracing"
	"go.opentelemetry.io/otel/attribute"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/bluesky-social/indigo/atproto/atcrypto"
	"github.com/jazware/leadsheet.fm/pkg/ingest"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/server"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/jazware/leadsheet.fm/telemetry"
	"github.com/jazware/leadsheet.fm/version"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Name:    "leadsheet",
		Usage:   "Chord sheets on atproto: an AppView for fm.leadsheet.* records with a web UI",
		Version: version.String(),
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "listen-address",
				Usage:   "Address to listen on for HTTP requests",
				EnvVars: []string{"LEADSHEET_LISTEN_ADDRESS"},
				Value:   "127.0.0.1:8120",
			},
			&cli.StringFlag{
				Name:    "public-url",
				Usage:   "URL the app is reached at. A loopback URL makes a development OAuth client; anything else serves client metadata at <url>/oauth/client-metadata.json",
				EnvVars: []string{"LEADSHEET_PUBLIC_URL"},
				Value:   "http://127.0.0.1:8120",
			},
			&cli.StringFlag{
				Name:    "dev-origin",
				Usage:   "Extra CORS origin for the Vite dev server",
				EnvVars: []string{"LEADSHEET_DEV_ORIGIN"},
			},
			&cli.StringFlag{
				Name:    "database-url",
				Usage:   "Postgres connection string (`just db` runs one locally)",
				EnvVars: []string{"LEADSHEET_DATABASE_URL"},
				Value:   "postgres://leadsheet:leadsheet@127.0.0.1:5433/leadsheet?sslmode=disable",
			},
			&cli.StringFlag{
				Name:    "jetstream-host",
				Usage:   "Jetstream v2 host to follow",
				EnvVars: []string{"LEADSHEET_JETSTREAM_HOST"},
				Value:   "jetstream.us-east.bsky.network",
			},
			&cli.StringFlag{
				Name:    "jetstream-api-key",
				Usage:   "Jetstream API key; enables archive replay (exact resume after downtime, no relay backfill)",
				EnvVars: []string{"JETSTREAM_API_KEY"},
			},
			&cli.StringFlag{
				Name:    "relay-host",
				Usage:   "Relay to ask which repos have fm.leadsheet.* records, for the first-run backfill",
				EnvVars: []string{"LEADSHEET_RELAY_HOST"},
				Value:   "https://relay1.us-east.bsky.network",
			},
			&cli.StringFlag{
				Name:    "bsky-appview",
				Usage:   "Bluesky AppView for display names and avatars",
				EnvVars: []string{"LEADSHEET_BSKY_APPVIEW"},
				Value:   "https://public.api.bsky.app",
			},
			&cli.BoolFlag{
				Name:    "backfill",
				Usage:   "Re-run the relay backfill even if one already finished",
				EnvVars: []string{"LEADSHEET_BACKFILL"},
			},
			&cli.BoolFlag{
				Name:    "no-ingest",
				Usage:   "Don't follow the firehose or backfill (serve the index as it is)",
				EnvVars: []string{"LEADSHEET_NO_INGEST"},
			},
			&cli.StringFlag{
				Name:    "oauth-client-key",
				Usage:   "Multibase P-256 private key for a confidential OAuth client (see gen-client-key); public URL only",
				EnvVars: []string{"LEADSHEET_OAUTH_CLIENT_KEY"},
			},
			&cli.StringFlag{
				Name:    "oauth-client-key-id",
				Usage:   "Key ID published with the client key in /oauth/jwks.json (change it when rotating keys)",
				EnvVars: []string{"LEADSHEET_OAUTH_CLIENT_KEY_ID"},
				Value:   "k1",
			},
			&cli.StringFlag{
				Name:    "metrics-listen-address",
				Usage:   "Address for Prometheus metrics (/metrics) and pprof; empty to disable",
				EnvVars: []string{"LEADSHEET_METRICS_LISTEN_ADDRESS"},
				Value:   "127.0.0.1:8122",
			},
			&cli.BoolFlag{
				Name:    "debug",
				Usage:   "Enable debug logging",
				EnvVars: []string{"LEADSHEET_DEBUG"},
			},
			// Tracing is on when OTEL_EXPORTER_OTLP_ENDPOINT is set.
			telemetry.CLIFlagTracingSampleRatio,
		},
		Action: run,
		Commands: []*cli.Command{
			{
				Name:  "gen-client-key",
				Usage: "Print a new P-256 private key (multibase) for --oauth-client-key",
				Action: func(*cli.Context) error {
					priv, err := atcrypto.GeneratePrivateKeyP256()
					if err != nil {
						return err
					}
					fmt.Println(priv.Multibase())
					return nil
				},
			},
		},
	}

	if err := app.Run(os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run(cctx *cli.Context) error {
	level := slog.LevelInfo
	if cctx.Bool("debug") {
		level = slog.LevelDebug
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	logger.Info("starting leadsheet",
		"version", version.Version,
		"commit", version.GitCommit,
		"listen_address", cctx.String("listen-address"),
		"public_url", cctx.String("public-url"))

	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" {
		shutdown, err := telemetry.StartTracing(cctx, telemetry.WithServiceName("leadsheet"))
		if err != nil {
			return fmt.Errorf("starting tracing: %w", err)
		}
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := shutdown(ctx); err != nil {
				logger.Error("flushing traces", "error", err)
			}
		}()
	}

	startCtx, cancelStart := context.WithTimeout(context.Background(), time.Minute)
	db, err := store.Open(startCtx, cctx.String("database-url"))
	cancelStart()
	if err != nil {
		return err
	}
	defer db.Close()

	oauthApp, err := server.NewOAuthApp(cctx.String("public-url"),
		cctx.String("oauth-client-key"), cctx.String("oauth-client-key-id"), db)
	if err != nil {
		return err
	}

	dir := httpclient.Directory()
	httpclient.InstrumentOAuth(oauthApp, dir)
	indexer := ingest.NewIndexer(logger, db)
	profiles := ingest.NewProfileResolver(logger, db, dir, cctx.String("bsky-appview"))
	backfiller := ingest.NewBackfiller(logger, db, indexer, dir, cctx.String("relay-host"))
	firehose := ingest.NewFirehose(logger, db, indexer, cctx.String("jetstream-host"), cctx.String("jetstream-api-key"))

	// Background workers stop before the database closes.
	bgCtx, cancelBg := context.WithCancel(context.Background())
	var bg sync.WaitGroup
	defer func() {
		cancelBg()
		bg.Wait()
	}()
	collector := metrics.NewCollector(logger, db)
	prometheus.MustRegister(collector)
	telemetry.StartMetrics(cctx)
	bg.Go(func() { collector.Run(bgCtx) })
	bg.Go(func() { profiles.Run(bgCtx) })
	bg.Go(func() { cleanupLoop(bgCtx, logger, db) })
	if !cctx.Bool("no-ingest") {
		bg.Go(func() { firehose.Run(bgCtx) })
		// With archive replay the firehose backfills itself.
		if !firehose.CanReplay() || cctx.Bool("backfill") {
			bg.Go(func() {
				if err := backfiller.RunOnce(bgCtx, cctx.Bool("backfill")); err != nil && bgCtx.Err() == nil {
					logger.Error("backfill failed; will retry on next start", "error", err)
				}
			})
		}
	}

	e := server.New(server.Config{
		Logger:    logger,
		Store:     db,
		Indexer:   indexer,
		Profiles:  profiles,
		Backfill:  backfiller,
		Dir:       dir,
		OAuth:     oauthApp,
		PublicURL: cctx.String("public-url"),
		DevOrigin: cctx.String("dev-origin"),
	})

	go func() {
		if err := e.Start(cctx.String("listen-address")); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(ctx); err != nil {
		return fmt.Errorf("shutting down server: %w", err)
	}
	return nil
}

// cleanupLoop deletes stale data (see store.Cleanup) at startup and then
// hourly.
func cleanupLoop(ctx context.Context, logger *slog.Logger, db *store.Store) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		cctx, span := tracing.Start(ctx, "cleanup")
		r, err := db.Cleanup(cctx, time.Now())
		span.SetAttributes(attribute.Int64("deleted", r.Total()))
		tracing.End(span, err)
		switch {
		case err != nil && ctx.Err() == nil:
			logger.Error("cleanup failed", "error", err)
		case r.Total() > 0:
			for kind, n := range map[string]int64{"og_cards": r.OGCards, "web_sessions": r.WebSessions,
				"oauth_sessions": r.OAuthSessions, "oauth_requests": r.OAuthRequests, "sheet_stats": r.SheetStats} {
				metrics.CleanupDeleted.WithLabelValues(kind).Add(float64(n))
			}
			logger.Info("cleaned up stale data", "og_cards", r.OGCards, "web_sessions", r.WebSessions,
				"oauth_sessions", r.OAuthSessions, "oauth_requests", r.OAuthRequests, "sheet_stats", r.SheetStats)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
