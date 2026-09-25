import { describe, expect, it } from 'vitest'
import { embedFor, isWebLink, linkLabel } from '@/lib/links'

describe('links', () => {
  it('only takes web links', () => {
    expect(isWebLink('https://youtu.be/abc')).toBe(true)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
    expect(isWebLink('youtube.com/watch?v=1')).toBe(false)
    expect(isWebLink('')).toBe(false)
  })

  it('names the service', () => {
    expect(linkLabel('https://www.youtube.com/watch?v=abc')).toBe('YouTube')
    expect(linkLabel('https://youtu.be/abc')).toBe('YouTube')
    expect(linkLabel('https://music.youtube.com/watch?v=abc')).toBe('YouTube Music')
    expect(linkLabel('https://someband.bandcamp.com/track/song')).toBe('Bandcamp')
    expect(linkLabel('https://open.spotify.com/track/1')).toBe('Spotify')
    expect(linkLabel('https://music.apple.com/us/album/x')).toBe('Apple Music')
    expect(linkLabel('https://www.someband.net/songs')).toBe('someband.net')
  })
})


describe('embedFor', () => {
  it('embeds YouTube, with a start time', () => {
    for (const l of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ']) {
      expect(embedFor(l)?.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
    }
    expect(embedFor('https://youtu.be/dQw4w9WgXcQ?t=90')?.src).toContain('start=90')
    expect(embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')?.src).toContain('start=90')
    expect(embedFor('https://www.youtube.com/@someone')).toBeNull()
  })

  it('embeds Spotify tracks and albums', () => {
    expect(embedFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x')).toMatchObject({ src: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', height: 152 })
    expect(embedFor('https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3')).toMatchObject({ src: 'https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3', height: 352 })
    expect(embedFor('https://open.spotify.com/')).toBeNull()
  })

  it('embeds SoundCloud tracks and sets', () => {
    const e = embedFor('https://soundcloud.com/someartist/some-track?in=x')!
    expect(e.src).toContain(encodeURIComponent('https://soundcloud.com/someartist/some-track'))
    expect(e.src).not.toContain('in%3Dx')
    expect(embedFor('https://soundcloud.com/someartist/sets/an-album')).not.toBeNull()
    expect(embedFor('https://soundcloud.com/someartist')).toBeNull()
  })

  it("doesn't embed anything else", () => {
    expect(embedFor('https://someband.bandcamp.com/track/song')).toBeNull()
    expect(embedFor('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(embedFor('javascript:alert(1)')).toBeNull()
  })
})
