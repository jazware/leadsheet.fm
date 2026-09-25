package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/bluesky-social/indigo/atproto/atcrypto"
	"github.com/bluesky-social/indigo/atproto/auth/oauth"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/labstack/echo/v4"
)

const (
	sessionCookie = "leadsheet_session"
	returnCookie  = "leadsheet_return"
	sessionMaxAge = store.WebSessionTTL
	viewerKey     = "viewer"
)

// PermissionSet is the published fm.leadsheet.authFull lexicon: repo
// access to the Leadsheet collections only. Auth servers resolve it (via
// _lexicon.leadsheet.fm) and show its title on the consent screen.
const PermissionSet = "fm.leadsheet.authFull"

// Scopes are what every sign-in requests.
var Scopes = []string{"atproto", "include:" + PermissionSet}

// NewOAuthApp configures the atproto OAuth client. Served from a loopback
// address it's a development client (no client metadata to host);
// otherwise the client_id is the metadata document under publicURL, and
// with a clientKey (a multibase P-256 private key, see `leadsheet
// gen-client-key`) it's a confidential client, which auth servers give
// longer sessions.
func NewOAuthApp(publicURL, clientKey, clientKeyID string, st *store.Store) (*oauth.ClientApp, error) {
	u, err := url.Parse(strings.TrimRight(publicURL, "/"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid public URL %q", publicURL)
	}
	var cfg oauth.ClientConfig
	if isLoopback(u.Hostname()) {
		// Loopback redirect URIs must use an IP literal, not "localhost".
		u.Host = net.JoinHostPort("127.0.0.1", u.Port())
		cfg = oauth.NewLocalhostConfig(u.String()+"/oauth/callback", Scopes)
	} else {
		cfg = oauth.NewPublicConfig(u.String()+"/oauth/client-metadata.json", u.String()+"/oauth/callback", Scopes)
		if clientKey != "" {
			priv, err := atcrypto.ParsePrivateMultibase(clientKey)
			if err != nil {
				return nil, fmt.Errorf("parsing OAuth client key: %w", err)
			}
			if err := cfg.SetClientSecret(priv, clientKeyID); err != nil {
				return nil, err
			}
		}
	}
	cfg.UserAgent = "leadsheet"
	return oauth.NewClientApp(&cfg, st.OAuth()), nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) handleClientMetadata(c echo.Context) error {
	meta := s.oauth.Config.ClientMetadata()
	name := "Leadsheet"
	meta.ClientName = &name
	if u, err := url.Parse(s.oauth.Config.ClientID); err == nil && u.Scheme == "https" {
		home := "https://" + u.Host
		meta.ClientURI = &home
		if s.oauth.Config.IsConfidential() {
			jwks := home + "/oauth/jwks.json"
			meta.JWKSURI = &jwks
		}
	}
	// Auth servers cache this; keep it short so scope and key changes
	// take effect quickly.
	c.Response().Header().Set("Cache-Control", "public, max-age=300")
	return c.JSON(http.StatusOK, meta)
}

// handleJWKS publishes the confidential client's public key (empty for a
// public client).
func (s *Server) handleJWKS(c echo.Context) error {
	c.Response().Header().Set("Cache-Control", "public, max-age=300")
	return c.JSON(http.StatusOK, s.oauth.Config.PublicJWKS())
}

// loadViewer attaches the signed-in account (if any) to the request.
func (s *Server) loadViewer(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if cookie, err := c.Cookie(sessionCookie); err == nil && cookie.Value != "" {
			ws, err := s.store.GetWebSession(c.Request().Context(), cookie.Value)
			if err == nil {
				c.Set(viewerKey, ws)
			} else if !errors.Is(err, store.ErrNotFound) {
				return err
			}
		}
		return next(c)
	}
}

func viewer(c echo.Context) *store.WebSession {
	ws, _ := c.Get(viewerKey).(*store.WebSession)
	return ws
}

func (s *Server) requireViewer(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if viewer(c) == nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "sign in first")
		}
		return next(c)
	}
}

// pdsClient resumes the viewer's OAuth session for writing to their repo.
// A session the PDS no longer honors signs the browser out.
func (s *Server) pdsClient(c echo.Context) (*oauth.ClientSession, error) {
	ws := viewer(c)
	sess, err := s.oauth.ResumeSession(c.Request().Context(), ws.DID, ws.SessionID)
	if err != nil {
		s.logger.Warn("resuming oauth session", "did", ws.DID, "error", err)
		s.signOut(c)
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "your session expired; sign in again")
	}
	return sess, nil
}

func (s *Server) handleSession(c echo.Context) error {
	ws := viewer(c)
	if ws == nil {
		return c.JSON(http.StatusOK, map[string]any{"viewer": nil})
	}
	a, err := s.store.GetAuthor(c.Request().Context(), ws.DID.String())
	if errors.Is(err, store.ErrNotFound) {
		a = &store.Author{DID: ws.DID.String()}
	} else if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"viewer": a})
}

func (s *Server) handleLogin(c echo.Context) error {
	var req struct {
		Identifier string `json:"identifier"`
		ReturnTo   string `json:"returnTo"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	ident := strings.TrimPrefix(strings.TrimSpace(req.Identifier), "@")
	if ident == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "enter your handle")
	}
	// "alice" is shorthand for "alice.bsky.social".
	if !strings.Contains(ident, ".") && !strings.HasPrefix(ident, "did:") {
		ident += ".bsky.social"
	}
	redirect, err := s.oauth.StartAuthFlow(c.Request().Context(), ident)
	if err != nil {
		s.logger.Info("starting login", "identifier", ident, "error", err)
		metrics.Logins.WithLabelValues("start_failed").Inc()
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("couldn't start sign-in for %s: %v", ident, err))
	}
	metrics.Logins.WithLabelValues("started").Inc()
	if isLocalPath(req.ReturnTo) {
		c.SetCookie(&http.Cookie{Name: returnCookie, Value: url.QueryEscape(req.ReturnTo), Path: "/",
			MaxAge: 1800, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.secureCookies})
	}
	return c.JSON(http.StatusOK, map[string]string{"redirect": redirect})
}

func (s *Server) handleOAuthCallback(c echo.Context) error {
	ctx := c.Request().Context()
	sess, err := s.oauth.ProcessCallback(ctx, c.QueryParams())
	if err != nil {
		reason := loginFailure(c.QueryParams())
		s.logger.Warn("oauth callback", "reason", reason, "error", err)
		metrics.Logins.WithLabelValues("callback_" + reason).Inc()
		// Back where they started (the return cookie stays for another
		// try), with a reason the page can explain.
		return c.Redirect(http.StatusFound, withQuery(s.returnPath(c, false), "login_error", reason))
	}
	token, err := s.store.CreateWebSession(ctx, sess.AccountDID, sess.SessionID)
	if err != nil {
		return err
	}
	c.SetCookie(&http.Cookie{Name: sessionCookie, Value: token, Path: "/",
		MaxAge: int(sessionMaxAge.Seconds()), HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.secureCookies})

	// Resolve the handle now so the header shows it right away, and pick
	// up anything the account wrote while Leadsheet wasn't watching.
	resolveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	s.profiles.Resolve(resolveCtx, sess.AccountDID.String())
	cancel()
	go func(did string) {
		// Detached from the request, but still in its trace.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		if err := s.backfill.BackfillRepo(ctx, did); err != nil {
			s.logger.Warn("backfilling signed-in account", "did", did, "error", err)
		}
	}(sess.AccountDID.String())

	s.logger.Info("signed in", "did", sess.AccountDID)
	metrics.Logins.WithLabelValues("completed").Inc()
	return c.Redirect(http.StatusFound, s.returnPath(c, true))
}

// returnPath is where sign-in started ("/" if unknown), optionally
// forgetting it.
func (s *Server) returnPath(c echo.Context, clear bool) string {
	returnTo := "/"
	if ck, err := c.Cookie(returnCookie); err == nil {
		if v, err := url.QueryUnescape(ck.Value); err == nil && isLocalPath(v) {
			returnTo = v
		}
		if clear {
			c.SetCookie(&http.Cookie{Name: returnCookie, Path: "/", MaxAge: -1})
		}
	}
	return returnTo
}

// loginFailure sums up why sign-in didn't finish, from what the
// authorization server sent back: "expired" (the request timed out, or an
// old sign-in page was reused), "denied" (the person said no), or
// "failed" (anything else; the details are logged).
func loginFailure(q url.Values) string {
	if q.Get("error") != "access_denied" {
		return "failed"
	}
	if strings.Contains(strings.ToLower(q.Get("error_description")), "expired") {
		return "expired"
	}
	return "denied"
}

// withQuery sets one query parameter on a local path.
func withQuery(path, key, value string) string {
	u, err := url.Parse(path)
	if err != nil {
		return "/?" + url.Values{key: {value}}.Encode()
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

// isLocalPath reports whether p is a path on this site, safe to redirect
// to: rooted, with no scheme or host. Browsers read a backslash as "/",
// so "/\evil.com" is as off-site as "//evil.com", and they drop tabs and
// newlines, so "/\t/evil.com" is too.
func isLocalPath(p string) bool {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return false
	}
	if strings.ContainsAny(p, "\\\r\n\t") {
		return false
	}
	u, err := url.Parse(p)
	return err == nil && u.Scheme == "" && u.Host == ""
}

func (s *Server) handleLogout(c echo.Context) error {
	metrics.Logins.WithLabelValues("logout").Inc()
	if ws := viewer(c); ws != nil {
		if err := s.oauth.Logout(c.Request().Context(), ws.DID, ws.SessionID); err != nil {
			s.logger.Info("revoking oauth session", "did", ws.DID, "error", err)
		}
	}
	s.signOut(c)
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) signOut(c echo.Context) {
	if cookie, err := c.Cookie(sessionCookie); err == nil {
		if err := s.store.DeleteWebSession(c.Request().Context(), cookie.Value); err != nil {
			s.logger.Error("deleting web session", "error", err)
		}
	}
	c.SetCookie(&http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true})
}

// resolveActor turns a handle or DID from a URL into a DID.
func (s *Server) resolveActor(ctx context.Context, actor string) (string, error) {
	if strings.HasPrefix(actor, "did:") {
		if _, err := syntax.ParseDID(actor); err != nil {
			return "", echo.NewHTTPError(http.StatusBadRequest, "invalid DID")
		}
		return actor, nil
	}
	if a, err := s.store.GetAuthor(ctx, actor); err == nil {
		return a.DID, nil
	}
	h, err := syntax.ParseHandle(actor)
	if err != nil {
		return "", echo.NewHTTPError(http.StatusBadRequest, "invalid handle")
	}
	ident, err := s.dir.LookupHandle(ctx, h)
	if err != nil {
		return "", echo.NewHTTPError(http.StatusNotFound, "unknown account")
	}
	return ident.DID.String(), nil
}
