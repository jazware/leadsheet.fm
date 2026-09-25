package server

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/labstack/echo/v4"
)

func notFoundOr(err error, what string) error {
	if errors.Is(err, store.ErrNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, what+" not found")
	}
	return err
}

// param reads a path parameter. Echo leaves them percent-encoded when
// the request path has escapes, as it does for DIDs ("did%3Aplc%3A…").
func param(c echo.Context, name string) string {
	v := c.Param(name)
	if u, err := url.PathUnescape(v); err == nil {
		return u
	}
	return v
}

func intParam(c echo.Context, name string, def, max int) int {
	v, err := strconv.Atoi(c.QueryParam(name))
	if err != nil || v < 0 {
		return def
	}
	return min(v, max)
}

func (s *Server) handleListSheets(c echo.Context) error {
	sort := c.QueryParam("sort")
	if sort != store.SortTop {
		sort = store.SortRecent
	}
	sheets, err := s.store.ListSheets(c.Request().Context(), sort,
		intParam(c, "limit", 30, 100), intParam(c, "offset", 0, 10000))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"sheets": sheets})
}

// sheetURIParam resolves /:actor/:rkey to a sheet at-uri.
func (s *Server) sheetURIParam(c echo.Context) (did, rkey, uri string, err error) {
	did, err = s.resolveActor(c.Request().Context(), param(c, "actor"))
	if err != nil {
		return "", "", "", err
	}
	rk, err := syntax.ParseRecordKey(param(c, "rkey"))
	if err != nil {
		return "", "", "", echo.NewHTTPError(http.StatusBadRequest, "invalid record key")
	}
	return did, rk.String(), store.SheetURI(did, rk.String()), nil
}

func (s *Server) handleGetSheet(c echo.Context) error {
	ctx := c.Request().Context()
	_, _, uri, err := s.sheetURIParam(c)
	if err != nil {
		return err
	}
	me := ""
	if ws := viewer(c); ws != nil {
		me = ws.DID.String()
	}
	sheet, err := s.store.GetSheet(ctx, uri, me) // a draft only for its author
	if err != nil {
		return notFoundOr(err, "sheet")
	}

	resp := map[string]any{"sheet": sheet, "viewer": nil, "forkOf": nil}
	if ws := viewer(c); ws != nil {
		vs, err := s.store.GetViewerState(ctx, ws.DID.String(), uri)
		if err != nil {
			return err
		}
		resp["viewer"] = vs
	}
	if sheet.ForkOf != nil {
		parent, err := s.store.GetSheetSummary(ctx, sheet.ForkOf.URI)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		// A deleted parent still shows as "forked from" (without a link).
		resp["forkOf"] = parent
	}
	forks, err := s.store.Forks(ctx, uri)
	if err != nil {
		return err
	}
	resp["forks"] = forks
	// Other versions of the song. A draft of a song nobody has published
	// yet has none (the song itself isn't listed).
	resp["versions"] = []store.SongVersion{}
	song, err := s.store.GetSong(ctx, sheet.ArtistSlug, sheet.TitleSlug)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	if song != nil {
		resp["versions"] = song.Versions
	}
	return c.JSON(http.StatusOK, resp)
}

func (s *Server) handleSearch(c echo.Context) error {
	songs, err := s.store.Search(c.Request().Context(), c.QueryParam("q"), intParam(c, "limit", 30, 100))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"songs": songs})
}

func (s *Server) handleGetSong(c echo.Context) error {
	song, err := s.store.GetSong(c.Request().Context(), param(c, "artist"), param(c, "title"))
	if err != nil {
		return notFoundOr(err, "song")
	}
	return c.JSON(http.StatusOK, song)
}

func (s *Server) handleGetArtist(c echo.Context) error {
	artist, err := s.store.GetArtist(c.Request().Context(), param(c, "artist"))
	if err != nil {
		return notFoundOr(err, "artist")
	}
	return c.JSON(http.StatusOK, artist)
}

func (s *Server) handleGetProfile(c echo.Context) error {
	ctx := c.Request().Context()
	did, err := s.resolveActor(ctx, param(c, "actor"))
	if err != nil {
		return err
	}
	author, err := s.store.GetAuthor(ctx, did)
	if err != nil {
		return notFoundOr(err, "account")
	}
	sheets, err := s.store.SheetsByDID(ctx, did)
	if err != nil {
		return err
	}
	favorites, err := s.store.Favorites(ctx, did)
	if err != nil {
		return err
	}
	resp := map[string]any{"author": author, "sheets": sheets, "favorites": favorites}
	// Your own profile lists your drafts too.
	if ws := viewer(c); ws != nil && ws.DID.String() == did {
		drafts, err := s.store.Drafts(ctx, did)
		if err != nil {
			return err
		}
		resp["drafts"] = drafts
	}
	return c.JSON(http.StatusOK, resp)
}
