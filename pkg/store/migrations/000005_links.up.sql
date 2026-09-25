-- Where to hear the recording a sheet follows (the record's links).
ALTER TABLE sheets ADD COLUMN links TEXT[] NOT NULL DEFAULT '{}';
