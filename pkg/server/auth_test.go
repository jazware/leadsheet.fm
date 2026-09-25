package server

import (
	"net/url"
	"testing"
)

func TestIsLocalPath(t *testing.T) {
	for p, want := range map[string]bool{
		"/":                            true,
		"/sheet/alice.bsky.social/3k1": true,
		"/search?q=a%2Fb":              true,
		"":                             false,
		"sheet":                        false,
		"//evil.com":                   false,
		"/\\evil.com":                  false,
		"/\t/evil.com":                 false,
		"https://evil.com":             false,
	} {
		if got := isLocalPath(p); got != want {
			t.Errorf("isLocalPath(%q) = %v, want %v", p, got, want)
		}
	}
}

func TestLoginFailure(t *testing.T) {
	for q, want := range map[string]string{
		"error=access_denied&error_description=This+request+has+expired": "expired",
		"error=access_denied&error_description=Access+denied":            "denied",
		"error=server_error": "failed",
		"state=abc&code=xyz": "failed",
	} {
		v, _ := url.ParseQuery(q)
		if got := loginFailure(v); got != want {
			t.Errorf("%s: %s, want %s", q, got, want)
		}
	}
	if got := withQuery("/sheet/a/b?x=1", "login_error", "expired"); got != "/sheet/a/b?login_error=expired&x=1" {
		t.Errorf("withQuery = %s", got)
	}
}
