package server

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/bluesky-social/indigo/atproto/auth/oauth"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/metrics"
	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/labstack/echo/v4"
)

// Writes go to the viewer's PDS first, then straight into the index so
// the UI sees them immediately; the same commit arriving later from
// Jetstream is a no-op upsert.

type sheetInput struct {
	Title       string             `json:"title"`
	Artist      string             `json:"artist"`
	Album       string             `json:"album"`
	Kind        string             `json:"kind"`
	Content     string             `json:"content"`
	Key         string             `json:"key"`
	Capo        int64              `json:"capo"`
	Tuning      string             `json:"tuning"`
	Difficulty  string             `json:"difficulty"`
	Description string             `json:"description"`
	Tags        []string           `json:"tags"`
	Voicings    []records.Voicing  `json:"voicings"`
	ForkOf      *records.StrongRef `json:"forkOf"`
}

func (in *sheetInput) record(createdAt string) *records.Sheet {
	rec := &records.Sheet{
		Type:        records.NSIDSheet,
		Title:       strings.TrimSpace(in.Title),
		Artist:      strings.TrimSpace(in.Artist),
		Album:       strings.TrimSpace(in.Album),
		Kind:        in.Kind,
		Format:      "chordpro",
		Content:     strings.TrimRight(in.Content, " \n\t"),
		Key:         strings.TrimSpace(in.Key),
		Tuning:      in.Tuning,
		Difficulty:  in.Difficulty,
		Description: strings.TrimSpace(in.Description),
		ForkOf:      in.ForkOf,
		CreatedAt:   createdAt,
	}
	if in.Capo > 0 {
		capo := in.Capo
		rec.Capo = &capo
	}
	if rec.Tuning == "standard" {
		rec.Tuning = ""
	}
	for _, t := range in.Tags {
		if t = strings.ToLower(strings.TrimSpace(t)); t != "" {
			rec.Tags = append(rec.Tags, t)
		}
	}
	// One shape per chord (the first wins), only for chords that are named.
	seen := map[string]bool{}
	for _, v := range in.Voicings {
		if v.Chord = strings.TrimSpace(v.Chord); v.Chord != "" && len(v.Frets) > 0 && !seen[v.Chord] {
			seen[v.Chord] = true
			rec.Voicings = append(rec.Voicings, v)
		}
	}
	return rec
}

func validateSheet(rec *records.Sheet) error {
	if rec.Title == "" || rec.Artist == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "title and artist are required")
	}
	if strings.TrimSpace(rec.Content) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "the sheet is empty")
	}
	if err := records.Validate(records.NSIDSheet, rec); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return nil
}

// atprotoDatetime is the canonical atproto datetime layout (millisecond
// precision, UTC).
const atprotoDatetime = "2006-01-02T15:04:05.000Z"

type writeResult struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

func createRecord(ctx context.Context, sess *oauth.ClientSession, collection string, record any) (_ *writeResult, err error) {
	var out writeResult
	defer func() { metrics.PDSWrites.WithLabelValues(collection, "create", metrics.Result(err)).Inc() }()
	err = sess.APIClient().Post(ctx, "com.atproto.repo.createRecord", map[string]any{
		"repo":       sess.Data.AccountDID.String(),
		"collection": collection,
		"record":     record,
	}, &out)
	return &out, err
}

func putRecord(ctx context.Context, sess *oauth.ClientSession, collection, rkey string, record any) (_ *writeResult, err error) {
	var out writeResult
	defer func() { metrics.PDSWrites.WithLabelValues(collection, "update", metrics.Result(err)).Inc() }()
	err = sess.APIClient().Post(ctx, "com.atproto.repo.putRecord", map[string]any{
		"repo":       sess.Data.AccountDID.String(),
		"collection": collection,
		"rkey":       rkey,
		"record":     record,
	}, &out)
	return &out, err
}

func deleteRecord(ctx context.Context, sess *oauth.ClientSession, collection, rkey string) (err error) {
	defer func() { metrics.PDSWrites.WithLabelValues(collection, "delete", metrics.Result(err)).Inc() }()
	return sess.APIClient().Post(ctx, "com.atproto.repo.deleteRecord", map[string]any{
		"repo":       sess.Data.AccountDID.String(),
		"collection": collection,
		"rkey":       rkey,
	}, nil)
}

func rkeyOf(uri string) string {
	return uri[strings.LastIndex(uri, "/")+1:]
}

// pdsError reports a failed repo write to the user.
func (s *Server) pdsError(err error, what string) error {
	s.logger.Warn("pds write failed", "what", what, "error", err)
	return echo.NewHTTPError(http.StatusBadGateway, "your PDS rejected the "+what+": "+err.Error())
}

func (s *Server) handleCreateSheet(c echo.Context) error {
	ctx := c.Request().Context()
	var in sheetInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	rec := in.record(syntax.DatetimeNow().String())
	if rec.ForkOf != nil {
		// Pin the fork to the parent as it is now.
		parent, err := s.store.GetSheetSummary(ctx, rec.ForkOf.URI)
		if err != nil {
			return notFoundOr(err, "forked sheet")
		}
		rec.ForkOf.CID = parent.CID
	}
	if err := validateSheet(rec); err != nil {
		return err
	}
	sess, err := s.pdsClient(c)
	if err != nil {
		return err
	}
	res, err := createRecord(ctx, sess, records.NSIDSheet, rec)
	if err != nil {
		return s.pdsError(err, "sheet")
	}
	did := sess.Data.AccountDID.String()
	if err := s.store.UpsertSheet(ctx, did, rkeyOf(res.URI), res.CID, rec); err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, map[string]string{"uri": res.URI, "did": did, "rkey": rkeyOf(res.URI)})
}

// ownSheet loads the sheet at /:actor/:rkey, requiring the viewer to own it.
func (s *Server) ownSheet(c echo.Context) (*store.Sheet, error) {
	did, _, uri, err := s.sheetURIParam(c)
	if err != nil {
		return nil, err
	}
	if did != viewer(c).DID.String() {
		return nil, echo.NewHTTPError(http.StatusForbidden, "that's someone else's sheet")
	}
	sheet, err := s.store.GetSheet(c.Request().Context(), uri)
	if err != nil {
		return nil, notFoundOr(err, "sheet")
	}
	return sheet, nil
}

func (s *Server) handleUpdateSheet(c echo.Context) error {
	ctx := c.Request().Context()
	existing, err := s.ownSheet(c)
	if err != nil {
		return err
	}
	var in sheetInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	rec := in.record(existing.CreatedAt.UTC().Format(atprotoDatetime))
	rec.ForkOf = existing.ForkOf // where a sheet came from doesn't change
	rec.UpdatedAt = syntax.DatetimeNow().String()
	if err := validateSheet(rec); err != nil {
		return err
	}
	sess, err := s.pdsClient(c)
	if err != nil {
		return err
	}
	res, err := putRecord(ctx, sess, records.NSIDSheet, existing.Rkey, rec)
	if err != nil {
		return s.pdsError(err, "sheet")
	}
	if err := s.store.UpsertSheet(ctx, existing.DID, existing.Rkey, res.CID, rec); err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"uri": res.URI, "did": existing.DID, "rkey": existing.Rkey})
}

func (s *Server) handleDeleteSheet(c echo.Context) error {
	ctx := c.Request().Context()
	existing, err := s.ownSheet(c)
	if err != nil {
		return err
	}
	sess, err := s.pdsClient(c)
	if err != nil {
		return err
	}
	if err := deleteRecord(ctx, sess, records.NSIDSheet, existing.Rkey); err != nil {
		return s.pdsError(err, "delete")
	}
	if err := s.store.DeleteSheet(ctx, existing.URI); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// subjectSheet loads the sheet at /:actor/:rkey plus the viewer's state on it.
func (s *Server) subjectSheet(c echo.Context) (*store.SheetSummary, *store.ViewerState, error) {
	ctx := c.Request().Context()
	_, _, uri, err := s.sheetURIParam(c)
	if err != nil {
		return nil, nil, err
	}
	sheet, err := s.store.GetSheetSummary(ctx, uri)
	if err != nil {
		return nil, nil, notFoundOr(err, "sheet")
	}
	vs, err := s.store.GetViewerState(ctx, viewer(c).DID.String(), uri)
	if err != nil {
		return nil, nil, err
	}
	return sheet, vs, nil
}

func (s *Server) handleRate(c echo.Context) error {
	ctx := c.Request().Context()
	var in struct {
		Value int64 `json:"value"`
	}
	if err := c.Bind(&in); err != nil || in.Value < 0 || in.Value > 5 {
		return echo.NewHTTPError(http.StatusBadRequest, "rating must be 0-5")
	}
	sheet, vs, err := s.subjectSheet(c)
	if err != nil {
		return err
	}
	sess, err := s.pdsClient(c)
	if err != nil {
		return err
	}
	did := sess.Data.AccountDID.String()

	// Keep one rating record per sheet: rewrite the newest in place and
	// drop any strays (from another client, say).
	stale := vs.RatingURIs
	if in.Value > 0 {
		rec := &records.Rating{
			Type:      records.NSIDRating,
			Subject:   records.StrongRef{URI: sheet.URI, CID: sheet.CID},
			Value:     in.Value,
			CreatedAt: syntax.DatetimeNow().String(),
		}
		var res *writeResult
		if len(vs.RatingURIs) > 0 {
			res, err = putRecord(ctx, sess, records.NSIDRating, rkeyOf(vs.RatingURIs[0]), rec)
			stale = vs.RatingURIs[1:]
		} else {
			res, err = createRecord(ctx, sess, records.NSIDRating, rec)
		}
		if err != nil {
			return s.pdsError(err, "rating")
		}
		if err := s.store.UpsertRating(ctx, res.URI, did, rec); err != nil {
			return err
		}
	}
	if err := s.deleteAll(ctx, sess, records.NSIDRating, stale, s.store.DeleteRating); err != nil {
		return err
	}
	return s.respondStats(c, sheet.URI)
}

func (s *Server) handleFavorite(c echo.Context) error {
	ctx := c.Request().Context()
	var in struct {
		Favorite bool `json:"favorite"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	sheet, vs, err := s.subjectSheet(c)
	if err != nil {
		return err
	}
	sess, err := s.pdsClient(c)
	if err != nil {
		return err
	}
	if in.Favorite && len(vs.FavoriteURIs) == 0 {
		rec := &records.Favorite{
			Type:      records.NSIDFavorite,
			Subject:   records.StrongRef{URI: sheet.URI, CID: sheet.CID},
			CreatedAt: syntax.DatetimeNow().String(),
		}
		res, err := createRecord(ctx, sess, records.NSIDFavorite, rec)
		if err != nil {
			return s.pdsError(err, "favorite")
		}
		if err := s.store.UpsertFavorite(ctx, res.URI, sess.Data.AccountDID.String(), rec); err != nil {
			return err
		}
	} else if !in.Favorite {
		if err := s.deleteAll(ctx, sess, records.NSIDFavorite, vs.FavoriteURIs, s.store.DeleteFavorite); err != nil {
			return err
		}
	}
	return s.respondStats(c, sheet.URI)
}

func (s *Server) deleteAll(ctx context.Context, sess *oauth.ClientSession, collection string, uris []string,
	unindex func(context.Context, string) error) error {
	for _, uri := range uris {
		if err := deleteRecord(ctx, sess, collection, rkeyOf(uri)); err != nil {
			return s.pdsError(err, "delete")
		}
		if err := unindex(ctx, uri); err != nil {
			return err
		}
	}
	return nil
}

// respondStats returns a sheet's updated stats and the viewer's state.
func (s *Server) respondStats(c echo.Context, uri string) error {
	ctx := c.Request().Context()
	sheet, err := s.store.GetSheetSummary(ctx, uri)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	vs, err := s.store.GetViewerState(ctx, viewer(c).DID.String(), uri)
	if err != nil {
		return err
	}
	var stats store.Stats
	if sheet != nil {
		stats = sheet.Stats
	}
	return c.JSON(http.StatusOK, map[string]any{"stats": stats, "viewer": vs})
}
