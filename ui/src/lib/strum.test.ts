import { describe, expect, it } from 'vitest'
import { parseChordPro } from '@/lib/chordpro'
import { parsePattern, parseStrumDirective, strokeCounts, strumsByChord } from '@/lib/strum'

describe('parsePattern', () => {
  it('reads strokes, accents and bars', () => {
    const p = parsePattern('>D.xU|DDDD')!
    expect(p.bars.map((b) => b.map((s) => (s.accent ? '>' : '') + s.kind[0]))).toEqual([['>d', 'm', 'c', 'u'], ['d', 'd', 'd', 'd']])
  })
  it('refuses what isn’t a pattern', () => {
    expect(parsePattern('chorus')).toBeNull()
    expect(parsePattern('....')).toBeNull()
    expect(parsePattern('D.D||')).toBeNull()
  })
})

describe('parseStrumDirective', () => {
  it('tells patterns, names and switches apart', () => {
    expect(parseStrumDirective('D.DU.UDU')).toMatchObject({ once: false, name: null, pattern: { source: 'D.DU.UDU' } })
    expect(parseStrumDirective('Chorus  D.D.D.D.')).toMatchObject({ name: 'chorus', pattern: { source: 'D.D.D.D.' } })
    expect(parseStrumDirective('chorus')).toEqual({ once: false, name: 'chorus', pattern: null })
    expect(parseStrumDirective('once D.......')).toMatchObject({ once: true, name: null })
    expect(parseStrumDirective('chorus nonsense')).toBeNull()
  })
})

describe('strokeCounts', () => {
  const counts = (src: string, time?: string) => strokeCounts(parsePattern(src)!.bars[0], time).map((c) => c.count).join(' ')
  it('counts by the grid the time signature and length make', () => {
    expect(counts('D.DU.UDU')).toBe('1 & 2 & 3 & 4 &')
    expect(counts('DDDD')).toBe('1 2 3 4')
    expect(counts('D.xUD.xUD.xUD.xU')).toBe('1 e & a 2 e & a 3 e & a 4 e & a')
    expect(counts('D.DUDU', '3/4')).toBe('1 & 2 & 3 &')
    expect(counts('DDUDDU', '6/8')).toBe('1 2 3 4 5 6')
  })
})

const SONG = `{title: Harbor Road}
{x_strum: verse  D.DU.UDU}
{x_strum: chorus D.D.D.D.}

[Verse]
[G]Walking down the [C]harbor road

{x_strum: chorus}
[Chorus]
[C]Row me [G]home

{x_strum: verse}
[Verse 2]
[G]Lanterns on the [C]water line
{x_strum: build >D.DU>D.DU}
[Em]Keeping [D]time
{x_strum: once D.......}
[G]Home [C]again`

describe('strumming in a sheet', () => {
  const doc = parseChordPro(SONG)

  it('uses the first named pattern from the start and lists every pattern', () => {
    expect(doc.strum).toMatchObject({ name: 'verse', once: false })
    expect(doc.strums.map((s) => s.name)).toEqual(['verse', 'chorus', 'build'])
    expect(doc.meta.x_strum).toBeUndefined()
  })

  it('puts a switch before a section on the section, and one mid-section on its line', () => {
    const [verse, chorus, verse2] = doc.blocks
    expect(verse.strum).toBeUndefined()
    expect(chorus.strum).toMatchObject({ name: 'chorus' })
    expect(verse2.strum).toMatchObject({ name: 'verse' })
    const kinds = verse2.lines.map((l) => (l.type === 'strum' ? `strum:${l.change.once ? 'once' : l.change.name}` : l.type))
    expect(kinds).toEqual(['lyrics', 'strum:build', 'lyrics', 'strum:once', 'lyrics'])
  })

  it('knows the pattern at every chord; "once" covers one chord, then the pattern before it', () => {
    const at = strumsByChord(doc)
    const chords = doc.blocks.flatMap((b) => b.lines.flatMap((l) => (l.type === 'lyrics' ? l.segments.filter((s) => s.chord) : [])))
    expect(chords.map((s) => (at.get(s)!.once ? 'once' : at.get(s)!.name))).toEqual([
      'verse', 'verse', // verse
      'chorus', 'chorus', // chorus
      'verse', 'verse', // verse 2
      'build', 'build', // from the build line
      'once', 'build', // one bar, then back
    ])
  })

  it('takes an unnamed pattern as the sheet’s, and ignores ones it can’t read', () => {
    const d = parseChordPro('{x_strum: DUDU}\n{x_strum: not a pattern}\n[C]la')
    expect(d.strum?.pattern.source).toBe('DUDU')
    expect(d.strums).toHaveLength(1)
    expect(parseChordPro('[C]la').strum).toBeNull()
  })
})
