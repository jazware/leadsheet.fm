-- Drafts: sheets their author hasn't published. They're in the author's
-- repo like any record, but Leadsheet only shows them to the author.
ALTER TABLE sheets ADD COLUMN draft BOOLEAN NOT NULL DEFAULT false;

-- Every sheet, drafts included (for the author's own views), and the
-- public view everything else lists from.
DROP VIEW sheet_summaries;
CREATE VIEW sheet_summaries_all AS
SELECT s.uri, s.did, s.rkey, s.cid, s.title, s.artist, s.album, s.artist_slug, s.title_slug,
    s.kind, s.key, s.capo, s.tuning, s.difficulty, s.tags, s.fork_of_uri, s.fork_of_cid,
    s.created_at, s.updated_at, s.draft,
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

CREATE VIEW sheet_summaries AS
SELECT * FROM sheet_summaries_all WHERE NOT draft;
