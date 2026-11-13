-- Optional short link per folder (/<slug>), sharing one set of names with file links.
ALTER TABLE folders ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX folders_slug ON folders(slug) WHERE slug IS NOT NULL;
