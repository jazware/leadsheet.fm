package server

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"html"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/og"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/labstack/echo/v4"
)

const (
	siteName        = "Leadsheet"
	siteDescription = "Chord sheets and tabs written by players, shared on atproto. Each one lives in its author's own account."
)

// pageMeta is a page's title and link-preview details.
type pageMeta struct {
	Title       string
	Description string
	// Absolute URLs.
	URL      string
	Image    string
	ImageAlt string
	// "website" or "article".
	Type string
}

func (m pageMeta) tags() string {
	a := html.EscapeString
	var b strings.Builder
	fmt.Fprintf(&b, "<title>%s</title>\n", a(m.Title))
	fmt.Fprintf(&b, `<meta name="description" content="%s">`+"\n", a(m.Description))
	fmt.Fprintf(&b, `<link rel="canonical" href="%s">`+"\n", a(m.URL))
	for _, kv := range [][2]string{
		{"og:site_name", siteName},
		{"og:type", m.Type},
		{"og:title", m.Title},
		{"og:description", m.Description},
		{"og:url", m.URL},
		{"og:image", m.Image},
		{"og:image:width", fmt.Sprint(og.W)},
		{"og:image:height", fmt.Sprint(og.H)},
		{"og:image:alt", m.ImageAlt},
	} {
		fmt.Fprintf(&b, `<meta property="%s" content="%s">`+"\n", kv[0], a(kv[1]))
	}
	for _, kv := range [][2]string{
		{"twitter:card", "summary_large_image"},
		{"twitter:title", m.Title},
		{"twitter:description", m.Description},
		{"twitter:image", m.Image},
	} {
		fmt.Fprintf(&b, `<meta name="%s" content="%s">`+"\n", kv[0], a(kv[1]))
	}
	return b.String()
}

var kindNoun = map[string]string{
	"chords":  "chords",
	"tab":     "tab",
	"ukulele": "ukulele chords",
	"bass":    "bass tab",
}

// pageMeta works out a client route's title and preview. Anything it
// can't resolve falls back to the site-wide card.
func (s *Server) pageMeta(c echo.Context, path string) pageMeta {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 3*time.Second)
	defer cancel()
	m := pageMeta{
		Title:       siteName,
		Description: siteDescription,
		URL:         s.publicURL + path,
		Image:       s.publicURL + "/og/default.png",
		ImageAlt:    "Leadsheet: chord sheets, shared on atproto",
		Type:        "website",
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if u, err := url.PathUnescape(p); err == nil {
			parts[i] = u
		}
	}

	switch {
	case len(parts) >= 3 && parts[0] == "sheet":
		did, err := s.resolveActor(ctx, parts[1])
		if err != nil {
			return m
		}
		sh, err := s.store.GetSheet(ctx, store.SheetURI(did, parts[2]), "") // no previews of drafts
		if err != nil {
			return m
		}
		noun := kindNoun[sh.Kind]
		if noun == "" {
			noun = "chords"
		}
		m.Title = fmt.Sprintf("%s %s by %s | %s", sh.Title, noun, sh.Artist, siteName)
		desc := fmt.Sprintf("%s for %s by %s", strings.ToUpper(noun[:1])+noun[1:], sh.Title, sh.Artist)
		if sh.Key != "" {
			desc += ", key of " + sh.Key
		}
		if sh.Capo > 0 {
			desc += fmt.Sprintf(", capo %d", sh.Capo)
		}
		desc += ". By @" + handleOrDID(sh.Author)
		if sh.Stats.RatingCount > 0 {
			desc += fmt.Sprintf(", rated %.1f from %d %s", sh.Stats.RatingAvg, sh.Stats.RatingCount, plural(sh.Stats.RatingCount, "rating"))
		}
		m.Description = desc + "."
		m.Image = fmt.Sprintf("%s/og/sheet/%s/%s.png?v=%s", s.publicURL, sh.DID, sh.Rkey, cardVersion(&sh.SheetSummary))
		m.ImageAlt = fmt.Sprintf("%s by %s: %s", sh.Title, sh.Artist, strings.Join(records.ChordNames(sh.Content), " "))
		m.Type = "article"
	case len(parts) == 3 && parts[0] == "songs":
		song, err := s.store.GetSong(ctx, parts[1], parts[2])
		if err != nil {
			return m
		}
		n := len(song.Versions)
		m.Title = fmt.Sprintf("%s by %s | %s", song.Title, song.Artist, siteName)
		m.Description = fmt.Sprintf("%d %s of %s by %s on Leadsheet: chords, tabs and ratings from players.",
			n, plural(n, "version"), song.Title, song.Artist)
	case len(parts) == 2 && parts[0] == "artists":
		a, err := s.store.GetArtist(ctx, parts[1])
		if err != nil {
			return m
		}
		m.Title = fmt.Sprintf("%s | %s", a.Name, siteName)
		m.Description = fmt.Sprintf("Chords and tabs for %d %s by %s on Leadsheet.", len(a.Songs), plural(len(a.Songs), "song"), a.Name)
	case len(parts) == 2 && parts[0] == "u":
		did, err := s.resolveActor(ctx, parts[1])
		if err != nil {
			return m
		}
		a, err := s.store.GetAuthor(ctx, did)
		if err != nil {
			return m
		}
		name := a.DisplayName
		if name == "" {
			name = "@" + handleOrDID(*a)
		}
		sheets, _ := s.store.SheetsByDID(ctx, did)
		m.Title = fmt.Sprintf("%s (@%s) | %s", name, handleOrDID(*a), siteName)
		m.Description = fmt.Sprintf("%d chord %s by %s on Leadsheet.", len(sheets), plural(len(sheets), "sheet"), name)
		m.Type = "profile"
	case len(parts) == 1 && parts[0] == "import":
		m.Title = "Import from Ultimate Guitar | " + siteName
	case len(parts) == 1 && parts[0] == "new":
		m.Title = "New sheet | " + siteName
	}
	return m
}

func handleOrDID(a store.Author) string {
	if a.Handle != "" {
		return a.Handle
	}
	return a.DID
}

func plural(n int, word string) string {
	if n == 1 {
		return word
	}
	return word + "s"
}

// cardVersion changes when the sheet's record does (title, chords, key…).
// Pages link the card with it as ?v=, so downstream caches refetch after
// an edit. The rating on a card is allowed to lag.
func cardVersion(sh *store.SheetSummary) string {
	h := fnv.New64a()
	h.Write([]byte(sh.CID))
	return strconv.FormatUint(h.Sum64(), 36)
}

const (
	// Stored cards are redrawn after this, so the rating on them is at
	// most this stale from here (edits get a new card right away).
	ogCardTTL = time.Hour
	// Browsers, Cloudflare and link-card fetchers may keep a card for a
	// day: its URL changes when the sheet is edited.
	ogMaxAge = 24 * time.Hour
)

func servePNG(c echo.Context, b []byte) error {
	c.Response().Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", int(ogMaxAge.Seconds())))
	return c.Blob(http.StatusOK, "image/png", b)
}

func (s *Server) handleOGDefault(c echo.Context) error {
	b, err := og.DefaultCard()
	if err != nil {
		return err
	}
	return servePNG(c, b)
}

// handleOGSheet serves /og/sheet/:actor/:file, where file is "<rkey>.png".
func (s *Server) handleOGSheet(c echo.Context) error {
	ctx := c.Request().Context()
	did, err := s.resolveActor(ctx, param(c, "actor"))
	if err != nil {
		return err
	}
	rkey := strings.TrimSuffix(param(c, "file"), ".png")
	sh, err := s.store.GetSheet(ctx, store.SheetURI(did, rkey), "")
	if err != nil {
		return notFoundOr(err, "sheet")
	}
	version := cardVersion(&sh.SheetSummary)
	if b, err := s.store.OGCard(ctx, sh.URI, version, time.Now().Add(-ogCardTTL)); err == nil {
		metrics.OGCards.WithLabelValues("stored").Inc()
		return servePNG(c, b)
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	facts := []string{}
	if noun := kindNoun[sh.Kind]; noun != "" {
		facts = append(facts, strings.ToUpper(noun[:1])+noun[1:])
	}
	if sh.Key != "" {
		facts = append(facts, "key of "+sh.Key)
	}
	if sh.Capo > 0 {
		facts = append(facts, fmt.Sprintf("capo %d", sh.Capo))
	}
	b, err := og.SheetCard(og.Sheet{
		Title:       sh.Title,
		Artist:      sh.Artist,
		Chords:      records.ChordNames(sh.Content),
		Facts:       strings.Join(facts, ", "),
		Author:      "@" + handleOrDID(sh.Author),
		RatingAvg:   sh.Stats.RatingAvg,
		RatingCount: sh.Stats.RatingCount,
	})
	if err != nil {
		return err
	}
	metrics.OGCards.WithLabelValues("rendered").Inc()
	if err := s.store.PutOGCard(ctx, sh.URI, version, b); err != nil {
		s.logger.Warn("storing og card", "uri", sh.URI, "error", err)
	}
	return servePNG(c, b)
}
