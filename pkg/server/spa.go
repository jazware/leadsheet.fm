package server

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/jazware/leadsheet.fm/ui"
	"github.com/labstack/echo/v4"
)

// spaHandler serves the embedded frontend: its files as they are, and the
// app shell (index.html) for client-side routes, with that page's title
// and link-preview tags filled in so crawlers that don't run JavaScript
// still get them.
type spaHandler struct {
	distFS     fs.FS
	fileServer http.Handler
	meta       func(c echo.Context, path string) pageMeta
}

func newSPAHandler(meta func(c echo.Context, path string) pageMeta) *spaHandler {
	distFS, err := fs.Sub(ui.DistFS, "dist")
	if err != nil {
		panic("ui dist missing from embedded FS: " + err.Error())
	}
	return &spaHandler{
		distFS:     distFS,
		fileServer: http.FileServer(http.FS(distFS)),
		meta:       meta,
	}
}

// Marks the tags in index.html that each page replaces.
const (
	metaStart = "<!--meta-->"
	metaEnd   = "<!--/meta-->"
)

func (h *spaHandler) handle(c echo.Context) error {
	reqPath := c.Param("*")
	if reqPath != "" && reqPath != "index.html" {
		if f, err := h.distFS.Open(reqPath); err == nil {
			f.Close()
			h.fileServer.ServeHTTP(c.Response(), c.Request())
			return nil
		}
	}

	// The app shell, for "/" and client routes like /songs/oasis/wonderwall.
	indexData, err := fs.ReadFile(h.distFS, "index.html")
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound,
			"frontend not built — run `just ui-build` and restart")
	}
	html := string(indexData)
	if i, j := strings.Index(html, metaStart), strings.Index(html, metaEnd); i >= 0 && j > i {
		m := h.meta(c, "/"+reqPath)
		html = html[:i] + m.tags() + html[j+len(metaEnd):]
	}
	c.Response().Header().Set("Cache-Control", "no-cache")
	return c.HTML(http.StatusOK, html)
}
