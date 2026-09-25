package server

import (
	"errors"
	"fmt"
	"go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/bluesky-social/indigo/atproto/auth/oauth"
	"github.com/bluesky-social/indigo/atproto/identity"
	"github.com/jazware/leadsheet.fm/pkg/ingest"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

// Server holds handler dependencies.
type Server struct {
	logger   *slog.Logger
	store    *store.Store
	indexer  *ingest.Indexer
	profiles *ingest.ProfileResolver
	backfill *ingest.Backfiller
	dir      identity.Directory
	oauth    *oauth.ClientApp
	// Cookies are Secure when served over https.
	secureCookies bool
	// Where the app is served from, without a trailing slash.
	publicURL string
	repoStars repoStars
}

type Config struct {
	Logger   *slog.Logger
	Store    *store.Store
	Indexer  *ingest.Indexer
	Profiles *ingest.ProfileResolver
	Backfill *ingest.Backfiller
	Dir      identity.Directory
	OAuth    *oauth.ClientApp
	// Where the app is served from, e.g. http://127.0.0.1:8120.
	PublicURL string
	// Extra CORS origin for the Vite dev server ("" for none).
	DevOrigin string
}

// New builds the Echo app with all routes registered.
func New(cfg Config) *echo.Echo {
	s := &Server{
		logger:        cfg.Logger,
		store:         cfg.Store,
		indexer:       cfg.Indexer,
		profiles:      cfg.Profiles,
		backfill:      cfg.Backfill,
		dir:           cfg.Dir,
		oauth:         cfg.OAuth,
		secureCookies: strings.HasPrefix(cfg.PublicURL, "https:"),
		publicURL:     strings.TrimRight(cfg.PublicURL, "/"),
	}

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.HTTPErrorHandler = jsonErrorHandler(cfg.Logger)

	e.Use(middleware.Recover())
	e.Use(otelecho.Middleware("leadsheet", otelecho.WithSkipper(func(c echo.Context) bool {
		p := c.Request().URL.Path
		return p == "/healthz" || strings.HasPrefix(p, "/assets/")
	})))
	// Sheets are at most 100 KB of text (the lexicon's limit); nothing we
	// take is near 1 MB, so don't read more than that into memory.
	e.Use(middleware.BodyLimit("1M"))
	e.Use(metrics.Middleware())
	e.Use(slogRequestLogger(cfg.Logger))
	if cfg.DevOrigin != "" {
		e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
			AllowOrigins:     []string{cfg.DevOrigin},
			AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete},
			AllowCredentials: true,
		}))
	}
	e.Use(s.loadViewer)

	e.GET("/healthz", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	e.GET("/oauth/client-metadata.json", s.handleClientMetadata)
	e.GET("/oauth/jwks.json", s.handleJWKS)
	e.GET("/oauth/callback", s.handleOAuthCallback)

	api := e.Group("/api")
	api.GET("/session", s.handleSession)
	api.GET("/about", s.handleAbout)
	api.POST("/login", s.handleLogin)
	api.POST("/logout", s.handleLogout)

	api.GET("/sheets", s.handleListSheets)
	api.POST("/sheets", s.handleCreateSheet, s.requireViewer)
	api.GET("/sheets/:actor/:rkey", s.handleGetSheet)
	api.PUT("/sheets/:actor/:rkey", s.handleUpdateSheet, s.requireViewer)
	api.DELETE("/sheets/:actor/:rkey", s.handleDeleteSheet, s.requireViewer)
	api.PUT("/sheets/:actor/:rkey/rating", s.handleRate, s.requireViewer)
	api.PUT("/sheets/:actor/:rkey/favorite", s.handleFavorite, s.requireViewer)

	api.GET("/search", s.handleSearch)
	api.GET("/songs/:artist/:title", s.handleGetSong)
	api.GET("/artists/:artist", s.handleGetArtist)
	api.GET("/profiles/:actor", s.handleGetProfile)

	// Everything else is the embedded frontend (registered last so
	// /api and /oauth win).
	// Link-preview images.
	e.GET("/og/default.png", s.handleOGDefault)
	e.GET("/og/sheet/:actor/:file", s.handleOGSheet)

	spa := newSPAHandler(s.pageMeta)
	e.GET("/*", spa.handle)

	return e
}

// jsonErrorHandler renders every error as {"error": "..."}; anything
// that isn't an *echo.HTTPError is logged and reported as a 500.
func jsonErrorHandler(logger *slog.Logger) echo.HTTPErrorHandler {
	return func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}
		code := http.StatusInternalServerError
		msg := http.StatusText(code)
		var he *echo.HTTPError
		if errors.As(err, &he) {
			code = he.Code
			msg = fmt.Sprint(he.Message)
		} else {
			logger.Error("request failed", "path", c.Request().URL.Path, "error", err)
		}
		if c.Request().Method == http.MethodHead {
			c.NoContent(code)
			return
		}
		c.JSON(code, map[string]string{"error": msg})
	}
}

func slogRequestLogger(logger *slog.Logger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			if err != nil {
				c.Error(err)
			}
			logger.Debug("request",
				"method", c.Request().Method,
				"path", c.Request().URL.Path,
				"status", c.Response().Status,
				"duration_ms", time.Since(start).Milliseconds())
			return err
		}
	}
}
