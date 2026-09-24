package records

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var (
	// "(feat. X)", "[ft X]", " featuring X" — featured artists don't make
	// a different song.
	featRE = regexp.MustCompile(`(?i)\s*[\(\[]\s*(feat\.?|ft\.?|featuring)\s[^\)\]]*[\)\]]|\s+(feat\.?|ft\.?|featuring)\s.*$`)
	// "(Live)", "(Remastered 2011)", "- Acoustic Version" are the same song
	// for chord purposes; the version list tells them apart by title.
	versionRE  = regexp.MustCompile(`(?i)\s*[\(\[][^\)\]]*(remaster|version|edit|mix|mono|stereo|live|acoustic|demo)[^\)\]]*[\)\]]|\s+-\s+[^-]*(remaster|version|edit|mix|live|acoustic|demo).*$`)
	nonSlugRE  = regexp.MustCompile(`[^a-z0-9]+`)
	stripMarks = transform.Chain(norm.NFKD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
)

// Slug turns a name into a URL-safe, accent- and case-folded key.
func Slug(s string) string {
	folded, _, err := transform.String(stripMarks, s)
	if err == nil {
		s = folded
	}
	s = strings.ToLower(strings.ReplaceAll(s, "&", " and "))
	return strings.Trim(nonSlugRE.ReplaceAllString(s, "-"), "-")
}

// ArtistSlug keys an artist, ignoring featured artists and a leading "The".
func ArtistSlug(artist string) string {
	artist = featRE.ReplaceAllString(artist, "")
	slug := Slug(artist)
	if rest, ok := strings.CutPrefix(slug, "the-"); ok && rest != "" {
		slug = rest
	}
	if slug == "" {
		return "unknown"
	}
	return slug
}

// TitleSlug keys a song title, ignoring featured artists and
// live/remaster/version suffixes.
func TitleSlug(title string) string {
	title = featRE.ReplaceAllString(title, "")
	if stripped := versionRE.ReplaceAllString(title, ""); Slug(stripped) != "" {
		title = stripped
	}
	slug := Slug(title)
	if slug == "" {
		return "untitled"
	}
	return slug
}
