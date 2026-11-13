-- Downloads are switched on file by file (off by default), no longer per folder.
ALTER TABLE files ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 0;
UPDATE files SET allow_download = (SELECT allow_download FROM folders WHERE folders.id = files.folder_id);
ALTER TABLE folders DROP COLUMN allow_download;
