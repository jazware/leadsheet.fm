package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// SourceRepo is where Leadsheet's code lives.
const SourceRepo = "jazware/leadsheet.fm"

// repoStars caches the source repo's star count for the footer badge, so
// visitors' browsers don't each call the GitHub API.
type repoStars struct {
	mu      sync.Mutex
	stars   int
	fetched time.Time
	ok      bool
}

const repoStarsTTL = time.Hour

func (r *repoStars) get(ctx context.Context) (int, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Since(r.fetched) < repoStarsTTL {
		return r.stars, r.ok
	}
	// Whatever happens, don't ask again for an hour.
	r.fetched = time.Now()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+SourceRepo, nil)
	if err != nil {
		return r.stars, r.ok
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "leadsheet")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return r.stars, r.ok
	}
	defer resp.Body.Close()
	var out struct {
		Stars int `json:"stargazers_count"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&out) != nil {
		return r.stars, r.ok
	}
	r.stars, r.ok = out.Stars, true
	return r.stars, r.ok
}

// handleAbout serves what the footer shows: the source repo and its stars
// (null when GitHub hasn't answered).
func (s *Server) handleAbout(c echo.Context) error {
	resp := map[string]any{"repo": SourceRepo, "repoUrl": fmt.Sprintf("https://github.com/%s", SourceRepo), "stars": nil}
	if n, ok := s.repoStars.get(c.Request().Context()); ok {
		resp["stars"] = n
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=600")
	return c.JSON(http.StatusOK, resp)
}
