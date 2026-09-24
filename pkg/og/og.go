// Package og draws the 1200×630 link-preview ("Open Graph") images:
// one per sheet, and a default card for everything else. Cards show a
// sheet's title, artist, chords and facts, never its lyrics.
package og

import (
	"bytes"
	"embed"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

// Nunito (SIL OFL 1.1, see fonts/OFL.txt), instanced from the variable
// font at the weights used here.
//
//go:embed fonts/*.ttf
var fontFS embed.FS

const (
	W = 1200
	H = 630
	// Content inset from every edge.
	margin = 72
)

// The app's "Midnight & marigold" night palette.
var (
	bg    = color.RGBA{0x0F, 0x16, 0x26, 0xFF}
	ink   = color.RGBA{0xF4, 0xF1, 0xEA, 0xFF}
	soft  = color.RGBA{0xA9, 0xB3, 0xC9, 0xFF}
	chord = color.RGBA{0xFF, 0xC8, 0x57, 0xFF}
)

var (
	fontsOnce              sync.Once
	fontsErr               error
	black, extraBold, bold *opentype.Font
)

func loadFonts() error {
	fontsOnce.Do(func() {
		load := func(name string) *opentype.Font {
			if fontsErr != nil {
				return nil
			}
			b, err := fontFS.ReadFile("fonts/" + name)
			if err != nil {
				fontsErr = err
				return nil
			}
			f, err := opentype.Parse(b)
			if err != nil {
				fontsErr = fmt.Errorf("parsing %s: %w", name, err)
			}
			return f
		}
		black = load("Nunito-Black.ttf")
		extraBold = load("Nunito-ExtraBold.ttf")
		bold = load("Nunito-Bold.ttf")
	})
	return fontsErr
}

func face(f *opentype.Font, size float64) font.Face {
	fc, err := opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		panic(err) // only fails on invalid options
	}
	return fc
}

// Sheet is what a sheet's card shows.
type Sheet struct {
	Title  string
	Artist string
	// Distinct chords in order of first use.
	Chords []string
	// e.g. "Chords, key of Am, capo 5"
	Facts string
	// "@handle" of the author.
	Author string
	// 0 when unrated.
	RatingAvg   float64
	RatingCount int
}

type canvas struct {
	img *image.RGBA
}

func newCanvas() *canvas {
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	draw.Draw(img, img.Bounds(), image.NewUniform(bg), image.Point{}, draw.Src)
	return &canvas{img: img}
}

func (c *canvas) text(fc font.Face, col color.Color, x, baseline int, s string) int {
	d := &font.Drawer{Dst: c.img, Src: image.NewUniform(col), Face: fc,
		Dot: fixed.P(x, baseline)}
	d.DrawString(s)
	return d.Dot.X.Round()
}

func width(fc font.Face, s string) int {
	return font.MeasureString(fc, s).Round()
}

// sparkle fills the four-point star from the logo, centered at (cx, cy)
// with radius r.
func (c *canvas) sparkle(cx, cy, r float32, col color.Color) {
	z := vector.NewRasterizer(W, H)
	// Same curve as the SVG mark: points at ±r, pinched toward the center.
	k := r * 0.28
	z.MoveTo(cx, cy-r)
	z.CubeTo(cx+k*0.28, cy-k, cx+k, cy-k*0.28, cx+r, cy)
	z.CubeTo(cx+k, cy+k*0.28, cx+k*0.28, cy+k, cx, cy+r)
	z.CubeTo(cx-k*0.28, cy+k, cx-k, cy+k*0.28, cx-r, cy)
	z.CubeTo(cx-k, cy-k*0.28, cx-k*0.28, cy-k, cx, cy-r)
	z.ClosePath()
	z.Draw(c.img, c.img.Bounds(), image.NewUniform(col), image.Point{})
}

// star fills a five-point star (for ratings) inside a box of size s.
func (c *canvas) star(x, y, s float32, col color.Color) {
	z := vector.NewRasterizer(W, H)
	pts := [10][2]float32{
		{0.5, 0.02}, {0.62, 0.36}, {0.98, 0.37}, {0.69, 0.59}, {0.8, 0.95},
		{0.5, 0.74}, {0.2, 0.95}, {0.31, 0.59}, {0.02, 0.37}, {0.38, 0.36},
	}
	for i, p := range pts {
		px, py := x+p[0]*s, y+p[1]*s
		if i == 0 {
			z.MoveTo(px, py)
		} else {
			z.LineTo(px, py)
		}
	}
	z.ClosePath()
	z.Draw(c.img, c.img.Bounds(), image.NewUniform(col), image.Point{})
}

// wordmark draws "leadsheet ✦" at the top left.
func (c *canvas) wordmark() {
	fc := face(black, 40)
	end := c.text(fc, ink, margin, margin+30, "leadsheet")
	c.sparkle(float32(end+22), float32(margin+16), 14, chord)
}

// wrap breaks s into at most maxLines lines no wider than w, ending the
// last line with "…" if it had to cut.
func wrap(fc font.Face, s string, w, maxLines int) []string {
	words := strings.Fields(s)
	var lines []string
	cur := ""
	for i, word := range words {
		try := strings.TrimSpace(cur + " " + word)
		if width(fc, try) <= w || cur == "" {
			cur = try
			continue
		}
		lines = append(lines, cur)
		cur = word
		if len(lines) == maxLines {
			// More words remain: end the last line with an ellipsis.
			_ = i
			last := lines[maxLines-1]
			for width(fc, last+"…") > w && len(last) > 0 {
				last = strings.TrimRight(last[:len(last)-1], " ")
			}
			lines[maxLines-1] = last + "…"
			return lines
		}
	}
	if cur != "" {
		lines = append(lines, cur)
	}
	// A single word too wide for the line: trim it.
	for i, l := range lines {
		for width(fc, l) > w && len(l) > 1 {
			l = l[:len(l)-1]
			lines[i] = l + "…"
		}
	}
	return lines
}

func (c *canvas) png() ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, c.img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// SheetCard draws a sheet's preview image.
func SheetCard(s Sheet) ([]byte, error) {
	if err := loadFonts(); err != nil {
		return nil, err
	}
	c := newCanvas()
	c.wordmark()
	inner := W - 2*margin

	// Title: as big as fits in two lines with the artist below it and
	// still clear of the chord row.
	const (
		titleTop      = margin + 30 + 56 // below the wordmark
		chordBaseline = H - margin - 84
		artistLimit   = chordBaseline - 58 - 30 // chord cap height and a gap
	)
	artistFace := face(extraBold, 44)
	var titleFace font.Face
	var lines []string
	var size float64
	baselines := func(n int, size float64) (first, artist int) {
		first = titleTop + int(size*0.78)
		last := first + int(float64(n-1)*size*1.08)
		return first, last + 64
	}
	for size = 96; size >= 52; size -= 4 {
		titleFace = face(black, size)
		lines = wrap(titleFace, s.Title, inner, 2)
		truncated := strings.HasSuffix(lines[len(lines)-1], "…")
		if _, artist := baselines(len(lines), size); artist <= artistLimit && !truncated {
			break
		}
	}
	y, artistY := baselines(len(lines), size)
	for _, l := range lines {
		c.text(titleFace, ink, margin, y, l)
		y += int(size * 1.08)
	}
	if artist := wrap(artistFace, s.Artist, inner, 1); len(artist) > 0 {
		c.text(artistFace, soft, margin, artistY, artist[0])
	}

	// Chords, as many as fit on one line.
	chordFace := face(black, 58)
	x, cy := margin, chordBaseline
	for i, ch := range s.Chords {
		w := width(chordFace, ch)
		if x+w > margin+inner {
			break
		}
		if i > 0 && x+w+width(chordFace, "  …") > margin+inner && i < len(s.Chords)-1 {
			c.text(chordFace, chord, x, cy, "…")
			break
		}
		c.text(chordFace, chord, x, cy, ch)
		x += w + 44
	}

	// Facts and author on the left, rating on the right.
	metaFace := face(bold, 32)
	meta := s.Facts
	if s.Author != "" {
		if meta != "" {
			meta += ", "
		}
		meta += "by " + s.Author
	}
	right := margin + inner
	if s.RatingCount > 0 {
		r := fmt.Sprintf("%.1f (%d)", s.RatingAvg, s.RatingCount)
		rw := width(metaFace, r)
		c.text(metaFace, ink, right-rw, H-margin, r)
		c.star(float32(right-rw-40), float32(H-margin-28), 30, chord)
		right -= rw + 56
	}
	if m := wrap(metaFace, meta, right-margin, 1); len(m) > 0 {
		c.text(metaFace, soft, margin, H-margin, m[0])
	}
	return c.png()
}

var (
	defaultOnce sync.Once
	defaultPNG  []byte
	defaultErr  error
)

// DefaultCard is the site-wide preview image.
func DefaultCard() ([]byte, error) {
	defaultOnce.Do(func() {
		if defaultErr = loadFonts(); defaultErr != nil {
			return
		}
		c := newCanvas()
		big := face(black, 132)
		end := c.text(big, ink, margin, 300, "leadsheet")
		c.sparkle(float32(end+60), 250, 44, chord)
		c.text(face(extraBold, 46), soft, margin+6, 380, "Chord sheets, shared on atproto")
		fc := face(black, 64)
		x := margin
		for _, ch := range []string{"G", "C", "Em", "D"} {
			c.text(fc, chord, x, H-margin-10, ch)
			x += width(fc, ch) + 56
		}
		c.sparkle(W-margin-40, margin+40, 26, ink)
		c.sparkle(W-margin-150, H-margin-40, 16, soft)
		defaultPNG, defaultErr = c.png()
	})
	return defaultPNG, defaultErr
}
