package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/jazware/leadsheet.fm/pkg/store/storetest"
	"github.com/labstack/echo/v4"
)

// A draft of a song nobody has published yet: its author gets it (with no
// other versions), everyone else a 404. This was a 500: the song itself
// isn't listed, and that "not found" leaked out.
func TestGetDraftOfNewSong(t *testing.T) {
	st := storetest.New(t)
	author := "did:plc:fp5zf7du5zntbwwcxkk3dppd"
	rec := &records.Sheet{Type: records.NSIDSheet, Title: "Brand New Song", Artist: "Nobody Yet", Content: "[C]la", CreatedAt: "2026-09-25T00:30:03.981Z", Draft: true}
	if err := st.UpsertSheet(context.Background(), author, "3mwcjcpajuk2y", "cid1", rec); err != nil {
		t.Fatal(err)
	}
	s := &Server{store: st}
	get := func(as string) int {
		e := echo.New()
		e.GET("/api/sheets/:actor/:rkey", func(c echo.Context) error {
			if as != "" {
				c.Set(viewerKey, &store.WebSession{DID: syntax.DID(as)})
			}
			return s.handleGetSheet(c)
		})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest("GET", "/api/sheets/"+author+"/3mwcjcpajuk2y", nil))
		return rec.Code
	}
	if code := get(author); code != http.StatusOK {
		t.Fatalf("author got %d", code)
	}
	if code := get("did:plc:someoneelse"); code != http.StatusNotFound {
		t.Fatalf("another account got %d", code)
	}
	if code := get(""); code != http.StatusNotFound {
		t.Fatalf("signed out got %d", code)
	}
}
