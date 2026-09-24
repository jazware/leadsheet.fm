package og

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestCards(t *testing.T) {
	cases := map[string]Sheet{
		"sheet": {Title: "Wonderful Tonight", Artist: "Eric Clapton", Chords: []string{"G", "D/F#", "C", "D", "Em", "Am7"},
			Facts: "Chords, key of G", Author: "@maya.example", RatingAvg: 4.8, RatingCount: 12},
		"twoline": {Title: "I Will Follow You Into the Dark", Artist: "Death Cab for Cutie", Chords: []string{"Am", "C", "F", "G/B", "G", "E", "Am/G", "Fm", "C/G"},
			Facts: "Chords, key of Am, capo 5", Author: "@jaz.sh"},
		"long": {Title: "The Ballad of a Song With a Remarkably Long and Winding Title That Keeps Going", Artist: "Somebody & The Very Long Band Name Orchestra",
			Chords: []string{"C", "G", "Am", "F", "Dm7", "G7sus4", "Cmaj7", "E7", "A7", "Bb", "Fmaj7", "Gsus2"}, Facts: "Ukulele, key of C, capo 2", Author: "@someone.bsky.social"},
	}
	out := os.Getenv("OG_OUT") // set to look at the PNGs
	for name, s := range cases {
		b, err := SheetCard(s)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil || img.Bounds().Dx() != W || img.Bounds().Dy() != H {
			t.Fatalf("%s: bad image: %v %v", name, err, img.Bounds())
		}
		if out != "" {
			os.WriteFile(filepath.Join(out, name+".png"), b, 0o644)
		}
	}
	b, err := DefaultCard()
	if err != nil || len(b) == 0 {
		t.Fatal(err)
	}
	if out != "" {
		os.WriteFile(filepath.Join(out, "default.png"), b, 0o644)
	}
}
