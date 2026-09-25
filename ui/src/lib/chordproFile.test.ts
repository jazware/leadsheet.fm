import { describe, expect, it } from 'vitest'
import { chordProFileName, fromChordProFile, toChordProFile } from '@/lib/chordproFile'

const sheet = {
  title: 'Wonderwall',
  artist: 'Oasis',
  album: "(What's the Story) Morning Glory?",
  kind: 'chords',
  key: 'Em',
  capo: 2,
  tuning: 'eb-standard',
  description: 'Strum D DU UDU.\n\nPalm-mute the verses.',
  content: '{title: Old title}\n[Verse 1]\n[Em7]Today is [G]gonna be the day\n{comment: build up}\n',
}

describe('toChordProFile', () => {
  it('writes the fields as header directives, then the sheet', () => {
    const file = toChordProFile(sheet, 'https://leadsheet.fm/sheet/a/1')
    expect(file).toBe(
      [
        '{title: Wonderwall}',
        '{artist: Oasis}',
        "{album: (What's the Story) Morning Glory?}",
        '{key: Em}',
        '{capo: 2}',
        '{meta: tuning Half step down}',
        '# From Leadsheet: https://leadsheet.fm/sheet/a/1',
        '# Notes for players:',
        '#   Strum D DU UDU.',
        '#',
        '#   Palm-mute the verses.',
        '',
        '[Verse 1]',
        '[Em7]Today is [G]gonna be the day',
        '{comment: build up}',
        '',
      ].join('\n'),
    )
  })

  it('leaves out what a sheet doesn’t have, and says the instrument when it isn’t guitar', () => {
    const file = toChordProFile({ ...sheet, album: '', key: '', capo: 0, tuning: 'standard', description: '', kind: 'ukulele' })
    expect(file.split('\n\n')[0]).toBe('{title: Wonderwall}\n{artist: Oasis}\n{meta: instrument ukulele}')
  })
})

describe('fromChordProFile', () => {
  it('reads back what toChordProFile wrote', () => {
    const { fields, content, moreSongs } = fromChordProFile(toChordProFile(sheet, 'https://leadsheet.fm/sheet/a/1'))
    expect(fields).toEqual({
      title: 'Wonderwall',
      artist: 'Oasis',
      album: "(What's the Story) Morning Glory?",
      key: 'Em',
      capo: 2,
      tuning: 'eb-standard',
      description: 'Strum D DU UDU.\n\nPalm-mute the verses.',
    })
    expect(content).toBe('[Verse 1]\n[Em7]Today is [G]gonna be the day\n{comment: build up}')
    expect(moreSongs).toBe(false)
  })

  it('takes short names, subtitle as artist, and the first song of a songbook', () => {
    const file = '﻿{t:Creep}\r\n{st:Radiohead}\r\n{capo:0}\r\n[G]When you were here be[B]fore\r\n{ns}\r\n{t:Karma Police}\r\n[Am]Karma police'
    const { fields, content, moreSongs } = fromChordProFile(file)
    expect(fields).toEqual({ title: 'Creep', artist: 'Radiohead', capo: 0 })
    expect(content).toBe('[G]When you were here be[B]fore')
    expect(moreSongs).toBe(true)
  })

  it('keeps subtitle in the sheet when there’s an artist', () => {
    const { fields, content } = fromChordProFile('{title: Hurt}\n{artist: Johnny Cash}\n{subtitle: Nine Inch Nails cover}\n[Am]I hurt myself today')
    expect(fields.artist).toBe('Johnny Cash')
    expect(content).toBe('{subtitle: Nine Inch Nails cover}\n[Am]I hurt myself today')
  })

  it('finds the tuning for the file’s instrument, and ignores capos it can’t use', () => {
    const { fields } = fromChordProFile('{title: x}\n{meta: instrument ukulele}\n{meta: tuning Low G}\n{capo: 40}\n[C]la')
    expect(fields).toEqual({ title: 'x', kind: 'ukulele', tuning: 'low-g' })
  })

  it('converts a plain text file of chords above lyrics', () => {
    const { fields, content } = fromChordProFile('Em7      G\nToday is gonna be the day\n')
    expect(fields).toEqual({})
    expect(content).toBe('[Em7]Today is [G]gonna be the day')
  })
})

describe('chordProFileName', () => {
  it('names the file for the song, without characters file systems refuse', () => {
    expect(chordProFileName({ title: 'What/Ever?', artist: 'AC:DC' })).toBe('AC DC - What Ever.cho')
    expect(chordProFileName({ title: '', artist: '' })).toBe('sheet.cho')
  })
})
