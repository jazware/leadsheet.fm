package ingest

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/bluesky-social/jetstream"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/jazware/leadsheet.fm/pkg/store/storetest"
)

func TestFirehoseEvents(t *testing.T) {
	ctx := context.Background()
	st := storetest.New(t)
	logger := slog.New(slog.DiscardHandler)
	f := NewFirehose(logger, st, NewIndexer(logger, st), "", "")

	commit := func(did, op, rkey string, record map[string]any) {
		t.Helper()
		ev := jetstream.Event{DID: did, Kind: jetstream.KindCommit, Commit: &jetstream.Commit{
			Operation: jetstream.Operation(op), Collection: "fm.leadsheet.sheet", Rkey: rkey, CID: "bafyreicid", Record: record,
		}}
		if err := f.handle(ctx, &ev); err != nil {
			t.Fatal(err)
		}
	}
	sheet := map[string]any{
		"$type": "fm.leadsheet.sheet", "title": "Scarborough Fair", "artist": "Traditional",
		"content": "[Em]Are you going", "createdAt": "2026-09-24T00:00:00Z", "capo": float64(3),
	}
	commit("did:plc:a", "create", "3k1", sheet)
	got, err := st.GetSheet(ctx, store.SheetURI("did:plc:a", "3k1"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Capo != 3 || got.Kind != "chords" {
		t.Fatalf("indexed sheet = %+v", got.SheetSummary)
	}

	// Records that don't match the lexicon are ignored, not errors.
	commit("did:plc:a", "create", "3k2", map[string]any{"$type": "fm.leadsheet.sheet", "title": "no artist"})
	if _, err := st.GetSheet(ctx, store.SheetURI("did:plc:a", "3k2")); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("invalid record indexed: %v", err)
	}

	// Deactivation hides, reactivation shows, deletion purges.
	account := func(active bool, status string) {
		ev := jetstream.Event{DID: "did:plc:a", Kind: jetstream.KindAccount, Account: &jetstream.Account{Active: active, Status: status}}
		if err := f.handle(ctx, &ev); err != nil {
			t.Fatal(err)
		}
	}
	account(false, "deactivated")
	if _, err := st.GetSheet(ctx, store.SheetURI("did:plc:a", "3k1")); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("deactivated account's sheet still visible")
	}
	account(true, "")
	if _, err := st.GetSheet(ctx, store.SheetURI("did:plc:a", "3k1")); err != nil {
		t.Fatalf("reactivated account's sheet hidden: %v", err)
	}
	commit("did:plc:a", "delete", "3k1", nil)
	if _, err := st.GetSheet(ctx, store.SheetURI("did:plc:a", "3k1")); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("deleted sheet still indexed")
	}
}
