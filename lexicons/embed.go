// Package lexicons embeds the fm.leadsheet.* schemas (and the
// com.atproto ones they reference) for record validation.
package lexicons

import "embed"

//go:embed fm com
var FS embed.FS
