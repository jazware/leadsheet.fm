package server

import (
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestParamUnescapesDIDs(t *testing.T) {
	e := echo.New()
	var got string
	e.GET("/sheets/:actor/:rkey", func(c echo.Context) error {
		got = param(c, "actor")
		return nil
	})
	e.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/sheets/did%3Aplc%3Aabc/3k1", nil))
	if got != "did:plc:abc" {
		t.Fatalf("actor = %q", got)
	}
}
