-- Rendered link-preview images, one per sheet: its latest version.
CREATE TABLE og_cards (
    uri          TEXT PRIMARY KEY,
    version      TEXT NOT NULL,
    png          BYTEA NOT NULL,
    rendered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
