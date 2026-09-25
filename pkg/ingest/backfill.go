package ingest

import (
	"context"
	"errors"
	"fmt"
	"github.com/jazware/leadsheet.fm/pkg/httpclient"
	"log/slog"
	"strings"
	"sync"

	"github.com/bluesky-social/indigo/atproto/atclient"
	"github.com/bluesky-social/indigo/atproto/identity"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store"
)

const backfillState = "backfill_done"

// Backfiller indexes every existing fm.leadsheet.* record: it asks the
// relay which repos have any, then lists them from each repo's PDS.
type Backfiller struct {
	logger  *slog.Logger
	store   *store.Store
	indexer *Indexer
	dir     identity.Directory
	relay   string
}

func NewBackfiller(logger *slog.Logger, st *store.Store, ix *Indexer, dir identity.Directory, relay string) *Backfiller {
	return &Backfiller{logger: logger.With("component", "backfill"), store: st, indexer: ix, dir: dir, relay: relay}
}

// RunOnce backfills unless a previous run finished (or force is set).
// Runs alongside the firehose; both write idempotently.
func (b *Backfiller) RunOnce(ctx context.Context, force bool) error {
	if !force {
		done, err := b.store.State(ctx, backfillState)
		if err != nil || done != "" {
			return err
		}
	}
	dids, err := b.listRepos(ctx)
	if err != nil {
		return err
	}
	b.logger.Info("backfilling", "repos", len(dids))

	var (
		wg     sync.WaitGroup
		sem    = make(chan struct{}, 8)
		mu     sync.Mutex
		failed int
	)
	for _, did := range dids {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			err := b.BackfillRepo(ctx, did)
			if gone(err) {
				// Deleted, deactivated or taken down since the relay listed
				// it: nothing to index, and not a failure.
				metrics.BackfillRepos.WithLabelValues("gone").Inc()
				return
			}
			metrics.BackfillRepos.WithLabelValues(metrics.Result(err)).Inc()
			if err != nil {
				b.logger.Warn("backfilling repo", "did", did, "error", err)
				mu.Lock()
				failed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	b.logger.Info("backfill done", "repos", len(dids), "failed", failed)
	// Individual repos failing (PDS down, account gone) shouldn't make
	// every restart retry the whole network.
	return b.store.SetState(ctx, backfillState, "1")
}

// listRepos returns every DID the relay has indexed with any Leadsheet collection.
func (b *Backfiller) listRepos(ctx context.Context) ([]string, error) {
	client := httpclient.API(b.relay)
	seen := map[string]bool{}
	var dids []string
	for _, collection := range records.Collections {
		cursor := ""
		for {
			var out struct {
				Cursor string `json:"cursor"`
				Repos  []struct {
					DID string `json:"did"`
				} `json:"repos"`
			}
			params := map[string]any{"collection": collection, "limit": 1000}
			if cursor != "" {
				params["cursor"] = cursor
			}
			if err := client.Get(ctx, "com.atproto.sync.listReposByCollection", params, &out); err != nil {
				return nil, fmt.Errorf("listing repos with %s: %w", collection, err)
			}
			for _, r := range out.Repos {
				if !seen[r.DID] {
					seen[r.DID] = true
					dids = append(dids, r.DID)
				}
			}
			if out.Cursor == "" || len(out.Repos) == 0 {
				break
			}
			cursor = out.Cursor
		}
	}
	return dids, nil
}

// BackfillRepo indexes every Leadsheet record in one repo.
func (b *Backfiller) BackfillRepo(ctx context.Context, did string) error {
	parsed, err := syntax.ParseDID(did)
	if err != nil {
		return err
	}
	ident, err := b.dir.LookupDID(ctx, parsed)
	if err != nil {
		return fmt.Errorf("resolving: %w", err)
	}
	pds := ident.PDSEndpoint()
	if pds == "" {
		return fmt.Errorf("no PDS in DID document")
	}
	client := httpclient.PDS(pds)
	for _, collection := range records.Collections {
		cursor := ""
		for {
			var out struct {
				Cursor  string `json:"cursor"`
				Records []struct {
					URI   string         `json:"uri"`
					CID   string         `json:"cid"`
					Value map[string]any `json:"value"`
				} `json:"records"`
			}
			params := map[string]any{"repo": did, "collection": collection, "limit": 100}
			if cursor != "" {
				params["cursor"] = cursor
			}
			if err := client.Get(ctx, "com.atproto.repo.listRecords", params, &out); err != nil {
				return fmt.Errorf("listing %s: %w", collection, err)
			}
			for _, r := range out.Records {
				rkey := r.URI[strings.LastIndex(r.URI, "/")+1:]
				if err := b.indexer.Put(ctx, did, collection, rkey, r.CID, r.Value); err != nil {
					return err
				}
			}
			if out.Cursor == "" || len(out.Records) == 0 {
				break
			}
			cursor = out.Cursor
		}
	}
	return nil
}

// gone reports whether a PDS said the repo isn't there to read. XRPC
// sends these as 400s named in the body, not as 404s.
func gone(err error) bool {
	var apiErr *atclient.APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	switch apiErr.Name {
	case "RepoNotFound", "RepoDeactivated", "RepoTakendown", "RepoSuspended":
		return true
	}
	return false
}
