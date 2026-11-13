-- Openroom. All times are milliseconds since the epoch (UTC).

CREATE TABLE investors (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT NOT NULL DEFAULT '',
  firm         TEXT NOT NULL DEFAULT '',
  expires_at   INTEGER,             -- access ends at this moment; NULL = no end date
  revoked_at   INTEGER,             -- set = no access at all
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE folders (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  allow_download INTEGER NOT NULL DEFAULT 0,
  watermark      INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);

CREATE TABLE files (
  id           TEXT PRIMARY KEY,
  folder_id    TEXT NOT NULL REFERENCES folders(id),
  name         TEXT NOT NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  published    INTEGER NOT NULL DEFAULT 0,  -- investors only ever see published files
  uploaded_at  INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX files_folder ON files(folder_id);

-- One row = this investor may see this folder.
CREATE TABLE grants (
  investor_id TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  folder_id   TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  granted_at  INTEGER NOT NULL,
  PRIMARY KEY (investor_id, folder_id)
);

-- Sign-in links. Only the SHA-256 of the token is stored.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX login_tokens_email ON login_tokens(email, created_at);

-- Only the SHA-256 of the session cookie is stored.
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  role       TEXT NOT NULL CHECK (role IN ('investor', 'admin')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_email ON sessions(email);

-- Who opened what. File and folder names are copied so history survives deletes.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  email       TEXT NOT NULL,
  action      TEXT NOT NULL,          -- sign_in, view, download, email_failed
  file_id     TEXT,
  file_name   TEXT,
  folder_name TEXT,
  ip          TEXT,
  country     TEXT,
  user_agent  TEXT
);
CREATE INDEX events_email ON events(email, at);
CREATE INDEX events_file ON events(file_id, at);
