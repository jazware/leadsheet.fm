package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

// Author is the display info for an account.
type Author struct {
	DID         string `json:"did"`
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

type Stats struct {
	RatingCount   int     `json:"ratingCount"`
	RatingAvg     float64 `json:"ratingAvg"`
	FavoriteCount int     `json:"favoriteCount"`
	ForkCount     int     `json:"forkCount"`
}

// SheetSummary is a sheet without its content, for lists.
type SheetSummary struct {
	URI         string             `json:"uri"`
	DID         string             `json:"did"`
	Rkey        string             `json:"rkey"`
	CID         string             `json:"cid"`
	Title       string             `json:"title"`
	Artist      string             `json:"artist"`
	Album       string             `json:"album"`
	ArtistSlug  string             `json:"artistSlug"`
	TitleSlug   string             `json:"titleSlug"`
	Kind        string             `json:"kind"`
	Key         string             `json:"key"`
	Capo        int                `json:"capo"`
	Tuning      string             `json:"tuning"`
	Difficulty  string             `json:"difficulty"`
	Tags        []string           `json:"tags"`
	ForkOf      *records.StrongRef `json:"forkOf,omitempty"`
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
	Author      Author             `json:"author"`
	Stats       Stats              `json:"stats"`
	ratingScore float64
	// Search only: the lyric excerpt that matched, hits wrapped in
	// \x02…\x03 ("" when the match wasn't in the lyrics).
	snippet string
}

// Sheet is a full sheet.
type Sheet struct {
	SheetSummary
	Content     string `json:"content"`
	Description string `json:"description"`
	// The record's voicings, as stored: [{"chord", "frets"}, ...].
	Voicings json.RawMessage `json:"voicings"`
}

func summary(r dbq.SheetSummary) SheetSummary {
	s := SheetSummary{
		URI: r.Uri, DID: r.Did, Rkey: r.Rkey, CID: r.Cid,
		Title: r.Title, Artist: r.Artist, Album: r.Album,
		ArtistSlug: r.ArtistSlug, TitleSlug: r.TitleSlug,
		Kind: r.Kind, Key: r.Key, Capo: int(r.Capo), Tuning: r.Tuning, Difficulty: r.Difficulty,
		Tags:      r.Tags,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		Author: Author{DID: r.Did, Handle: r.Handle, DisplayName: r.DisplayName, Avatar: r.Avatar},
		Stats: Stats{
			RatingCount: int(r.RatingCount), RatingAvg: r.RatingAvg,
			FavoriteCount: int(r.FavoriteCount), ForkCount: int(r.ForkCount),
		},
		ratingScore: r.RatingScore,
	}
	if s.Tags == nil {
		s.Tags = []string{}
	}
	if r.ForkOfUri != "" {
		s.ForkOf = &records.StrongRef{URI: r.ForkOfUri, CID: r.ForkOfCid}
	}
	return s
}

func summaries(rows []dbq.SheetSummary, err error) ([]SheetSummary, error) {
	if err != nil {
		return nil, err
	}
	out := make([]SheetSummary, len(rows))
	for i, r := range rows {
		out[i] = summary(r)
	}
	return out, nil
}

// SheetURI builds the at-uri of a sheet record.
func SheetURI(did, rkey string) string {
	return fmt.Sprintf("at://%s/%s/%s", did, records.NSIDSheet, rkey)
}

// parseTime reads a record's datetime, leniently; records with unusable
// timestamps are dated when we first saw them.
func parseTime(s string) time.Time {
	if dt, err := syntax.ParseDatetimeLenient(s); err == nil {
		return dt.Time()
	}
	return time.Now()
}

// UpsertSheet indexes a sheet record (create or update).
func (s *Store) UpsertSheet(ctx context.Context, did, rkey, cid string, rec *records.Sheet) error {
	uri := SheetURI(did, rkey)
	p := dbq.UpsertSheetParams{
		Uri: uri, Did: did, Rkey: rkey, Cid: cid,
		Title: rec.Title, Artist: rec.Artist, Album: rec.Album,
		ArtistSlug: records.ArtistSlug(rec.Artist), TitleSlug: records.TitleSlug(rec.Title),
		Kind: rec.Kind, Key: rec.Key, Tuning: rec.Tuning, Difficulty: rec.Difficulty,
		Description: rec.Description,
		Tags:        rec.Tags,
		Content:     rec.Content,
		Lyrics:      records.PlainLyrics(rec.Content),
		CreatedAt:   parseTime(rec.CreatedAt),
	}
	if p.Tags == nil {
		p.Tags = []string{}
	}
	voicings := rec.Voicings
	if voicings == nil {
		voicings = []records.Voicing{}
	}
	var err error
	if p.Voicings, err = json.Marshal(voicings); err != nil {
		return err
	}
	p.TagsText = strings.Join(p.Tags, " ")
	if p.Kind == "" {
		p.Kind = "chords"
	}
	p.UpdatedAt = p.CreatedAt
	if rec.UpdatedAt != "" {
		p.UpdatedAt = parseTime(rec.UpdatedAt)
	}
	if rec.Capo != nil {
		p.Capo = int32(*rec.Capo)
	}
	if rec.ForkOf != nil {
		p.ForkOfUri, p.ForkOfCid = rec.ForkOf.URI, rec.ForkOf.CID
	}

	return s.tx(ctx, func(q *dbq.Queries) error {
		oldFork, err := q.SheetForkOf(ctx, uri)
		if err := noRows(err); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if err := q.UpsertSheet(ctx, p); err != nil {
			return fmt.Errorf("upserting sheet: %w", err)
		}
		if err := q.EnsureProfile(ctx, did); err != nil {
			return err
		}
		return recomputeAll(ctx, q, oldFork, p.ForkOfUri)
	})
}

// DeleteSheet removes a sheet from the index. Ratings and favorites of it
// stay, so they count again if the record reappears.
func (s *Store) DeleteSheet(ctx context.Context, uri string) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		if err := q.DeleteOGCard(ctx, uri); err != nil {
			return err
		}
		forkOf, err := q.DeleteSheet(ctx, uri)
		if errors.Is(noRows(err), ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		return recomputeAll(ctx, q, forkOf)
	})
}

// GetSheet returns a full sheet, or ErrNotFound (also for hidden authors).
func (s *Store) GetSheet(ctx context.Context, uri string) (*Sheet, error) {
	r, err := s.q.GetSheet(ctx, uri)
	if err != nil {
		return nil, noRows(err)
	}
	return &Sheet{SheetSummary: summary(r.SheetSummary), Content: r.Content, Description: r.Description, Voicings: r.Voicings}, nil
}

// GetSheetSummary is GetSheet without the content.
func (s *Store) GetSheetSummary(ctx context.Context, uri string) (*SheetSummary, error) {
	r, err := s.q.GetSheetSummary(ctx, uri)
	if err != nil {
		return nil, noRows(err)
	}
	sum := summary(r)
	return &sum, nil
}

// Sort orders for sheet lists.
const (
	SortRecent = "recent"
	SortTop    = "top"
)

// ListSheets pages through every sheet, newest or best-rated first.
func (s *Store) ListSheets(ctx context.Context, sort string, limit, offset int) ([]SheetSummary, error) {
	if sort == SortTop {
		return summaries(s.q.ListSheetsTop(ctx, dbq.ListSheetsTopParams{Limit: int32(limit), Offset: int32(offset)}))
	}
	return summaries(s.q.ListSheetsRecent(ctx, dbq.ListSheetsRecentParams{Limit: int32(limit), Offset: int32(offset)}))
}

// SheetsByDID lists an account's sheets, newest first.
func (s *Store) SheetsByDID(ctx context.Context, did string) ([]SheetSummary, error) {
	return summaries(s.q.SheetsByDID(ctx, did))
}

// Forks lists the sheets forked from uri, best first.
func (s *Store) Forks(ctx context.Context, uri string) ([]SheetSummary, error) {
	return summaries(s.q.Forks(ctx, uri))
}

// Song is every version of a song (same artist and title slugs).
type Song struct {
	Title      string        `json:"title"`
	Artist     string        `json:"artist"`
	ArtistSlug string        `json:"artistSlug"`
	TitleSlug  string        `json:"titleSlug"`
	Versions   []SongVersion `json:"versions"`
}

// SongVersion is a sheet numbered in publication order, like "Ver 2".
type SongVersion struct {
	SheetSummary
	Version int `json:"version"`
}

// GetSong returns a song's versions, best-rated first, or ErrNotFound.
func (s *Store) GetSong(ctx context.Context, artistSlug, titleSlug string) (*Song, error) {
	sheets, err := summaries(s.q.SongSheets(ctx, dbq.SongSheetsParams{ArtistSlug: artistSlug, TitleSlug: titleSlug}))
	if err != nil {
		return nil, err
	}
	if len(sheets) == 0 {
		return nil, ErrNotFound
	}
	versions := make([]SongVersion, len(sheets))
	for i, sh := range sheets {
		versions[i] = SongVersion{SheetSummary: sh, Version: i + 1}
	}
	sortByScore(versions, func(v SongVersion) SheetSummary { return v.SheetSummary })
	title, artist := songNames(sheets)
	return &Song{Title: title, Artist: artist, ArtistSlug: artistSlug, TitleSlug: titleSlug, Versions: versions}, nil
}

// SongResult is a song in search results or an artist's song list.
type SongResult struct {
	Title        string   `json:"title"`
	Artist       string   `json:"artist"`
	ArtistSlug   string   `json:"artistSlug"`
	TitleSlug    string   `json:"titleSlug"`
	VersionCount int      `json:"versionCount"`
	Kinds        []string `json:"kinds"`
	// The best-rated version, to link straight to.
	Top SheetSummary `json:"top"`
	// Search only: a lyric line that matched, hits wrapped in \x02…\x03.
	Snippet string `json:"snippet,omitempty"`
}

// groupSongs folds sheets (in relevance order) into songs, keeping that
// order by each song's first appearance.
func groupSongs(sheets []SheetSummary) []SongResult {
	var order []string
	groups := map[string][]SheetSummary{}
	for _, sh := range sheets {
		k := sh.ArtistSlug + "/" + sh.TitleSlug
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], sh)
	}
	out := make([]SongResult, 0, len(order))
	for _, k := range order {
		g := groups[k]
		snippet := ""
		for _, sh := range g {
			if strings.ContainsRune(sh.snippet, '\x02') {
				snippet = sh.snippet
				break
			}
		}
		sortByScore(g, func(s SheetSummary) SheetSummary { return s })
		kinds := []string{}
		seen := map[string]bool{}
		for _, sh := range g {
			if !seen[sh.Kind] {
				seen[sh.Kind] = true
				kinds = append(kinds, sh.Kind)
			}
		}
		title, artist := songNames(g)
		out = append(out, SongResult{
			Title: title, Artist: artist, ArtistSlug: g[0].ArtistSlug, TitleSlug: g[0].TitleSlug,
			VersionCount: len(g), Kinds: kinds, Top: g[0], Snippet: snippet,
		})
	}
	return out
}

// headlineOpts marks matched words in snippets with \x02…\x03.
const headlineOpts = "StartSel=\x02, StopSel=\x03, MinWords=5, MaxWords=14, MaxFragments=1"

// Search finds songs whose title, artist, lyrics or tags match q (every
// word, the last as a prefix), or whose names are a near miss ("deathcab").
// Title and artist matches rank above lyrics-only ones.
func (s *Store) Search(ctx context.Context, q string, limit int) ([]SongResult, error) {
	tsq := tsQuery(q)
	if tsq == "" {
		return []SongResult{}, nil
	}
	plain := strings.ToLower(strings.Join(strings.Fields(q), " "))
	rows, err := s.q.SearchSheets(ctx, dbq.SearchSheetsParams{
		Query: tsq, Plain: plain, Compact: compact(plain), HeadlineOpts: headlineOpts,
	})
	if err != nil {
		return nil, fmt.Errorf("searching: %w", err)
	}
	sheets := make([]SheetSummary, len(rows))
	for i, r := range rows {
		sheets[i] = summary(r.SheetSummary)
		sheets[i].snippet = r.Snippet
	}
	songs := groupSongs(sheets)
	if len(songs) > limit {
		songs = songs[:limit]
	}
	return songs, nil
}

// compact lowercases and drops everything but letters and digits, like
// the names_compact column.
func compact(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, s)
}

// tsQuery turns free text into a to_tsquery expression: every word must
// match, the last one as a prefix so results update while typing.
func tsQuery(q string) string {
	words := strings.FieldsFunc(strings.ToLower(q), func(r rune) bool {
		return !(r == '\'' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r > 127)
	})
	var terms []string
	for _, w := range words {
		w = strings.Trim(w, "'")
		if w == "" {
			continue
		}
		terms = append(terms, "'"+strings.ReplaceAll(w, "'", "''")+"'")
	}
	if len(terms) == 0 {
		return ""
	}
	terms[len(terms)-1] += ":*"
	return strings.Join(terms, " & ")
}

// Artist is an artist's songs, alphabetically.
type Artist struct {
	Name       string       `json:"name"`
	ArtistSlug string       `json:"artistSlug"`
	Songs      []SongResult `json:"songs"`
}

func (s *Store) GetArtist(ctx context.Context, artistSlug string) (*Artist, error) {
	sheets, err := summaries(s.q.ArtistSheets(ctx, artistSlug))
	if err != nil {
		return nil, err
	}
	if len(sheets) == 0 {
		return nil, ErrNotFound
	}
	_, name := songNames(sheets)
	return &Artist{Name: name, ArtistSlug: artistSlug, Songs: groupSongs(sheets)}, nil
}

// songNames picks how to show a song that versions spell differently:
// the shortest title ("Creep" over "Creep (Acoustic)") and the most
// common artist spelling.
func songNames(sheets []SheetSummary) (title, artist string) {
	counts := map[string]int{}
	for _, sh := range sheets {
		if title == "" || len(sh.Title) < len(title) {
			title = sh.Title
		}
		counts[sh.Artist]++
		if counts[sh.Artist] > counts[artist] {
			artist = sh.Artist
		}
	}
	return title, artist
}

func sortByScore[T any](items []T, sheet func(T) SheetSummary) {
	// Insertion sort: lists are short and it's stable.
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			a, b := sheet(items[j-1]), sheet(items[j])
			if a.ratingScore > b.ratingScore ||
				(a.ratingScore == b.ratingScore && a.Stats.FavoriteCount >= b.Stats.FavoriteCount) {
				break
			}
			items[j-1], items[j] = items[j], items[j-1]
		}
	}
}
