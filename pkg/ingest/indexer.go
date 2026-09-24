// Package ingest keeps the index in step with the network: records arrive
// from the Jetstream firehose, from a one-time backfill of every repo the
// relay knows has fm.leadsheet.* records, and from Leadsheet's own writes.
package ingest

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store"
)

// Indexer applies record operations to the store.
type Indexer struct {
	logger *slog.Logger
	store  *store.Store
}

func NewIndexer(logger *slog.Logger, st *store.Store) *Indexer {
	return &Indexer{logger: logger, store: st}
}

// Put indexes a created or updated record. Records that don't validate
// against the lexicon are skipped (logged at debug; anyone can write
// anything to their repo).
func (ix *Indexer) Put(ctx context.Context, did, collection, rkey, cid string, record any) error {
	result, err := ix.put(ctx, did, collection, rkey, cid, record)
	metrics.RecordsIndexed.WithLabelValues(collection, "put", result).Inc()
	return err
}

func (ix *Indexer) put(ctx context.Context, did, collection, rkey, cid string, record any) (string, error) {
	uri := fmt.Sprintf("at://%s/%s/%s", did, collection, rkey)
	switch collection {
	case records.NSIDSheet:
		var rec records.Sheet
		if err := records.Decode(collection, record, &rec); err != nil {
			ix.logger.Debug("skipping invalid record", "uri", uri, "error", err)
			return "invalid", nil
		}
		err := ix.store.UpsertSheet(ctx, did, rkey, cid, &rec)
		return metrics.Result(err), err
	case records.NSIDRating:
		var rec records.Rating
		if err := records.Decode(collection, record, &rec); err != nil {
			ix.logger.Debug("skipping invalid record", "uri", uri, "error", err)
			return "invalid", nil
		}
		err := ix.store.UpsertRating(ctx, uri, did, &rec)
		return metrics.Result(err), err
	case records.NSIDFavorite:
		var rec records.Favorite
		if err := records.Decode(collection, record, &rec); err != nil {
			ix.logger.Debug("skipping invalid record", "uri", uri, "error", err)
			return "invalid", nil
		}
		err := ix.store.UpsertFavorite(ctx, uri, did, &rec)
		return metrics.Result(err), err
	}
	return "unknown", nil
}

// Delete removes a record from the index.
func (ix *Indexer) Delete(ctx context.Context, did, collection, rkey string) error {
	err := ix.delete(ctx, did, collection, rkey)
	metrics.RecordsIndexed.WithLabelValues(collection, "delete", metrics.Result(err)).Inc()
	return err
}

func (ix *Indexer) delete(ctx context.Context, did, collection, rkey string) error {
	uri := fmt.Sprintf("at://%s/%s/%s", did, collection, rkey)
	switch collection {
	case records.NSIDSheet:
		return ix.store.DeleteSheet(ctx, uri)
	case records.NSIDRating:
		return ix.store.DeleteRating(ctx, uri)
	case records.NSIDFavorite:
		return ix.store.DeleteFavorite(ctx, uri)
	}
	return nil
}
