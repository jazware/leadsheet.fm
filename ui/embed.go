// Package ui embeds the built frontend for single-binary serving.
package ui

import "embed"

// DistFS holds the Vite build output. Run `just ui-build` to populate
// dist/; the committed .gitkeep keeps `go build` working before the
// first frontend build.
//
//go:embed all:dist
var DistFS embed.FS
