package ingest

import (
	"context"
	"errors"
	"github.com/jazware/leadsheet.fm/pkg/tracing"
	"go.opentelemetry.io/otel/attribute"
	"log/slog"
	"strconv"
	"time"

	"github.com/bluesky-social/jetstream"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store"
)

const (
	cursorState = "jetstream_cursor"
	// How often the cursor is persisted; replaying a few seconds after a
	// crash is harmless since every write is idempotent.
	cursorSaveInterval = 5 * time.Second
)

// Firehose follows Jetstream for fm.leadsheet.* records.
type Firehose struct {
	logger  *slog.Logger
	store   *store.Store
	indexer *Indexer
	host    string
	// With an API key, Jetstream can replay its full archive, so a
	// restart after any downtime resumes exactly and the first run needs
	// no relay backfill. Without one, only the live tail (and its
	// lookback window) is available.
	apiKey string
}

func NewFirehose(logger *slog.Logger, st *store.Store, ix *Indexer, host, apiKey string) *Firehose {
	return &Firehose{logger: logger.With("component", "firehose"), store: st, indexer: ix, host: host, apiKey: apiKey}
}

// CanReplay reports whether the firehose can replay history itself.
func (f *Firehose) CanReplay() bool { return f.apiKey != "" }

// Run consumes events until ctx is cancelled, reconnecting on failure.
func (f *Firehose) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		start := time.Now()
		err := f.consume(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(start) > time.Minute {
			backoff = time.Second
		}
		f.logger.Warn("jetstream stream ended; reconnecting", "error", err, "backoff", backoff)
		metrics.FirehoseReconnects.Inc()
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, time.Minute)
	}
}

func (f *Firehose) consume(ctx context.Context) error {
	saved, err := f.store.State(ctx, cursorState)
	if err != nil {
		return err
	}
	cursor, _ := strconv.ParseUint(saved, 10, 64)

	opts := []jetstream.Option{
		jetstream.WithCollections([]string{"fm.leadsheet.*"}),
		jetstream.WithKinds([]jetstream.Kind{jetstream.KindCommit, jetstream.KindAccount, jetstream.KindIdentity}),
		jetstream.WithLogger(f.logger),
	}
	if f.apiKey != "" {
		opts = append(opts, jetstream.WithAPIKey(f.apiKey), jetstream.WithAfterSeq(cursor))
	} else if cursor > 0 {
		opts = append(opts, jetstream.WithLiveCursor(cursor))
	}
	client, err := jetstream.Subscribe(f.host, opts...)
	if err != nil {
		return err
	}
	defer client.Close()
	f.logger.Info("following jetstream", "host", f.host, "cursor", cursor, "replay", f.apiKey != "")

	lastSave := time.Now()
	for batch, err := range client.Events(ctx) {
		if err != nil {
			if errors.Is(err, jetstream.ErrFatal) {
				return err
			}
			f.logger.Warn("jetstream error", "error", err)
			continue
		}
		for _, ev := range batch.Events() {
			if err := f.handle(ctx, &ev); err != nil {
				// A store error here is a local problem (disk, locking);
				// stop and resume from the saved cursor rather than skip.
				return err
			}
		}
		if last := batch.LastCursor(); last > cursor {
			cursor = last
			if time.Since(lastSave) > cursorSaveInterval {
				if err := f.store.SetState(ctx, cursorState, strconv.FormatUint(cursor, 10)); err != nil {
					return err
				}
				lastSave = time.Now()
			}
		}
	}
	// Save progress on the way out (ctx may be cancelled, so detach).
	if cursor > 0 {
		saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := f.store.SetState(saveCtx, cursorState, strconv.FormatUint(cursor, 10)); err != nil {
			f.logger.Error("saving jetstream cursor", "error", err)
		}
	}
	return ctx.Err()
}

func (f *Firehose) handle(ctx context.Context, ev *jetstream.Event) error {
	if ev.TimeUS > 0 {
		metrics.FirehoseLastEvent.Set(float64(ev.TimeUS) / 1e6)
	}
	switch ev.Kind {
	case jetstream.KindCommit:
		c := ev.Commit
		if !isLeadsheet(c.Collection) {
			return nil
		}
		f.logger.Debug("commit", "did", ev.DID, "op", c.Operation, "collection", c.Collection, "rkey", c.Rkey)
		metrics.FirehoseEvents.WithLabelValues("commit", c.Collection, string(c.Operation)).Inc()
		// A trace per Leadsheet record. (Not the account and identity
		// events: those come for the whole network.)
		ctx, span := tracing.Start(ctx, "jetstream.commit", attribute.String("did", ev.DID),
			attribute.String("collection", c.Collection), attribute.String("operation", string(c.Operation)),
			attribute.String("rkey", c.Rkey))
		var err error
		if c.Operation == jetstream.OpDelete {
			err = f.indexer.Delete(ctx, ev.DID, c.Collection, c.Rkey)
		} else {
			err = f.indexer.Put(ctx, ev.DID, c.Collection, c.Rkey, c.CID, c.Record)
		}
		tracing.End(span, err)
		return err
	case jetstream.KindAccount:
		metrics.FirehoseEvents.WithLabelValues("account", "", "").Inc()
		a := ev.Account
		switch {
		case a.Active:
			return f.store.SetHidden(ctx, ev.DID, false)
		case a.Status == "deleted":
			return f.store.PurgeAccount(ctx, ev.DID)
		default:
			return f.store.SetHidden(ctx, ev.DID, true)
		}
	case jetstream.KindIdentity:
		metrics.FirehoseEvents.WithLabelValues("identity", "", "").Inc()
		return f.store.MarkProfileStale(ctx, ev.DID)
	}
	return nil
}

func isLeadsheet(collection string) bool {
	for _, c := range records.Collections {
		if c == collection {
			return true
		}
	}
	return false
}
