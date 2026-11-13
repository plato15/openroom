-- Subfolders, one level deep: a folder with a parent is shown inside it. Access is granted on
-- top-level folders only, and covers their subfolders.
ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id);
CREATE INDEX folders_parent ON folders(parent_id);

-- Placeholder documents added by a template ("replace this with your pitch deck"). They can
-- never be made visible; uploading a new version turns them into real documents.
ALTER TABLE files ADD COLUMN placeholder INTEGER NOT NULL DEFAULT 0;
