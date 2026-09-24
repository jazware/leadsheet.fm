package records

import (
	"regexp"
	"strings"
)

var (
	inlineChordRE = regexp.MustCompile(`\[[^\]\n]*\]`)
	directiveRE   = regexp.MustCompile(`^\s*\{([a-z_]+)(?:[:\s]\s*(.*?))?\s*\}\s*$`)
	blankRunRE    = regexp.MustCompile(`\n{3,}`)
)

// PlainLyrics reduces ChordPro content to its words for full-text search:
// chords, directives and tab blocks are dropped; comments are kept since
// they're usually section names ("Chorus") or playing notes.
func PlainLyrics(content string) string {
	var b strings.Builder
	inTab := false
	for _, line := range strings.Split(content, "\n") {
		if m := directiveRE.FindStringSubmatch(line); m != nil {
			switch m[1] {
			case "start_of_tab", "sot":
				inTab = true
			case "end_of_tab", "eot":
				inTab = false
			case "comment", "c", "comment_italic", "ci", "comment_box", "cb":
				b.WriteString(m[2])
				b.WriteByte('\n')
			}
			continue
		}
		if inTab || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		line = strings.Join(strings.Fields(inlineChordRE.ReplaceAllString(line, "")), " ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return strings.TrimSpace(blankRunRE.ReplaceAllString(b.String(), "\n\n"))
}

// chordRE matches a chord symbol: a root, a suffix made of chord-ish
// pieces, and an optional bass note. "[Verse]" and "[Bridge]" don't match.
var chordRE = regexp.MustCompile(`^[A-G][#b♯♭]?(?:maj|min|mi|ma|m|M|dim|aug|sus|add|alt|dom|no|omit|°|ø|Δ|\+|-|\(|\)|[0-9#b♯♭,])*(?:/[A-G][#b♯♭]?)?$`)

// ChordNames lists the distinct chords in ChordPro content, in order of
// first use. Tab blocks and directives are skipped.
func ChordNames(content string) []string {
	seen := map[string]bool{}
	var out []string
	inTab := false
	for _, line := range strings.Split(content, "\n") {
		if m := directiveRE.FindStringSubmatch(line); m != nil {
			switch m[1] {
			case "start_of_tab", "sot":
				inTab = true
			case "end_of_tab", "eot":
				inTab = false
			}
			continue
		}
		if inTab {
			continue
		}
		for _, m := range inlineChordRE.FindAllString(line, -1) {
			ch := strings.TrimSpace(m[1 : len(m)-1])
			if chordRE.MatchString(ch) && !seen[ch] {
				seen[ch] = true
				out = append(out, ch)
			}
		}
	}
	return out
}
