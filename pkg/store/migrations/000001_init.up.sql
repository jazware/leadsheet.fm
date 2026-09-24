-- Indexed fm.leadsheet.sheet records. The PDS is the source of truth; every
-- row here can be rebuilt from the firehose or a backfill.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE sheets (
    uri          TEXT PRIMARY KEY,
    did          TEXT NOT NULL,
    rkey         TEXT NOT NULL,
    cid          TEXT NOT NULL,
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,
    album        TEXT NOT NULL DEFAULT '',
    artist_slug  TEXT NOT NULL,
    title_slug   TEXT NOT NULL,
    kind         TEXT NOT NULL,
    key          TEXT NOT NULL DEFAULT '',
    capo         INTEGER NOT NULL DEFAULT 0,
    tuning       TEXT NOT NULL DEFAULT '',
    difficulty   TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    tags         TEXT[] NOT NULL DEFAULT '{}',
    -- tags joined with spaces, for the search vector (array_to_string
    -- isn't immutable, so a generated column can't call it).
    tags_text    TEXT NOT NULL DEFAULT '',
    content      TEXT NOT NULL,
    -- The content's words, chords and directives stripped, for search.
    lyrics       TEXT NOT NULL DEFAULT '',
    fork_of_uri  TEXT NOT NULL DEFAULT '',
    fork_of_cid  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    names         TEXT GENERATED ALWAYS AS (lower(title || ' ' || artist)) STORED,
    names_compact TEXT GENERATED ALWAYS AS (
        regexp_replace(lower(title || artist), '[^[:alnum:]]+', '', 'g')) STORED,
    -- Title outranks artist outranks tags outranks lyrics. 'simple' (no
    -- stemming) since lyrics come in every language.
    search       TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', title), 'A') ||
        setweight(to_tsvector('simple', artist), 'B') ||
        setweight(to_tsvector('simple', tags_text), 'C') ||
        setweight(to_tsvector('simple', lyrics), 'D')
    ) STORED
);
CREATE INDEX sheets_song ON sheets (artist_slug, title_slug);
CREATE INDEX sheets_did ON sheets (did, created_at);
CREATE INDEX sheets_fork_of ON sheets (fork_of_uri) WHERE fork_of_uri <> '';
CREATE INDEX sheets_created ON sheets (created_at);
CREATE INDEX sheets_search ON sheets USING GIN (search);
-- Typo-tolerant fallback on names, with and without spaces so
-- "deathcab" finds "Death Cab" and "death cab" finds "Deathcab".
CREATE INDEX sheets_names_trgm ON sheets USING GIN (names gin_trgm_ops);
CREATE INDEX sheets_names_compact_trgm ON sheets USING GIN (names_compact gin_trgm_ops);

CREATE TABLE ratings (
    uri          TEXT PRIMARY KEY,
    did          TEXT NOT NULL,
    subject_uri  TEXT NOT NULL,
    subject_cid  TEXT NOT NULL,
    value        INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX ratings_subject ON ratings (subject_uri);
CREATE INDEX ratings_did_subject ON ratings (did, subject_uri);

CREATE TABLE favorites (
    uri          TEXT PRIMARY KEY,
    did          TEXT NOT NULL,
    subject_uri  TEXT NOT NULL,
    subject_cid  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX favorites_subject ON favorites (subject_uri);
CREATE INDEX favorites_did ON favorites (did, created_at);

-- Aggregates per sheet URI, recomputed whenever a rating, favorite, or
-- fork pointing at it changes. Rows may exist for sheets we haven't
-- indexed (yet).
CREATE TABLE sheet_stats (
    uri             TEXT PRIMARY KEY,
    rating_count    INTEGER NOT NULL DEFAULT 0,
    rating_avg      DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Bayesian average, pulled toward 3 stars until a sheet has a few
    -- ratings, so one 5-star vote doesn't top the charts.
    rating_score    DOUBLE PRECISION NOT NULL DEFAULT 3,
    favorite_count  INTEGER NOT NULL DEFAULT 0,
    fork_count      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sheet_stats_score ON sheet_stats (rating_score);

CREATE TABLE profiles (
    did           TEXT PRIMARY KEY,
    handle        TEXT NOT NULL DEFAULT '',
    display_name  TEXT NOT NULL DEFAULT '',
    avatar        TEXT NOT NULL DEFAULT '',
    -- Set while the account is deactivated, suspended or taken down;
    -- its records stay indexed but hidden.
    hidden        BOOLEAN NOT NULL DEFAULT false,
    resolved_at   TIMESTAMPTZ -- NULL = never
);
CREATE INDEX profiles_handle ON profiles (handle);
CREATE INDEX profiles_resolved ON profiles (resolved_at NULLS FIRST);

CREATE TABLE ingest_state (
    name   TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- Sheets as lists show them: with their stats and author, and without
-- hidden (deactivated/suspended) accounts. Unrated sheets score the prior
-- mean of 3.
CREATE VIEW sheet_summaries AS
SELECT s.uri, s.did, s.rkey, s.cid, s.title, s.artist, s.album, s.artist_slug, s.title_slug,
    s.kind, s.key, s.capo, s.tuning, s.difficulty, s.tags, s.fork_of_uri, s.fork_of_cid,
    s.created_at, s.updated_at,
    COALESCE(p.handle, '')::text AS handle,
    COALESCE(p.display_name, '')::text AS display_name,
    COALESCE(p.avatar, '')::text AS avatar,
    COALESCE(st.rating_count, 0)::int AS rating_count,
    COALESCE(st.rating_avg, 0)::float8 AS rating_avg,
    COALESCE(st.rating_score, 3)::float8 AS rating_score,
    COALESCE(st.favorite_count, 0)::int AS favorite_count,
    COALESCE(st.fork_count, 0)::int AS fork_count
FROM sheets s
LEFT JOIN sheet_stats st ON st.uri = s.uri
LEFT JOIN profiles p ON p.did = s.did
WHERE NOT COALESCE(p.hidden, false);

-- atproto OAuth client state (indigo's ClientAuthStore).
CREATE TABLE oauth_sessions (
    did         TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (did, session_id)
);
CREATE TABLE oauth_requests (
    state       TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Browser sessions: an opaque cookie token pointing at an OAuth session.
CREATE TABLE web_sessions (
    token       TEXT PRIMARY KEY,
    did         TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
