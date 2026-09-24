package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/labstack/echo/v4"
)

func TestSPACachesFingerprintedAssets(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":             {Data: []byte("<html><!--meta--><!--/meta--></html>")},
		"assets/btc-abc123.onnx": {Data: []byte("model")},
		"favicon.svg":            {Data: []byte("<svg/>")},
	}
	h := &spaHandler{distFS: dist, fileServer: http.FileServer(http.FS(dist)), meta: func(echo.Context, string) pageMeta { return pageMeta{} }}
	e := echo.New()
	e.GET("/*", h.handle)

	for path, want := range map[string]string{
		"/assets/btc-abc123.onnx": "public, max-age=31536000, immutable",
		"/favicon.svg":            "",
		"/songs/some/song":        "no-cache",
	} {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", path, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control %q, want %q", path, got, want)
		}
	}
}
