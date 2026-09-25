# leadsheet 🎸

Chord sheets and tabs on atproto, in the spirit of Ultimate Guitar. Every
sheet, rating and favorite is a record in its author's own repo
(`fm.leadsheet.*`). Leadsheet is an AppView: it follows the network, indexes those
records into Postgres, and serves search, song pages and a sheet viewer with
transpose, capo, autoscroll and chord diagrams. It runs at https://leadsheet.fm.

## Running

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

## Importing from Ultimate Guitar

`/import` hands out a "Send to Leadsheet" bookmarklet. On a UG chords or tab
page it reads the tab from the page (`window.UGAPP.store.page.data`, or the
older `.js-store`), and opens `/new#import=<base64 JSON>` here: the URL
fragment never reaches a server. The editor turns UG's `[ch]`/`[tab]` markup
into ChordPro (`ui/src/lib/ultimateGuitar.ts`), maps type, key, capo, tuning
and difficulty, credits the transcriber in the notes, and keeps it as a
draft until the user publishes. Pasting UG markup or chords-over-lyrics
text into the editor converts too. `just ui-test` covers the conversion.

## Instruments

A sheet's `kind` picks the instrument: chords and tab are guitar, then
ukulele and bass. Each has its own tunings (`ui/src/lib/tunings.ts`;
"standard" or unset is the instrument's standard: EADGBE, GCEA, EADG) and
its own shapes: guitar's hand-checked shapes plus a fretboard search;
ukulele from the same search with ukulele rules (every string rings, the
root needn't be lowest, as the G string is re-entrant) plus the chart
shapes where the easiest search result isn't what charts print; bass as
root, fifth and octave. Playing sounds like the instrument: a softer
pluck for nylon ukulele strings, and a bass line (root, root-root, fifth,
octave) instead of a strum.

## Chord shapes

Hovering (or tapping) a chord shows its box; the arrows under it, or ←/→
while the chord name has focus, step through up to eight voicings: the
hand-checked shapes first, then the best of a fretboard search
(`shapesFor` in `ui/src/lib/guitar.ts`). A reader's pick is remembered in
their browser and shared by the tooltip and the Shapes panel.

Authors can save shapes with the sheet: the record's optional `voicings`
(`[{"chord": "C", "frets": [-1, 3, 2, 0, 1, 0]}]`, frets per string,
lowest first, in the sheet's tuning relative to its capo, -1 = not
played). The editor's Shapes section steps through shapes or takes typed
frets, and forking or editing a sheet carries over the shapes the reader
picked on it. Readers see the author's shape first (marked with a dot)
while the chords are shown as written, and can still pick another for
themselves.

Clicking a chord box strums it (`ui/src/lib/pluck.ts`): Karplus-Strong
plucked strings in Web Audio, in tune to a few cents, at the sheet's real
tuning plus the reader's capo. Once something has played, stepping to
another shape plays that one too, to compare them by ear.

"Hear the chords" (sidebar, the phone's text-size panel, stage mode) plays
the whole chart through with the shapes the boxes show: a bar of "down,
down-up, up-down-up" per chord at a set tempo, queued on the audio clock,
lighting each chord up and scrolling along like play-along. The sheet
doesn't say how long each chord lasts, so every chord gets a bar.

## Play along

The microphone button on a sheet (rail, bottom bar and stage mode) listens
while you play, lights up the chord you're on and keeps it in view. It all
runs in the browser, and no audio leaves the device (`ui/src/listen/`):

- A Web Worker computes constant-Q frames as audio arrives (`cqt.ts`, the
  features chordex's analyzer feeds BTC) and reruns
  [BTC](https://github.com/jayg996/BTC-ISMIR19) (MIT, `model/LICENSE-BTC`)
  over the newest 10 s every ~0.28 s with onnxruntime-web on
  single-threaded WASM. No cross-origin isolation is needed. The 13 MB model
  and 14 MB runtime are fingerprinted assets, cached for good after the
  first use.
- `follow.ts` is an online HMM over the sheet's chords in order: stay,
  advance or skip one, each chord lasting at least ~0.4 s. Longer moves only
  go to a section start: back (repeats) or one of the next two, with
  anything further down far less likely. Misheard audio scores as "junk"
  rather than as evidence for somewhere else, and the marker only makes a
  far move once it has clearly led for ~1 s. It never leaps down the page
  on a messy second, and a real jump shows up a few seconds in.
  It runs all twelve transpositions at once, starting from what the page
  implies (shapes under the capo, or the chords as written), so a sheet
  written either way, or played in another key, still lines up. Repeated
  chords move by the player's pace, and silence stops the clock.
- The model was exported, and the features checked against librosa, in
  `packages/chordex/ondevice` (mono repo). `just ui-test` runs the follower
  and an end-to-end test on synthesized audio.

## Database

Postgres, via pgx. The schema is golang-migrate files in
`pkg/store/migrations/` (applied on startup); queries live in
`pkg/store/queries.sql` and `just sqlc` generates `pkg/store/dbq` from
them. Lists read the `sheet_summaries` view (sheets + stats + author,
minus hidden accounts).

Search is Postgres full-text search with `'simple'` (no stemming, since
lyrics come in every language): title outranks artist outranks tags
outranks lyrics, and a title or artist match always beats a lyrics-only
one. `pg_trgm` catches near misses on names, with and without spaces
("deathcab" finds "Death Cab for Cutie"). Lyric matches come back with a
highlighted snippet.

## Deploying

`build/docker-compose.yml` runs the app and Postgres 17. Put
`POSTGRES_PASSWORD=` (and optionally `LEADSHEET_OAUTH_CLIENT_KEY=`, see
OAuth) in `env/leadsheet.env`, set `LEADSHEET_PUBLIC_URL` in the compose file
to your domain, and `just up`. The app listens on :8120 and needs HTTPS in
front of it (any reverse proxy or a Cloudflare Tunnel). PDS servers fetch
`/oauth/client-metadata.json` server-side, so bot challenges must not apply
to `/oauth/*`. Prometheus metrics and pprof are on 127.0.0.1:8122.

## Lexicons

Schemas are in `lexicons/fm/leadsheet/`. The server validates every record
against them, whether it arrives from the firehose, a backfill, or a write.

| NSID | What |
|------|------|
| `fm.leadsheet.sheet` | A sheet: title, artist, `content` in ChordPro (`[C]` inline chords, `{directives}`, `{start_of_tab}` blocks), kind (chords/tab/ukulele/bass), key, capo, tuning, difficulty, notes, tags. `forkOf` is a strong ref to the sheet it was derived from. |
| `fm.leadsheet.rating` | 1–5 stars on a sheet (strong ref). An account's newest rating of a sheet is the one that counts. |
| `fm.leadsheet.favorite` | Saves a sheet to the account's favorites. |

The `key` of a sheet is the key the chords are written in. With a capo that's
the shape key, so the sounding key is `key + capo`.

**Versions** aren't a record. Sheets are grouped into songs by normalized
artist and title slugs: accents, "The", "feat. …", and "(Live)"/"- Remastered"
suffixes are ignored (`pkg/records/slug.go`). They're numbered in publication
order, like UG's "ver 2", and ranked by a Bayesian average rating.

## Ingest

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

Writes from the UI go to the user's PDS over OAuth and are indexed
immediately. The same commit arriving later from Jetstream is an idempotent
upsert.

## OAuth

atproto OAuth via indigo's `atproto/auth/oauth`. Sign-in requests
`atproto include:fm.leadsheet.authFull`: a published permission set
(`lexicons/fm/leadsheet/authFull.json`) granting repo access to the
`fm.leadsheet.*` collections and nothing else. Auth servers resolve it via
`_lexicon.leadsheet.fm` and show its title on the consent screen, so it must
be published (`just lex-publish`) before the app asks for it.

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

## Configuration

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
| `--debug` | `LEADSHEET_DEBUG` | off |

## Lexicon publishing

The `@leadsheet.fm` account (`did:plc:h2pnmd2phwtpwwar2amai6a5`) publishes the schemas; `_atproto.leadsheet.fm` and
`_lexicon.leadsheet.fm` TXT records point at it. After changing a schema:
`just lex-lint`, then `GOAT_USERNAME=leadsheet.fm GOAT_PASSWORD=<app password>
just lex-publish --update` (only backward-compatible changes; `goat lex
breaking` flags the rest).

## Still to do

- Moderation: labeler support and a way to hide sheets.
