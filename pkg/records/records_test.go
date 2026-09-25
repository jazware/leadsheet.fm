package records

import (
	"strings"
	"testing"
)

func TestValidateSheet(t *testing.T) {
	capo := int64(2)
	good := Sheet{
		Type:      NSIDSheet,
		Title:     "Wonderwall",
		Artist:    "Oasis",
		Content:   "[Em7]Today is [G]gonna be the day",
		Capo:      &capo,
		CreatedAt: "2026-09-24T12:00:00Z",
		ForkOf:    &StrongRef{URI: "at://did:plc:abc/fm.leadsheet.sheet/3kabc", CID: "bafyreicvah4f5bmfcaao4z6f77g3yznj3dxrxbnw6olduc6ienkj3wbjhi"},
	}
	if err := Validate(NSIDSheet, good); err != nil {
		t.Fatalf("valid sheet rejected: %v", err)
	}

	withShapes := good
	withShapes.Voicings = []Voicing{{Chord: "Em7", Frets: []int64{0, 2, 2, 0, 3, 3}}, {Chord: "G", Frets: []int64{3, 2, 0, 0, -1, 3}}}
	if err := Validate(NSIDSheet, withShapes); err != nil {
		t.Fatalf("sheet with voicings rejected: %v", err)
	}
	for _, frets := range [][]int64{{}, {0, 2, 2, 0, 25, 3}, {-2, 2, 2, 0, 3, 3}} {
		withShapes.Voicings = []Voicing{{Chord: "Em7", Frets: frets}}
		if err := Validate(NSIDSheet, withShapes); err == nil {
			t.Fatalf("voicing %v accepted", frets)
		}
	}
	// A raw record from Jetstream decodes its voicings.
	raw := map[string]any{
		"$type": NSIDSheet, "title": "Song", "artist": "Artist", "content": "[C]la",
		"createdAt": "2026-09-24T12:00:00.000Z",
		"voicings":  []any{map[string]any{"chord": "C", "frets": []any{float64(-1), float64(3), float64(2), float64(0), float64(1), float64(0)}}},
	}
	var s Sheet
	if err := Decode(NSIDSheet, raw, &s); err != nil {
		t.Fatalf("decoding sheet with voicings: %v", err)
	}
	if len(s.Voicings) != 1 || s.Voicings[0].Chord != "C" || s.Voicings[0].Frets[0] != -1 {
		t.Fatalf("voicings = %+v", s.Voicings)
	}

	bad := good
	tooHigh := int64(20)
	bad.Capo = &tooHigh
	if err := Validate(NSIDSheet, bad); err == nil {
		t.Fatal("capo 20 accepted")
	}

	// Raw maps as they arrive from Jetstream (numbers as float64).
	raw = map[string]any{
		"$type":     NSIDRating,
		"subject":   map[string]any{"uri": "at://did:plc:abc/fm.leadsheet.sheet/3kabc", "cid": "bafyreicvah4f5bmfcaao4z6f77g3yznj3dxrxbnw6olduc6ienkj3wbjhi"},
		"value":     float64(4),
		"createdAt": "2026-09-24T12:00:00.000Z",
	}
	var r Rating
	if err := Decode(NSIDRating, raw, &r); err != nil {
		t.Fatalf("decoding rating: %v", err)
	}
	if r.Value != 4 {
		t.Fatalf("value = %d", r.Value)
	}
	raw["value"] = float64(6)
	if err := Validate(NSIDRating, raw); err == nil {
		t.Fatal("rating 6 accepted")
	}
}

func TestSlugs(t *testing.T) {
	cases := []struct {
		fn       func(string) string
		in, want string
	}{
		{ArtistSlug, "The Beatles", "beatles"},
		{ArtistSlug, "Beyoncé feat. Jay-Z", "beyonce"},
		{ArtistSlug, "Simon & Garfunkel", "simon-and-garfunkel"},
		{ArtistSlug, "The The", "the"},
		{TitleSlug, "Hey Jude - Remastered 2015", "hey-jude"},
		{TitleSlug, "Creep (Acoustic)", "creep"},
		{TitleSlug, "Stay (feat. Justin Bieber)", "stay"},
		{TitleSlug, "Live Forever", "live-forever"},
		{TitleSlug, "!!!", "untitled"},
	}
	for _, c := range cases {
		if got := c.fn(c.in); got != c.want {
			t.Errorf("slug(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestChordNames(t *testing.T) {
	got := ChordNames("[Intro]\n[G] [D/F#] [G]\n[Verse 1]\nA [C]line with [Em7]chords [G]\n{start_of_tab}\n[A]ignored\n{end_of_tab}\n[Bridge]\n[Cadd9]end [x2]")
	want := []string{"G", "D/F#", "C", "Em7", "Cadd9"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("ChordNames = %v, want %v", got, want)
	}
}

func TestWebLink(t *testing.T) {
	for link, want := range map[string]bool{
		"https://www.youtube.com/watch?v=abc":        true,
		"http://example.bandcamp.com/track/a-song":   true,
		"javascript:alert(1)":                        false,
		"data:text/html,hi":                          false,
		"https://":                                   false,
		"youtube.com/watch?v=abc":                    false,
		"  https://soundcloud.com/someone/some-song": false, // callers trim first
	} {
		if got := WebLink(link); got != want {
			t.Errorf("WebLink(%q) = %v", link, got)
		}
	}
}
