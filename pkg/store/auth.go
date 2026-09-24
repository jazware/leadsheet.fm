package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/bluesky-social/indigo/atproto/auth/oauth"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

// OAuthStore persists indigo's OAuth client state in Postgres.
type OAuthStore struct{ s *Store }

var _ oauth.ClientAuthStore = OAuthStore{}

func (s *Store) OAuth() OAuthStore { return OAuthStore{s} }

// Auth requests only live for the length of a login.
const authRequestTTL = 30 * time.Minute

func (o OAuthStore) GetSession(ctx context.Context, did syntax.DID, sessionID string) (*oauth.ClientSessionData, error) {
	data, err := o.s.q.GetOAuthSession(ctx, dbq.GetOAuthSessionParams{Did: did.String(), SessionID: sessionID})
	if err != nil {
		return nil, fmt.Errorf("oauth session: %w", noRows(err))
	}
	var sess oauth.ClientSessionData
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, err
	}
	return &sess, nil
}

func (o OAuthStore) SaveSession(ctx context.Context, sess oauth.ClientSessionData) error {
	data, err := json.Marshal(sess)
	if err != nil {
		return err
	}
	return o.s.q.SaveOAuthSession(ctx, dbq.SaveOAuthSessionParams{
		Did: sess.AccountDID.String(), SessionID: sess.SessionID, Data: data,
	})
}

func (o OAuthStore) DeleteSession(ctx context.Context, did syntax.DID, sessionID string) error {
	return o.s.q.DeleteOAuthSession(ctx, dbq.DeleteOAuthSessionParams{Did: did.String(), SessionID: sessionID})
}

func (o OAuthStore) GetAuthRequestInfo(ctx context.Context, state string) (*oauth.AuthRequestData, error) {
	data, err := o.s.q.GetOAuthRequest(ctx, dbq.GetOAuthRequestParams{
		State: state, CreatedAt: time.Now().Add(-authRequestTTL),
	})
	if err != nil {
		return nil, fmt.Errorf("oauth request: %w", noRows(err))
	}
	var info oauth.AuthRequestData
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (o OAuthStore) SaveAuthRequestInfo(ctx context.Context, info oauth.AuthRequestData) error {
	// Opportunistic cleanup of abandoned logins.
	if err := o.s.q.DeleteOAuthRequestsBefore(ctx, time.Now().Add(-authRequestTTL)); err != nil {
		return err
	}
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return o.s.q.SaveOAuthRequest(ctx, dbq.SaveOAuthRequestParams{State: info.State, Data: data})
}

func (o OAuthStore) DeleteAuthRequestInfo(ctx context.Context, state string) error {
	return o.s.q.DeleteOAuthRequest(ctx, state)
}

// WebSession links a browser cookie to an OAuth session.
type WebSession struct {
	DID       syntax.DID
	SessionID string
}

// WebSessionTTL is how long a browser session lasts. The cookie's max-age
// matches, but expiry is enforced here so a copied token stops working too.
const WebSessionTTL = 90 * 24 * time.Hour

// CreateWebSession returns a new random cookie token for an OAuth session.
func (s *Store) CreateWebSession(ctx context.Context, did syntax.DID, sessionID string) (string, error) {
	// Opportunistic cleanup of expired sessions.
	if err := s.q.DeleteWebSessionsBefore(ctx, time.Now().Add(-WebSessionTTL)); err != nil {
		return "", err
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	err := s.q.CreateWebSession(ctx, dbq.CreateWebSessionParams{Token: token, Did: did.String(), SessionID: sessionID})
	return token, err
}

// GetWebSession returns the session for a cookie token, or ErrNotFound
// if there is none or it has expired.
func (s *Store) GetWebSession(ctx context.Context, token string) (*WebSession, error) {
	r, err := s.q.GetWebSession(ctx, dbq.GetWebSessionParams{Token: token, CreatedAt: time.Now().Add(-WebSessionTTL)})
	if err != nil {
		return nil, noRows(err)
	}
	return &WebSession{DID: syntax.DID(r.Did), SessionID: r.SessionID}, nil
}

func (s *Store) DeleteWebSession(ctx context.Context, token string) error {
	return s.q.DeleteWebSession(ctx, token)
}
