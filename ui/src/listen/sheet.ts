import type { Doc, Segment } from '@/lib/chordpro'
import type { SheetChord } from './follow'

/**
 * The chords a player works through, in order: every parsed chord in
 * the sheet, with the segment it sits on (what the page highlights).
 */
export function playAlongChords(doc: Doc): { chords: SheetChord[]; segments: Segment[] } {
  const segments: Segment[] = []
  for (const b of doc.blocks)
    for (const l of b.lines)
      if (l.type === 'lyrics') for (const s of l.segments) if (s.chord) segments.push(s)
  return { segments, chords: segments.map((s) => ({ root: s.chord!.root, quality: s.chord!.quality })) }
}
