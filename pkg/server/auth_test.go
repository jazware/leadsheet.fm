package server

import "testing"

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
