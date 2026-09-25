package store

import "testing"

func TestQuerySpanName(t *testing.T) {
	for sql, want := range map[string]string{
		"-- name: GetSheet :one\nSELECT * FROM sheet_summaries_all WHERE uri = $1": "GetSheet",
		"  -- name: RecomputeStats :exec\nINSERT INTO sheet_stats":                 "RecomputeStats",
		"-- a comment\nselect 1":            "SELECT",
		"update profiles set hidden = true": "UPDATE",
		"":                                  "query",
	} {
		if got := querySpanName(sql); got != want {
			t.Errorf("%q: %s, want %s", sql, got, want)
		}
	}
}
