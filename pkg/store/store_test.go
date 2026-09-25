package store_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/bluesky-social/indigo/atproto/auth/oauth"
	"github.com/jazware/leadsheet.fm/pkg/records"
	. "github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/jazware/leadsheet.fm/pkg/store/storetest"
)

func sheet(title, artist, content, created string) *records.Sheet {
	return &records.Sheet{Type: records.NSIDSheet, Title: title, Artist: artist, Content: content, CreatedAt: created}
}

func TestSheetsRatingsForks(t *testing.T) {
	ctx := context.Background()
	st := storetest.New(t)

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(st.UpsertSheet(ctx, "did:plc:a", "1", "cid1", sheet("Wonderwall", "Oasis",
		"{title: Wonderwall}\n[Em7]Today is [G]gonna be the day", "2026-01-01T00:00:00Z")))
	v1 := SheetURI("did:plc:a", "1")

	fork := sheet("Wonderwall (Acoustic)", "The Oasis", "[Em7]Today is gonna be the [Dsus4]day", "2026-01-02T00:00:00Z")
	fork.ForkOf = &records.StrongRef{URI: v1, CID: "cid1"}
	must(st.UpsertSheet(ctx, "did:plc:b", "2", "cid2", fork))
	v2 := SheetURI("did:plc:b", "2")

	must(st.UpsertSheet(ctx, "did:plc:b", "3", "cid3", sheet("Champagne Supernova", "Oasis", "[A]How many special people", "2026-01-03T00:00:00Z")))

	// Voicings round-trip; sheets without any read back as [].
	shaped := sheet("Shaped", "Oasis", "[C]la", "2026-01-03T00:00:00Z")
	shaped.Voicings = []records.Voicing{{Chord: "C", Frets: []int64{-1, 3, 2, 0, 1, 3}}}
	must(st.UpsertSheet(ctx, "did:plc:b", "9", "cid9", shaped))
	if got, err := st.GetSheet(ctx, SheetURI("did:plc:b", "9"), ""); err != nil || string(got.Voicings) != `[{"chord": "C", "frets": [-1, 3, 2, 0, 1, 3]}]` {
		t.Fatalf("voicings = %s, %v", got.Voicings, err)
	}
	if got, err := st.GetSheet(ctx, SheetURI("did:plc:b", "3"), ""); err != nil || string(got.Voicings) != `[]` {
		t.Fatalf("no voicings = %s, %v", got.Voicings, err)
	}
	// Links: only web links make it into the index, whoever wrote the record.
	linked := sheet("Linked", "Oasis", "[C]la", "2026-01-03T00:00:00Z")
	linked.Links = []string{"https://www.youtube.com/watch?v=abc", "javascript:alert(1)", "https://oasis.bandcamp.com/track/x"}
	must(st.UpsertSheet(ctx, "did:plc:b", "10", "cid10", linked))
	if got, err := st.GetSheet(ctx, SheetURI("did:plc:b", "10"), ""); err != nil || len(got.Links) != 2 || got.Links[1] != "https://oasis.bandcamp.com/track/x" {
		t.Fatalf("links = %v, %v", got.Links, err)
	}
	if got, _ := st.GetSheet(ctx, SheetURI("did:plc:b", "3"), ""); got.Links == nil || len(got.Links) != 0 {
		t.Fatalf("no links = %#v", got.Links)
	}
	must(st.DeleteSheet(ctx, SheetURI("did:plc:b", "10")))
	must(st.DeleteSheet(ctx, SheetURI("did:plc:b", "9")))

	// A draft: its author sees it; nobody else, nor any list, search or count.
	draft := sheet("Wonderwall (acoustic)", "Oasis", "[Em7]Today is gonna be the day", "2026-01-04T00:00:00Z")
	draft.Draft = true
	draft.ForkOf = &records.StrongRef{URI: SheetURI("did:plc:a", "1"), CID: "cid1"}
	must(st.UpsertSheet(ctx, "did:plc:c", "d1", "cidd1", draft))
	durl := SheetURI("did:plc:c", "d1")
	if _, err := st.GetSheet(ctx, durl, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("draft visible to anyone: %v", err)
	}
	if _, err := st.GetSheet(ctx, durl, "did:plc:b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("draft visible to another account: %v", err)
	}
	if got, err := st.GetSheet(ctx, durl, "did:plc:c"); err != nil || !got.Draft {
		t.Fatalf("author can't see their draft: %+v %v", got, err)
	}
	if ds, err := st.Drafts(ctx, "did:plc:c"); err != nil || len(ds) != 1 || ds[0].URI != durl {
		t.Fatalf("drafts = %+v, %v", ds, err)
	}
	if mine, _ := st.SheetsByDID(ctx, "did:plc:c"); len(mine) != 0 {
		t.Fatalf("draft in the author's public sheets: %+v", mine)
	}
	for _, q := range []string{"wonderwall", "acoustic"} {
		res, err := st.Search(ctx, q, 10)
		must(err)
		for _, r := range res {
			if r.Top.URI == durl || r.Title == "Wonderwall (acoustic)" {
				t.Fatalf("draft in search for %q: %+v", q, r)
			}
		}
	}
	if parent, _ := st.GetSheetSummary(ctx, SheetURI("did:plc:a", "1")); parent.Stats.ForkCount != 1 {
		t.Fatalf("draft counted as a fork: %d", parent.Stats.ForkCount)
	}
	// Published: it shows up like any sheet, and counts as a fork.
	draft.Draft = false
	must(st.UpsertSheet(ctx, "did:plc:c", "d1", "cidd2", draft))
	if _, err := st.GetSheet(ctx, durl, ""); err != nil {
		t.Fatalf("published draft not found: %v", err)
	}
	if parent, _ := st.GetSheetSummary(ctx, SheetURI("did:plc:a", "1")); parent.Stats.ForkCount != 2 {
		t.Fatalf("published fork not counted: %d", parent.Stats.ForkCount)
	}
	must(st.DeleteSheet(ctx, durl))

	// Same song despite the "(Acoustic)" and "The".
	song, err := st.GetSong(ctx, "oasis", "wonderwall")
	must(err)
	if len(song.Versions) != 2 {
		t.Fatalf("versions = %d, want 2", len(song.Versions))
	}

	// b rates v2 twice (newest wins), c rates it 5; a rates v1 1.
	rate := func(uri, did, subject string, v int64, at string) {
		must(st.UpsertRating(ctx, uri, did, &records.Rating{Subject: records.StrongRef{URI: subject}, Value: v, CreatedAt: at}))
	}
	rate("at://did:plc:b/fm.leadsheet.rating/1", "did:plc:b", v2, 1, "2026-02-01T00:00:00Z")
	rate("at://did:plc:b/fm.leadsheet.rating/2", "did:plc:b", v2, 4, "2026-02-02T00:00:00Z")
	rate("at://did:plc:c/fm.leadsheet.rating/1", "did:plc:c", v2, 5, "2026-02-01T00:00:00Z")
	rate("at://did:plc:a/fm.leadsheet.rating/1", "did:plc:a", v1, 1, "2026-02-01T00:00:00Z")
	must(st.UpsertFavorite(ctx, "at://did:plc:c/fm.leadsheet.favorite/1", "did:plc:c",
		&records.Favorite{Subject: records.StrongRef{URI: v2}, CreatedAt: "2026-02-01T00:00:00Z"}))

	got, err := st.GetSheet(ctx, v2, "")
	must(err)
	if got.Stats.RatingCount != 2 || got.Stats.RatingAvg != 4.5 || got.Stats.FavoriteCount != 1 {
		t.Fatalf("v2 stats = %+v", got.Stats)
	}
	orig, err := st.GetSheet(ctx, v1, "")
	must(err)
	if orig.Stats.ForkCount != 1 {
		t.Fatalf("v1 fork count = %d", orig.Stats.ForkCount)
	}

	song, err = st.GetSong(ctx, "oasis", "wonderwall")
	must(err)
	if song.Versions[0].URI != v2 || song.Versions[0].Version != 2 {
		t.Fatalf("best version = %s (ver %d), want the fork (ver 2)", song.Versions[0].URI, song.Versions[0].Version)
	}

	vs, err := st.GetViewerState(ctx, "did:plc:b", v2)
	must(err)
	if vs.Rating != 4 || len(vs.RatingURIs) != 2 {
		t.Fatalf("viewer state = %+v", vs)
	}

	// Deleting the newer rating brings back the older one.
	must(st.DeleteRating(ctx, "at://did:plc:b/fm.leadsheet.rating/2"))
	got, _ = st.GetSheet(ctx, v2, "")
	if got.Stats.RatingAvg != 3 {
		t.Fatalf("avg after delete = %v, want 3", got.Stats.RatingAvg)
	}

	// Search: by lyric prefix, and by artist; grouped into songs.
	res, err := st.Search(ctx, "gonna be the da", 10)
	must(err)
	if len(res) != 1 || res[0].VersionCount != 2 {
		t.Fatalf("lyric search = %+v", res)
	}
	if !strings.Contains(res[0].Snippet, "\x02gonna\x03") {
		t.Fatalf("snippet = %q", res[0].Snippet)
	}
	res, err = st.Search(ctx, "oasis", 10)
	must(err)
	if len(res) != 2 {
		t.Fatalf("artist search found %d songs, want 2", len(res))
	}
	// Near-miss names still find the song.
	res, err = st.Search(ctx, "wonderwal oasiss", 10)
	must(err)
	if len(res) == 0 || res[0].TitleSlug != "wonderwall" {
		t.Fatalf("fuzzy search = %+v", res)
	}
	// Spacing differences in names still match, both ways.
	must(st.UpsertSheet(ctx, "did:plc:c", "6", "cid6", sheet("Transatlanticism", "Death Cab for Cutie", "[C]The Atlantic was born today", "2026-01-06T00:00:00Z")))
	for _, q := range []string{"deathcab", "death cab", "transatlantic ism"} {
		res, err = st.Search(ctx, q, 10)
		must(err)
		if len(res) == 0 || res[0].TitleSlug != "transatlanticism" {
			t.Fatalf("search %q = %+v", q, res)
		}
	}
	// A title match outranks lyrics that repeat the word, however often.
	must(st.UpsertSheet(ctx, "did:plc:c", "4", "cid4", sheet("Something Else", "Nobody",
		strings.Repeat("[C]wonderful wonderful [G]wonderful day\n", 20), "2026-01-04T00:00:00Z")))
	must(st.UpsertSheet(ctx, "did:plc:c", "5", "cid5", sheet("Wonderful Tonight", "Eric Clapton",
		"[G]It's late in the evening", "2026-01-05T00:00:00Z")))
	res, err = st.Search(ctx, "wonderful", 10)
	must(err)
	// (Wonderwall also turns up as a near miss on the name.)
	if len(res) < 2 || res[0].TitleSlug != "wonderful-tonight" || res[0].Snippet != "" {
		t.Fatalf("title match should rank first: %+v", res)
	}
	if last := res[len(res)-1]; last.TitleSlug != "something-else" || !strings.Contains(last.Snippet, "\x02wonderful\x03") {
		t.Fatalf("lyrics-only match should rank last, with a snippet: %+v", last)
	}
	// Chord names aren't lyrics.
	res, err = st.Search(ctx, "Dsus4", 10)
	must(err)
	if len(res) != 0 {
		t.Fatalf("chord search matched %d songs", len(res))
	}

	// Hidden accounts vanish; deleting the fork updates the fork count.
	must(st.SetHidden(ctx, "did:plc:b", true))
	if _, err := st.GetSheet(ctx, v2, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("hidden sheet: err = %v", err)
	}
	// Nor are hidden accounts' forks counted, as they aren't listed.
	if orig, _ := st.GetSheet(ctx, v1, ""); orig.Stats.ForkCount != 0 {
		t.Fatalf("fork count with the forker hidden = %d", orig.Stats.ForkCount)
	}
	must(st.SetHidden(ctx, "did:plc:b", false))
	if orig, _ := st.GetSheet(ctx, v1, ""); orig.Stats.ForkCount != 1 {
		t.Fatalf("fork count with the forker back = %d", orig.Stats.ForkCount)
	}
	must(st.PurgeAccount(ctx, "did:plc:b"))
	orig, _ = st.GetSheet(ctx, v1, "")
	if orig.Stats.ForkCount != 0 {
		t.Fatalf("fork count after purge = %d", orig.Stats.ForkCount)
	}
	artist, err := st.GetArtist(ctx, "oasis")
	must(err)
	if len(artist.Songs) != 1 {
		t.Fatalf("songs after purge = %d", len(artist.Songs))
	}
}

func TestOGCards(t *testing.T) {
	ctx := context.Background()
	st := storetest.New(t)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(st.UpsertSheet(ctx, "did:plc:a", "1", "cid1", sheet("Song", "Artist", "[G]la", "2026-01-01T00:00:00Z")))
	uri := SheetURI("did:plc:a", "1")
	past := time.Now().Add(-time.Hour)

	must(st.PutOGCard(ctx, uri, "v1", []byte("png1")))
	if b, err := st.OGCard(ctx, uri, "v1", past); err != nil || string(b) != "png1" {
		t.Fatalf("fresh card = %q, %v", b, err)
	}
	if _, err := st.OGCard(ctx, uri, "v2", past); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other version: err = %v", err)
	}
	if _, err := st.OGCard(ctx, uri, "v1", time.Now().Add(time.Minute)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stale card: err = %v", err)
	}
	must(st.PutOGCard(ctx, uri, "v2", []byte("png2"))) // replaces
	if b, _ := st.OGCard(ctx, uri, "v2", past); string(b) != "png2" {
		t.Fatalf("replaced card = %q", b)
	}

	must(st.DeleteSheet(ctx, uri))
	if _, err := st.OGCard(ctx, uri, "v2", past); !errors.Is(err, ErrNotFound) {
		t.Fatal("card outlived its sheet")
	}
	must(st.UpsertSheet(ctx, "did:plc:a", "2", "cid2", sheet("Other", "Artist", "[C]la", "2026-01-01T00:00:00Z")))
	must(st.PutOGCard(ctx, SheetURI("did:plc:a", "2"), "v", []byte("png")))
	must(st.PurgeAccount(ctx, "did:plc:a"))
	if _, err := st.OGCard(ctx, SheetURI("did:plc:a", "2"), "v", past); !errors.Is(err, ErrNotFound) {
		t.Fatal("card outlived its account")
	}
}

func TestCleanup(t *testing.T) {
	ctx := context.Background()
	st := storetest.New(t)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// A live sheet with a card, and a card for a sheet that's gone.
	must(st.UpsertSheet(ctx, "did:plc:a", "1", "cid1", sheet("Song", "Artist", "[G]la", "2026-01-01T00:00:00Z")))
	live := SheetURI("did:plc:a", "1")
	must(st.PutOGCard(ctx, live, "v", []byte("png")))
	must(st.PutOGCard(ctx, SheetURI("did:plc:a", "gone"), "v", []byte("png")))
	// A browser session with its OAuth session, and an OAuth session with
	// no browser session.
	tok, err := st.CreateWebSession(ctx, "did:plc:a", "s1")
	must(err)
	o := st.OAuth()
	must(o.SaveSession(ctx, oauth.ClientSessionData{AccountDID: "did:plc:a", SessionID: "s1"}))
	must(o.SaveSession(ctx, oauth.ClientSessionData{AccountDID: "did:plc:a", SessionID: "orphan"}))

	// Now: only the orphaned card goes (the orphaned OAuth session is
	// still within its grace period).
	r, err := st.Cleanup(ctx, time.Now())
	must(err)
	if r.OGCards != 1 || r.OAuthSessions != 0 || r.WebSessions != 0 {
		t.Fatalf("cleanup now = %+v", r)
	}
	// Two hours on: the orphaned OAuth session goes too; the signed-in one stays.
	r, err = st.Cleanup(ctx, time.Now().Add(2*time.Hour))
	must(err)
	if r.OAuthSessions != 1 {
		t.Fatalf("cleanup +2h = %+v", r)
	}
	if _, err := o.GetSession(ctx, "did:plc:a", "s1"); err != nil {
		t.Fatalf("live oauth session removed: %v", err)
	}
	// A week on, the live sheet's unrequested card goes as well.
	r, err = st.Cleanup(ctx, time.Now().Add(OGCardRetention+time.Hour))
	must(err)
	if r.OGCards != 1 {
		t.Fatalf("cleanup +retention = %+v", r)
	}
	// Past the browser-session TTL: the session, then its OAuth session, go.
	r, err = st.Cleanup(ctx, time.Now().Add(WebSessionTTL+2*time.Hour))
	must(err)
	if r.WebSessions != 1 || r.OAuthSessions != 1 {
		t.Fatalf("cleanup +TTL = %+v", r)
	}
	if _, err := st.GetWebSession(ctx, tok); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired web session still there")
	}
}

func TestProfileLookupFailuresKeepWhatWeHad(t *testing.T) {
	ctx := context.Background()
	st := storetest.New(t)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(st.UpsertSheet(ctx, "did:plc:a", "1", "cid1", sheet("Wonderwall", "Oasis", "[Em7]Today", "2026-01-01T00:00:00Z")))
	author := func() Author {
		t.Helper()
		s, err := st.GetSheet(ctx, SheetURI("did:plc:a", "1"), "")
		must(err)
		return s.Author
	}
	full := Author{DID: "did:plc:a", Handle: "a.test", DisplayName: "A", Avatar: "https://cdn/a.jpg"}
	must(st.UpsertProfile(ctx, ProfileUpdate{Author: full, HandleKnown: true, ProfileKnown: true}))

	// Both lookups failed: nothing changes.
	must(st.UpsertProfile(ctx, ProfileUpdate{Author: Author{DID: "did:plc:a"}}))
	if got := author(); got != full {
		t.Fatalf("after failed lookups = %+v", got)
	}
	// The profile came back empty (no Bluesky profile) but the handle lookup failed.
	must(st.UpsertProfile(ctx, ProfileUpdate{Author: Author{DID: "did:plc:a"}, ProfileKnown: true}))
	if got := author(); got.Handle != "a.test" || got.DisplayName != "" || got.Avatar != "" {
		t.Fatalf("after an empty profile = %+v", got)
	}
}
