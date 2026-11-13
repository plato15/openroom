-- Optional custom link per file (/d/<slug>). Kept when the file is replaced.
ALTER TABLE files ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX files_slug ON files(slug) WHERE slug IS NOT NULL;
