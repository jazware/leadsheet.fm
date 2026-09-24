-- Chord shapes the author chose (the record's voicings), as JSON:
-- [{"chord": "C", "frets": [-1, 3, 2, 0, 1, 0]}, ...].
ALTER TABLE sheets ADD COLUMN voicings JSONB NOT NULL DEFAULT '[]';
