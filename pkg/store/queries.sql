-- Queries for sqlc (`just sqlc` regenerates pkg/store/dbq).

-- Sheets ----------------------------------------------------------------

-- name: SheetForkOf :one
SELECT fork_of_uri FROM sheets WHERE uri = $1;

-- name: UpsertSheet :exec
INSERT INTO sheets (uri, did, rkey, cid, title, artist, album, artist_slug, title_slug,
    kind, key, capo, tuning, difficulty, description, tags, tags_text, content, lyrics,
    voicings, links, draft, fork_of_uri, fork_of_cid, created_at, updated_at)
VALUES (@uri, @did, @rkey, @cid, @title, @artist, @album, @artist_slug, @title_slug,
    @kind, @key, @capo, @tuning, @difficulty, @description, @tags, @tags_text, @content, @lyrics,
    @voicings, @links, @draft, @fork_of_uri, @fork_of_cid, @created_at, @updated_at)
ON CONFLICT (uri) DO UPDATE SET
    cid = excluded.cid, title = excluded.title, artist = excluded.artist, album = excluded.album,
    artist_slug = excluded.artist_slug, title_slug = excluded.title_slug, kind = excluded.kind,
    key = excluded.key, capo = excluded.capo, tuning = excluded.tuning,
    difficulty = excluded.difficulty, description = excluded.description, tags = excluded.tags,
    tags_text = excluded.tags_text, content = excluded.content, lyrics = excluded.lyrics,
    voicings = excluded.voicings, links = excluded.links, draft = excluded.draft,
    fork_of_uri = excluded.fork_of_uri, fork_of_cid = excluded.fork_of_cid,
    created_at = excluded.created_at, updated_at = excluded.updated_at, indexed_at = now();

-- name: DeleteSheet :one
DELETE FROM sheets WHERE uri = $1 RETURNING fork_of_uri;

-- name: GetSheet :one
-- Drafts included: the caller decides who may see one.
SELECT sqlc.embed(ss), s.content, s.description, s.voicings, s.links
FROM sheet_summaries_all ss JOIN sheets s ON s.uri = ss.uri
WHERE ss.uri = $1;

-- name: GetSheetSummary :one
SELECT * FROM sheet_summaries WHERE uri = $1;

-- name: ListSheetsRecent :many
SELECT * FROM sheet_summaries ORDER BY created_at DESC LIMIT $1 OFFSET $2;

-- name: ListSheetsTop :many
-- Rated sheets only: an unrated one has nothing to rank it by.
SELECT * FROM sheet_summaries WHERE rating_count > 0
ORDER BY rating_score DESC, favorite_count DESC, created_at DESC
LIMIT $1 OFFSET $2;

-- name: SheetsByDID :many
SELECT * FROM sheet_summaries WHERE did = $1 ORDER BY created_at DESC;

-- name: DraftsByDID :many
SELECT * FROM sheet_summaries_all WHERE did = $1 AND draft ORDER BY updated_at DESC;

-- name: Forks :many
SELECT * FROM sheet_summaries WHERE fork_of_uri = $1 ORDER BY rating_score DESC, created_at;

-- name: SongSheets :many
SELECT * FROM sheet_summaries WHERE artist_slug = $1 AND title_slug = $2 ORDER BY created_at, uri;

-- name: ArtistSheets :many
SELECT * FROM sheet_summaries WHERE artist_slug = $1 ORDER BY title_slug;

-- name: SearchSheets :many
-- Every word must match (the last as a prefix), or the names must be a
-- near miss, spaced or not ("deathcab", "death cab"). A title or artist
-- match always outranks a lyrics-only one: it gets a flat bonus, and
-- ts_rank's lyric weight is tiny so a word repeated through a chorus
-- can't pile up past it.
WITH q AS (SELECT to_tsquery('simple', sqlc.arg(query)::text) AS query),
hits AS (
    SELECT s.uri,
        (CASE WHEN to_tsvector('simple', s.names) @@ q.query THEN 4 ELSE 0 END)
            + 2 * GREATEST(word_similarity(sqlc.arg(plain)::text, s.names),
                           word_similarity(sqlc.arg(compact)::text, s.names_compact))
            + ts_rank(s.search, q.query) AS rank,
        CASE WHEN to_tsvector('simple', s.lyrics) @@ q.query
            THEN ts_headline('simple', s.lyrics, q.query, sqlc.arg(headline_opts)::text)
            ELSE '' END AS snip
    FROM sheets s, q
    WHERE NOT s.draft AND (s.search @@ q.query
        OR sqlc.arg(plain)::text <% s.names
        OR sqlc.arg(compact)::text <% s.names_compact)
    ORDER BY rank DESC
    LIMIT 500
)
SELECT sqlc.embed(ss), h.snip::text AS snippet
FROM hits h JOIN sheet_summaries ss ON ss.uri = h.uri
ORDER BY h.rank DESC;

-- name: EnsureProfile :exec
INSERT INTO profiles (did) VALUES ($1) ON CONFLICT DO NOTHING;

-- Ratings, favorites, stats ----------------------------------------------

-- name: RecomputeStats :exec
-- An account's newest rating of a sheet is the one that counts; the score
-- is a Bayesian average toward prior_mean.
INSERT INTO sheet_stats (uri, rating_count, rating_avg, rating_score, favorite_count, fork_count)
SELECT sqlc.arg(uri)::text, r.n, COALESCE(r.avg, 0),
    (sqlc.arg(prior_mean)::float8 * sqlc.arg(prior_weight)::float8 + COALESCE(r.total, 0))
        / (sqlc.arg(prior_weight)::float8 + r.n),
    f.n, k.n
FROM
    (SELECT COUNT(*)::int AS n, AVG(value)::float8 AS avg, SUM(value)::float8 AS total
     FROM (SELECT DISTINCT ON (did) value FROM ratings WHERE subject_uri = sqlc.arg(uri)::text
           ORDER BY did, created_at DESC, uri DESC) newest) r,
    (SELECT COUNT(DISTINCT did)::int AS n FROM favorites WHERE subject_uri = sqlc.arg(uri)::text) f,
    -- Counted as Forks lists them: not drafts, not hidden accounts'.
    (SELECT COUNT(*)::int AS n FROM sheets s LEFT JOIN profiles p ON p.did = s.did
     WHERE s.fork_of_uri = sqlc.arg(uri)::text AND NOT s.draft AND NOT COALESCE(p.hidden, false)) k
ON CONFLICT (uri) DO UPDATE SET
    rating_count = excluded.rating_count, rating_avg = excluded.rating_avg,
    rating_score = excluded.rating_score, favorite_count = excluded.favorite_count,
    fork_count = excluded.fork_count;

-- name: RatingSubject :one
SELECT subject_uri FROM ratings WHERE uri = $1;

-- name: UpsertRating :exec
INSERT INTO ratings (uri, did, subject_uri, subject_cid, value, created_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (uri) DO UPDATE SET subject_uri = excluded.subject_uri,
    subject_cid = excluded.subject_cid, value = excluded.value, created_at = excluded.created_at;

-- name: DeleteRating :one
DELETE FROM ratings WHERE uri = $1 RETURNING subject_uri;

-- name: FavoriteSubject :one
SELECT subject_uri FROM favorites WHERE uri = $1;

-- name: UpsertFavorite :exec
INSERT INTO favorites (uri, did, subject_uri, subject_cid, created_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (uri) DO UPDATE SET subject_uri = excluded.subject_uri,
    subject_cid = excluded.subject_cid, created_at = excluded.created_at;

-- name: DeleteFavorite :one
DELETE FROM favorites WHERE uri = $1 RETURNING subject_uri;

-- name: ViewerRatings :many
SELECT uri, value FROM ratings WHERE did = $1 AND subject_uri = $2 ORDER BY created_at DESC, uri DESC;

-- name: ViewerFavorites :many
SELECT uri FROM favorites WHERE did = $1 AND subject_uri = $2;

-- name: FavoriteSheets :many
SELECT ss.* FROM sheet_summaries ss
JOIN (SELECT fv.subject_uri, MAX(fv.created_at) AS faved_at FROM favorites fv WHERE fv.did = $1 GROUP BY fv.subject_uri) f
    ON f.subject_uri = ss.uri
ORDER BY f.faved_at DESC;

-- Accounts --------------------------------------------------------------

-- name: AccountSubjects :many
-- Sheets whose stats an account's records feed into.
SELECT r.subject_uri FROM ratings r WHERE r.did = sqlc.arg(did)::text
UNION SELECT f.subject_uri FROM favorites f WHERE f.did = sqlc.arg(did)::text
UNION SELECT s.fork_of_uri FROM sheets s WHERE s.did = sqlc.arg(did)::text AND s.fork_of_uri <> '';

-- name: DeleteAccountSheets :exec
DELETE FROM sheets WHERE did = $1;

-- name: DeleteAccountRatings :exec
DELETE FROM ratings WHERE did = $1;

-- name: DeleteAccountFavorites :exec
DELETE FROM favorites WHERE did = $1;

-- name: DeleteProfile :exec
DELETE FROM profiles WHERE did = $1;

-- name: AuthorByDID :one
SELECT did, handle, display_name, avatar FROM profiles WHERE did = $1 AND NOT hidden;

-- name: AuthorByHandle :one
SELECT did, handle, display_name, avatar FROM profiles WHERE handle = $1 AND NOT hidden;

-- name: UpsertProfile :exec
-- A lookup that failed (keep_handle, keep_profile) leaves what we had.
INSERT INTO profiles (did, handle, display_name, avatar, resolved_at)
VALUES (@did, @handle, @display_name, @avatar, now())
ON CONFLICT (did) DO UPDATE SET
    handle = CASE WHEN @keep_handle::bool THEN profiles.handle ELSE excluded.handle END,
    display_name = CASE WHEN @keep_profile::bool THEN profiles.display_name ELSE excluded.display_name END,
    avatar = CASE WHEN @keep_profile::bool THEN profiles.avatar ELSE excluded.avatar END,
    resolved_at = excluded.resolved_at;

-- name: MarkProfileStale :exec
UPDATE profiles SET resolved_at = NULL WHERE did = $1;

-- name: SetHidden :exec
UPDATE profiles SET hidden = $2 WHERE did = $1 AND hidden <> $2;

-- name: StaleProfiles :many
SELECT did FROM profiles
WHERE resolved_at IS NULL OR resolved_at < $1
ORDER BY resolved_at NULLS FIRST
LIMIT $2;

-- name: GetState :one
SELECT value FROM ingest_state WHERE name = $1;

-- name: SetState :exec
INSERT INTO ingest_state (name, value) VALUES ($1, $2)
ON CONFLICT (name) DO UPDATE SET value = excluded.value;

-- OAuth and browser sessions ---------------------------------------------

-- name: GetOAuthSession :one
SELECT data FROM oauth_sessions WHERE did = $1 AND session_id = $2;

-- name: SaveOAuthSession :exec
INSERT INTO oauth_sessions (did, session_id, data) VALUES ($1, $2, $3)
ON CONFLICT (did, session_id) DO UPDATE SET data = excluded.data, updated_at = now();

-- name: DeleteOAuthSession :exec
DELETE FROM oauth_sessions WHERE did = $1 AND session_id = $2;

-- name: GetOAuthRequest :one
SELECT data FROM oauth_requests WHERE state = $1 AND created_at > $2;

-- name: SaveOAuthRequest :exec
INSERT INTO oauth_requests (state, data) VALUES ($1, $2);

-- name: DeleteOAuthRequest :exec
DELETE FROM oauth_requests WHERE state = $1;

-- name: DeleteOAuthRequestsBefore :exec
DELETE FROM oauth_requests WHERE created_at < $1;

-- name: CreateWebSession :exec
INSERT INTO web_sessions (token, did, session_id) VALUES ($1, $2, $3);

-- name: GetWebSession :one
SELECT did, session_id FROM web_sessions WHERE token = $1 AND created_at > $2;

-- name: DeleteWebSession :exec
DELETE FROM web_sessions WHERE token = $1;

-- name: DeleteWebSessionsBefore :exec
DELETE FROM web_sessions WHERE created_at < $1;

-- Link-preview images -----------------------------------------------------

-- name: GetOGCard :one
SELECT png FROM og_cards WHERE uri = $1 AND version = $2 AND rendered_at > $3;

-- name: PutOGCard :exec
INSERT INTO og_cards (uri, version, png) VALUES ($1, $2, $3)
ON CONFLICT (uri) DO UPDATE SET version = excluded.version, png = excluded.png, rendered_at = now();

-- name: DeleteOGCard :exec
DELETE FROM og_cards WHERE uri = $1;

-- name: DeleteAccountOGCards :exec
DELETE FROM og_cards WHERE starts_with(uri, 'at://' || sqlc.arg(did)::text || '/');

-- Cleanup (see Store.Cleanup) ---------------------------------------------

-- name: CleanOGCards :execrows
-- Cards nobody has asked for in a while, or whose sheet is gone.
DELETE FROM og_cards o
WHERE o.rendered_at < $1 OR NOT EXISTS (SELECT 1 FROM sheets s WHERE s.uri = o.uri);

-- name: CleanWebSessions :execrows
DELETE FROM web_sessions WHERE created_at < $1;

-- name: CleanOAuthRequests :execrows
DELETE FROM oauth_requests WHERE created_at < $1;

-- name: CleanOAuthSessions :execrows
-- OAuth sessions are only reachable through a browser session; once none
-- points at one (signed out, expired) it's dead weight. updated_at gives a
-- sign-in in progress time to create its browser session.
DELETE FROM oauth_sessions o
WHERE o.updated_at < $1
    AND NOT EXISTS (SELECT 1 FROM web_sessions w WHERE w.did = o.did AND w.session_id = o.session_id);

-- name: CleanSheetStats :execrows
-- Stats for sheets that are gone and that nothing points at anymore.
DELETE FROM sheet_stats st
WHERE st.rating_count = 0 AND st.favorite_count = 0 AND st.fork_count = 0
    AND NOT EXISTS (SELECT 1 FROM sheets s WHERE s.uri = st.uri);

-- Usage gauges (see metrics.Collector) ------------------------------------

-- name: UsageStats :one
SELECT
    (SELECT COUNT(*) FROM sheets s1 WHERE NOT s1.draft)::bigint AS sheets,
    (SELECT COUNT(*) FROM sheets d WHERE d.draft)::bigint AS drafts,
    (SELECT COUNT(DISTINCT s2.did) FROM sheets s2 WHERE NOT s2.draft)::bigint AS authors,
    (SELECT COUNT(*) FROM sheets s3 WHERE NOT s3.draft AND s3.created_at > now() - interval '24 hours')::bigint AS sheets_24h,
    (SELECT COUNT(*) FROM (SELECT DISTINCT r.did, r.subject_uri FROM ratings r) rr)::bigint AS ratings,
    (SELECT COUNT(*) FROM (SELECT DISTINCT f.did, f.subject_uri FROM favorites f) ff)::bigint AS favorites,
    (SELECT COUNT(*) FROM profiles p)::bigint AS accounts,
    (SELECT COUNT(DISTINCT w.did) FROM web_sessions w WHERE w.created_at > sqlc.arg(session_cutoff)::timestamptz)::bigint AS signed_in_accounts,
    (SELECT COUNT(*) FROM og_cards o)::bigint AS og_cards,
    pg_database_size(current_database())::bigint AS db_size_bytes;

-- name: SheetsByKind :many
SELECT s.kind, COUNT(*)::bigint AS n FROM sheets s WHERE NOT s.draft GROUP BY s.kind;
