import type { Doc, Segment } from '@/lib/chordpro'
import type { SheetChord } from './follow'

/**
 * The chords a player works through, in order: every parsed chord in
 * the sheet, with the segment it sits on (what the page highlights), and
 * the indices where each section (block) starts.
 */
export function playAlongChords(doc: Doc): { chords: SheetChord[]; segments: Segment[]; sections: number[] } {
  const segments: Segment[] = []
  const sections: number[] = []
  for (const b of doc.blocks) {
    const first = segments.length
    for (const l of b.lines)
      if (l.type === 'lyrics') for (const s of l.segments) if (s.chord) segments.push(s)
    if (segments.length > first) sections.push(first)
  }
  return { segments, sections, chords: segments.map((s) => ({ root: s.chord!.root, quality: s.chord!.quality })) }
}
