package store

import (
	"context"
	"fmt"
	"time"
)

// Cleanup retention. Everything here is either re-creatable (cards) or
// dead (expired or orphaned sessions).
const (
	// A card not re-rendered in this long hasn't been requested (they're
	// redrawn hourly while in use); it's drawn again on demand.
	OGCardRetention = 7 * 24 * time.Hour
	// Unfinished sign-ins, matching the OAuth store's own TTL.
	oauthRequestRetention = authRequestTTL
	// Grace before an OAuth session with no browser session is removed,
	// covering the moment between the two during a sign-in.
	orphanOAuthGrace = time.Hour
)

// CleanupResult counts what one Cleanup removed.
type CleanupResult struct {
	OGCards, WebSessions, OAuthRequests, OAuthSessions, SheetStats int64
}

func (r CleanupResult) Total() int64 {
	return r.OGCards + r.WebSessions + r.OAuthRequests + r.OAuthSessions + r.SheetStats
}

// Cleanup deletes stale cards, expired and orphaned sessions, and stats
// for sheets that no longer exist.
func (s *Store) Cleanup(ctx context.Context, now time.Time) (CleanupResult, error) {
	var r CleanupResult
	var err error
	// Web sessions first, so the OAuth sessions they held are orphans below.
	if r.WebSessions, err = s.q.CleanWebSessions(ctx, now.Add(-WebSessionTTL)); err != nil {
		return r, fmt.Errorf("cleaning web sessions: %w", err)
	}
	if r.OAuthSessions, err = s.q.CleanOAuthSessions(ctx, now.Add(-orphanOAuthGrace)); err != nil {
		return r, fmt.Errorf("cleaning oauth sessions: %w", err)
	}
	if r.OAuthRequests, err = s.q.CleanOAuthRequests(ctx, now.Add(-oauthRequestRetention)); err != nil {
		return r, fmt.Errorf("cleaning oauth requests: %w", err)
	}
	if r.OGCards, err = s.q.CleanOGCards(ctx, now.Add(-OGCardRetention)); err != nil {
		return r, fmt.Errorf("cleaning og cards: %w", err)
	}
	if r.SheetStats, err = s.q.CleanSheetStats(ctx); err != nil {
		return r, fmt.Errorf("cleaning sheet stats: %w", err)
	}
	return r, nil
}
