package ingest

import (
	"context"
	"github.com/jazware/leadsheet.fm/pkg/httpclient"
	"log/slog"
	"time"

	"github.com/bluesky-social/indigo/atproto/atclient"
	"github.com/bluesky-social/indigo/atproto/identity"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/store"
)

const (
	profileTTL   = 24 * time.Hour
	profileBatch = 25 // app.bsky.actor.getProfiles max
)

// ProfileResolver fills in handles, display names and avatars for the
// accounts behind indexed records. Display names and avatars come from
// the account's Bluesky profile when it has one; the handle always comes
// from (verified) identity resolution.
type ProfileResolver struct {
	logger *slog.Logger
	store  *store.Store
	dir    identity.Directory
	bsky   *atclient.APIClient
}

func NewProfileResolver(logger *slog.Logger, st *store.Store, dir identity.Directory, bskyAppView string) *ProfileResolver {
	return &ProfileResolver{
		logger: logger.With("component", "profiles"),
		store:  st,
		dir:    dir,
		bsky:   httpclient.API(bskyAppView),
	}
}

// Run resolves stale profiles until ctx is cancelled.
func (r *ProfileResolver) Run(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		dids, err := r.store.StaleProfiles(ctx, time.Now().Add(-profileTTL), profileBatch)
		if err != nil && ctx.Err() == nil {
			r.logger.Error("listing stale profiles", "error", err)
		}
		if len(dids) > 0 {
			r.Resolve(ctx, dids...)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Resolve refreshes up to 25 accounts' profiles now.
func (r *ProfileResolver) Resolve(ctx context.Context, dids ...string) {
	var out struct {
		Profiles []struct {
			DID         string `json:"did"`
			DisplayName string `json:"displayName"`
			Avatar      string `json:"avatar"`
		} `json:"profiles"`
	}
	// On failure, names and avatars stay as they were rather than blanking.
	fetched := true
	if err := r.bsky.Get(ctx, "app.bsky.actor.getProfiles", map[string]any{"actors": dids}, &out); err != nil {
		r.logger.Warn("fetching bluesky profiles", "error", err)
		fetched = false
	}
	bsky := map[string]store.Author{}
	for _, p := range out.Profiles {
		bsky[p.DID] = store.Author{DisplayName: p.DisplayName, Avatar: p.Avatar}
	}

	for _, did := range dids {
		// (No Bluesky profile at all is known too: no name or avatar.)
		p := store.ProfileUpdate{Author: bsky[did], ProfileKnown: fetched}
		p.DID = did
		if parsed, err := syntax.ParseDID(did); err == nil {
			r.dir.Purge(ctx, parsed.AtIdentifier())
			if ident, err := r.dir.LookupDID(ctx, parsed); err == nil {
				// An invalid handle is known too: there isn't one to show.
				p.HandleKnown = true
				if !ident.Handle.IsInvalidHandle() {
					p.Handle = ident.Handle.String()
				}
			} else {
				r.logger.Debug("resolving identity", "did", did, "error", err)
			}
		}
		if p.Handle != "" {
			metrics.ProfilesResolved.WithLabelValues("ok").Inc()
		} else {
			metrics.ProfilesResolved.WithLabelValues("no_handle").Inc()
		}
		// Written even on failure (keeping what we had) so a broken
		// identity isn't retried every tick; it's retried after profileTTL.
		if err := r.store.UpsertProfile(ctx, p); err != nil {
			r.logger.Error("saving profile", "did", did, "error", err)
		}
	}
}
