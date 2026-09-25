/** Links to where a song can be heard (a sheet's `links`). */

/** An http(s) URL with a host: the only links Leadsheet shows. */
export function isWebLink(s: string): boolean {
  try {
    const u = new URL(s)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname
  } catch {
    return false
  }
}

const SERVICES: [RegExp, string][] = [
  [/(^|\.)music\.youtube\.com$/, 'YouTube Music'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)music\.apple\.com$/, 'Apple Music'],
  [/(^|\.)tidal\.com$/, 'Tidal'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)archive\.org$/, 'Internet Archive'],
]

/** What to call a link: the service, or the site's name. */
export function linkLabel(s: string): string {
  const host = new URL(s).hostname.toLowerCase()
  return SERVICES.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '')
}

/** How to embed a link's player, for the services that allow it from the URL alone. */
export interface Embed {
  src: string
  /** Fixed height in px, or a 16:9 video box when absent. */
  height?: number
  title: string
}

/**
 * The player for a YouTube, Spotify or SoundCloud link, or null. (Bandcamp
 * players need an album or track id that isn't in the page URL.)
 */
export function embedFor(link: string): Embed | null {
  if (!isWebLink(link)) return null
  const u = new URL(link)
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    const id =
      host === 'youtu.be'
        ? u.pathname.slice(1).split('/')[0]
        : u.pathname === '/watch'
          ? u.searchParams.get('v')
          : /^\/(shorts|live|embed)\/([^/]+)/.exec(u.pathname)?.[2]
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null
    // A start time, "?t=90" or "&t=1m30s".
    const t = u.searchParams.get('t') ?? u.searchParams.get('start')
    const m = t && /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t)
    const start = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
    return {
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ''}`,
      title: 'YouTube player',
    }
  }

  if (host === 'open.spotify.com') {
    // "/track/ID", "/intl-de/album/ID", "/playlist/ID"…
    const m = /^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(u.pathname)
    if (!m) return null
    return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352, title: 'Spotify player' }
  }

  if (host === 'soundcloud.com') {
    // A track or a set: "/artist/track" or "/artist/sets/name".
    if (!/^\/[^/]+\/(sets\/)?[^/]+\/?$/.test(u.pathname)) return null
    const target = `https://soundcloud.com${u.pathname}`
    return {
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(target)}&auto_play=true&visual=false&color=%23ffc857&show_comments=false`,
      height: 166,
      title: 'SoundCloud player',
    }
  }
  return null
}
