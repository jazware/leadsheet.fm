package server

import (
	"strings"
	"testing"

	"github.com/jazware/leadsheet.fm/pkg/store"
)

func TestCardVersionTracksEdits(t *testing.T) {
	sh := &store.SheetSummary{CID: "bafyabc"}
	v1 := cardVersion(sh)
	sh.Stats.RatingCount = 3 // ratings may lag on cards
	if cardVersion(sh) != v1 {
		t.Fatal("ratings shouldn't change the card version")
	}
	sh.CID = "bafydef"
	if cardVersion(sh) == v1 {
		t.Fatal("an edit should change the card version")
	}
}

func TestPageMetaTagsEscape(t *testing.T) {
	out := pageMeta{Title: `Say "Hi" <now>`, Description: "a & b", URL: "https://x", Image: "https://x/i.png", Type: "website"}.tags()
	if strings.Contains(out, `"Hi"`) || strings.Contains(out, "<now>") || !strings.Contains(out, "a &amp; b") {
		t.Fatalf("unescaped tags:\n%s", out)
	}
}
