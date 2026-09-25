import { describe, expect, it } from 'vitest'
import { parseChordPro } from '@/lib/chordpro'
import {
  bookmarklet,
  importToSheet,
  looksLikeTagMarkup,
  readImport,
  tuningId,
  tagMarkupToChordPro,
  type TabImport,
} from '@/lib/tabImport'

// A made-up sheet in chord-tag markup, as found in tab_view.wiki_tab.content.
const MARKUP = [
  '[Intro]',
  '[ch]G[/ch]   [ch]Cadd9[/ch]   [ch]D[/ch]  x2',
  '',
  '[Verse 1]',
  '[tab][ch]G[/ch]                [ch]C[/ch]',
  'Walking down the harbor road[/tab]',
  '[tab]        [ch]Em[/ch]        [ch]D/F#[/ch]',
  'Humming something old[/tab]',
  '',
  '[Riff]',
  '[tab]e|-----0---|',
  'B|---1---1-|',
  'G|-2-------|[/tab]',
].join('\r\n')

describe('tagMarkupToChordPro', () => {
  const out = tagMarkupToChordPro(MARKUP)

  it('puts chords inline over the right syllables', () => {
    expect(out).toContain('[G]Walking down the [C]harbor road')
    expect(out).toContain('Humming [Em]something [D/F#]old')
  })

  it('keeps section headers and chord-only lines', () => {
    expect(out).toContain('[Intro]')
    expect(out).toContain('[Verse 1]')
    expect(out).toMatch(/\[G\]\s+\[Cadd9\]\s+\[D\]\s+\[x2\]/) // repeat marks stay in the chord row
  })

  it('wraps tablature in a tab block', () => {
    expect(out).toMatch(/\{start_of_tab\}\ne\|-----0---\|\nB\|---1---1-\|\nG\|-2-------\|\n\{end_of_tab\}/)
  })

  it('leaves no markup behind and parses cleanly', () => {
    expect(out).not.toMatch(/\[\/?(ch|tab)\]|\r/)
    const doc = parseChordPro(out)
    expect(doc.blocks.map((b) => b.label ?? b.kind)).toEqual(['Intro', 'Verse 1', 'Riff', 'tab'])
  })
})

describe('tuningId', () => {
  it('maps tuning strings by pitch class', () => {
    expect(tuningId('E A D G B E')).toBe('standard')
    expect(tuningId('Eb Ab Db Gb Bb Eb')).toBe('eb-standard')
    expect(tuningId('D# G# C# F# A# D#')).toBe('eb-standard')
    expect(tuningId('D A D G B E')).toBe('drop-d')
    expect(tuningId('D A D G A D')).toBe('dadgad')
    expect(tuningId('B E A D F# B')).toBe('standard') // unknown → standard
    expect(tuningId('G C E A', 'ukulele')).toBe('standard')
    expect(tuningId('D G B E', 'ukulele')).toBe('baritone')
    expect(tuningId('E A D G', 'bass')).toBe('standard')
    expect(tuningId('B E A D G', 'bass')).toBe('five-string')
    expect(tuningId('D A D G', 'bass')).toBe('drop-d')
    expect(tuningId('D A D G', 'chords')).toBe('standard') // a bass tuning on a guitar sheet
  })
})

describe('bookmarklet round trip', () => {
  const payload: TabImport = {
    v: 1,
    url: 'https://tabs.example.com/tab/someone/some-song-chords-1',
    title: 'Some Song',
    artist: 'Sömeone', // non-ASCII survives the base64 hop
    type: 'Ukulele Chords',
    author: 'strummer42',
    capo: 3,
    key: 'Am',
    tuning: 'E A D G B E',
    difficulty: 'novice',
    content: MARKUP,
  }

  it('builds a javascript: URL that opens this origin', () => {
    const b = bookmarklet('https://leadsheet.fm')
    expect(b.startsWith('javascript:')).toBe(true)
    expect(decodeURIComponent(b)).toContain('"https://leadsheet.fm"+\'/new#import=\'')
  })

  it('decodes what the bookmarklet encodes', () => {
    // The same encoding the bookmarklet uses in the browser.
    const hash = '#import=' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    expect(readImport(hash)).toEqual(payload)
    expect(readImport('#nope')).toBeNull()
    expect(readImport('#import=not-base64!')).toBeNull()
  })

  it('maps the page fields onto a draft and credits the transcriber', () => {
    const sheet = importToSheet(payload)
    expect(sheet).toMatchObject({ title: 'Some Song', artist: 'Sömeone', kind: 'ukulele', key: 'Am', capo: 3, tuning: 'standard', difficulty: 'beginner' })
    expect(sheet.description).toBe(`Transcribed by strummer42: ${payload.url}`)
    expect(looksLikeTagMarkup(payload.content)).toBe(true)
    expect(looksLikeTagMarkup('[G]plain chordpro')).toBe(false)
  })
})
