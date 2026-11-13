-- Room settings an admin changes in the app (the Branding tab). One row per setting, value is JSON.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
