-- People asking for access from the sign-in page. Admins approve (choosing folders) or decline.
CREATE TABLE access_requests (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  name       TEXT NOT NULL DEFAULT '',
  firm       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  ip         TEXT
);
CREATE INDEX access_requests_status ON access_requests(status, created_at);
CREATE INDEX access_requests_email ON access_requests(email, created_at);
