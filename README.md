# leadsheet 🎸

Chord sheets and tabs on atproto, in the spirit of Ultimate Guitar. Every
sheet, rating and favorite is a record in its author's own repo
(`fm.leadsheet.*`). Leadsheet is an AppView: it follows the network, indexes
those records into Postgres, and serves search, song pages and a sheet
viewer. It runs at https://leadsheet.fm.

On a sheet you can:

- transpose, set a capo, simplify chords and spell them with sharps or flats;
- read it for [guitar, ukulele, bass or piano](#instruments-tunings-and-sound),
  in the tuning you have;
- step through chord shapes, click a chord to hear it, or
  [hear the whole chart](#instruments-tunings-and-sound);
- autoscroll, or [play along](#play-along) and have the page follow you;
- listen to the recording it follows, and fork it into your own version.

Sheets come in from the editor, as [drafts](#records) until published, or
[from Ultimate Guitar](#importing-from-ultimate-guitar).

## Records

Schemas are in `lexicons/fm/leadsheet/`. The server validates every record
against them, whether it arrives from the firehose, a backfill, or a write.

| NSID | What |
|------|------|
| `fm.leadsheet.sheet` | A sheet: title, artist, album, `content` in ChordPro (`[C]` inline chords, `{directives}`, `{start_of_tab}` blocks), kind (chords/tab/ukulele/bass/piano), key, capo, tuning, difficulty, description, tags, `voicings`, `links` and `draft`. `forkOf` is a strong ref to the sheet it was derived from. |
| `fm.leadsheet.rating` | 1–5 stars on a sheet (strong ref). An account's newest rating of a sheet is the one that counts. |
| `fm.leadsheet.favorite` | Saves a sheet to the account's favorites. |

Sheet fields worth knowing:

- **`key`** is the key the chords are written in. With a capo that's the
  shape key, so the sounding key is `key + capo`.
- **`voicings`** are the author's chord shapes, e.g.
  `[{"chord": "C", "frets": [-1, 3, 2, 0, 1, 0]}]`: frets per string,
  lowest first, in the sheet's tuning relative to its capo, -1 for a
  string not played.
- **`links`** (up to five) say where to hear the recording the sheet
  follows. Only http(s) links are accepted when saving, indexed, or shown,
  whoever wrote the record.
- **`draft: true`** marks an unpublished sheet. It's in the author's repo
  like any record (so publicly readable there, which the UI says), but
  Leadsheet lists, searches, counts and previews only published sheets and
  shows a draft only to its author: on their profile's Drafts tab and on
  the sheet itself, with a Publish button. Publishing sets `draft` to false
  and `createdAt` to the moment of publishing, so it lists as new.

**Versions** aren't a record. Sheets are grouped into songs by normalized
artist and title slugs: accents, "The", "feat. …", and "(Live)"/"- Remastered"
suffixes are ignored (`pkg/records/slug.go`). They're numbered in publication
order, like UG's "ver 2", and ranked by a Bayesian average rating.

**Permissions:** sign-in requests `atproto include:fm.leadsheet.authFull`,
a published permission set (`lexicons/fm/leadsheet/authFull.json`) granting
repo access to the `fm.leadsheet.*` collections and nothing else. Auth
servers resolve it via `_lexicon.leadsheet.fm` and show its title on the
consent screen, so it must be published before the app asks for it.

**Publishing:** the `@leadsheet.fm` account
(`did:plc:h2pnmd2phwtpwwar2amai6a5`) publishes the schemas;
`_atproto.leadsheet.fm` and `_lexicon.leadsheet.fm` TXT records point at it.
After changing a schema: `just lex-lint`, then `GOAT_USERNAME=leadsheet.fm
GOAT_PASSWORD=<app password> just lex-publish --update` (only
backward-compatible changes; `goat lex breaking` flags the rest).

## How it works

### Ingest

- **Firehose:** [Jetstream v2](https://github.com/bluesky-social/jetstream)
  filtered to `fm.leadsheet.*`, cursor saved in Postgres. Without an API key only
  the live tail (and its lookback window) is available. With
  `JETSTREAM_API_KEY`, Leadsheet replays the archive instead, which gives an
  exact resume after any amount of downtime.
- **Backfill:** on first start (or `just backfill`), the relay's
  `com.atproto.sync.listReposByCollection` lists every repo with Leadsheet
  records, and each is paged through with `listRecords` on its PDS. Signing
  in also backfills your own repo.
- **Accounts:** deleted accounts are purged; deactivated, suspended or taken
  down accounts are hidden until they're active again. Handles are resolved
  (and verified) through the identity directory. Display names and avatars
  come from the account's Bluesky profile when it has one.
- **Outbound calls** (relay, PDSes, Bluesky) have timeouts and retry reads
  with backoff (`packages/telemetry/robusthttp`). A repo its PDS reports
  as gone is skipped, not failed.

Writes from the UI go to the user's PDS over OAuth and are indexed
immediately. The same commit arriving later from Jetstream is an idempotent
upsert.

### Database and search

Postgres, via pgx. The schema is golang-migrate files in
`pkg/store/migrations/` (applied on startup); queries live in
`pkg/store/queries.sql` and `just sqlc` generates `pkg/store/dbq` from
them. Lists read the `sheet_summaries` view (sheets + stats + author,
minus drafts and hidden accounts); `sheet_summaries_all` keeps drafts.

Search is Postgres full-text search with `'simple'` (no stemming, since
lyrics come in every language): title outranks artist outranks tags
outranks lyrics, and a title or artist match always beats a lyrics-only
one. `pg_trgm` catches near misses on names, with and without spaces
("deathcab" finds "Death Cab for Cutie"). Lyric matches come back with a
highlighted snippet.

### Instruments, tunings and sound

A sheet's `kind` picks the instrument it's written for: chords and tab are
guitar, then ukulele, bass and piano. Each fretted instrument has its own
tunings (`ui/src/lib/tunings.ts`; "standard" or unset is EADGBE, GCEA,
EADG) and shapes: guitar's hand-checked shapes plus a fretboard search
(`ui/src/lib/guitar.ts`), ukulele from the same search with ukulele rules,
bass as root, fifth and octave. Piano (`ui/src/lib/piano.ts`) shows the
right hand on a keyboard with the bass note under it.

Readers can switch a sheet to another instrument (remembered in the
browser) or tuning (per sheet). The chords follow so the song still
sounds at pitch: another instrument reads them at sounding pitch (a capo-5
guitar chart's Am is Dm), and a lowered tuning moves the shapes up (a
standard chart read half a step down shows B♭m for Am). The author's own
shapes apply only as written.

Each chord's box steps through up to eight voicings (the hand-checked
shapes, then the best of the fretboard search) and opens on the author's,
marked with a dot. A reader's pick is kept in their browser, and forking
or editing a sheet carries it over into the new sheet's `voicings`.

Clicking a chord plays it (`ui/src/lib/pluck.ts`: Karplus-Strong strings,
or a synthesized piano, in Web Audio at the reader's tuning and capo).
"Hear the chords" plays the whole chart, a bar per chord at a set tempo,
lighting up and scrolling along as it goes. Switching instrument, key or
shapes while it plays carries on with the new sound.

YouTube, Spotify and SoundCloud `links` play in place (`embedFor` in
`ui/src/lib/links.ts`), loaded only when pressed, so reading a sheet
doesn't contact those sites.

### Play along

The Follow button (the mic) listens while you play, lights up the chord
you're on and keeps it in view. It all runs in the browser, and no audio
leaves the device (`ui/src/listen/`):

- A Web Worker computes constant-Q frames and runs
  [BTC](https://github.com/jayg996/BTC-ISMIR19) (MIT,
  `ui/src/listen/model/LICENSE-BTC`) with onnxruntime-web on
  single-threaded WASM, so no cross-origin isolation is needed. The model
  and runtime (about 27 MB together) are cached for good after first use.
- `follow.ts` is an online HMM over the sheet's chords in order, across
  all twelve transpositions, that only jumps to section starts and only
  once it's sure, so it never leaps down the page on a messy second.
- The model was exported, and its features checked against librosa, in
  `packages/chordex/ondevice`. `just ui-test` runs the follower and an
  end-to-end test on synthesized audio.

### Importing from Ultimate Guitar

`/import` hands out a "Send to Leadsheet" bookmarklet. On a UG chords or tab
page it reads the tab from the page (`window.UGAPP.store.page.data`, or the
older `.js-store`), and opens `/new#import=<base64 JSON>` here: the URL
fragment never reaches a server. The editor turns UG's `[ch]`/`[tab]` markup
into ChordPro (`ui/src/lib/ultimateGuitar.ts`), maps type, key, capo, tuning
and difficulty, credits the transcriber in the description, and keeps it as
a draft until the user publishes. Pasting UG markup or chords-over-lyrics
text into the editor converts too. `just ui-test` covers the conversion.

## Running it

### Development

```bash
just db        # local Postgres 17 on 127.0.0.1:5433 (docker)
just build
./bin/leadsheet
# → http://127.0.0.1:8120  (use 127.0.0.1, not localhost: see OAuth below)
```

For development (two terminals):

```bash
just dev       # Postgres + Go backend on :8120, OAuth callbacks via :3004
just ui-dev    # Vite on http://127.0.0.1:3004, proxies /api and /oauth
```

`just test` runs the Go tests against a throwaway Postgres; each test
gets its own database.

### Deploying

`build/docker-compose.yml` runs the app and Postgres 17. Put
`POSTGRES_PASSWORD=` (and optionally `LEADSHEET_OAUTH_CLIENT_KEY=`, see
OAuth) in `env/leadsheet.env`, set `LEADSHEET_PUBLIC_URL` in the compose file
to your domain, and `just up`. The app listens on :8120 and needs HTTPS in
front of it (any reverse proxy or a Cloudflare Tunnel). PDS servers fetch
`/oauth/client-metadata.json` server-side, so bot challenges must not apply
to `/oauth/*`. Prometheus metrics and pprof are on 127.0.0.1:8122. Set
`OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP collector for traces of
requests, outbound calls, queries and background work.

### OAuth

atproto OAuth via indigo's `atproto/auth/oauth`, asking for the
[permission set](#records) above.

- A **loopback** `--public-url` makes a development client: no client
  metadata to host, and the callback must be on `127.0.0.1`. Browse to
  `127.0.0.1` (not `localhost`) so the session cookie matches.
- Any **other** `--public-url` makes a client whose `client_id` is
  `<url>/oauth/client-metadata.json`, served by the app. With
  `--oauth-client-key` (a P-256 key from `leadsheet gen-client-key`) it's a
  **confidential** client: it signs token requests with that key, publishes
  the public half at `/oauth/jwks.json`, and gets longer sessions. To rotate,
  set a new key with a new `--oauth-client-key-id`; sessions made with the
  old key need signing in again.

### Configuration

| Flag | Env var | Default |
|------|---------|---------|
| `--listen-address` | `LEADSHEET_LISTEN_ADDRESS` | `127.0.0.1:8120` |
| `--public-url` | `LEADSHEET_PUBLIC_URL` | `http://127.0.0.1:8120` |
| `--database-url` | `LEADSHEET_DATABASE_URL` | `postgres://leadsheet:leadsheet@127.0.0.1:5433/leadsheet?sslmode=disable` |
| `--jetstream-host` | `LEADSHEET_JETSTREAM_HOST` | `jetstream.us-east.bsky.network` |
| `--jetstream-api-key` | `JETSTREAM_API_KEY` | (none) |
| `--relay-host` | `LEADSHEET_RELAY_HOST` | `https://relay1.us-east.bsky.network` |
| `--bsky-appview` | `LEADSHEET_BSKY_APPVIEW` | `https://public.api.bsky.app` |
| `--backfill` | `LEADSHEET_BACKFILL` | off |
| `--no-ingest` | `LEADSHEET_NO_INGEST` | off |
| `--dev-origin` | `LEADSHEET_DEV_ORIGIN` | (none) |
| `--oauth-client-key` | `LEADSHEET_OAUTH_CLIENT_KEY` | (none: public client) |
| `--oauth-client-key-id` | `LEADSHEET_OAUTH_CLIENT_KEY_ID` | `k1` |
| `--metrics-listen-address` | `LEADSHEET_METRICS_LISTEN_ADDRESS` | `127.0.0.1:8122` |
| `--tracing-sample-ratio` | `TRACING_SAMPLE_RATIO` | `1.0` |
| (tracing endpoint) | `OTEL_EXPORTER_OTLP_ENDPOINT` | (none: tracing off) |
| `--debug` | `LEADSHEET_DEBUG` | off |

## Still to do

- Moderation: labeler support and a way to hide sheets.
