CREATE TABLE IF NOT EXISTS font_files (
  id TEXT PRIMARY KEY,
  meta TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS font_searches (
  query TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS font_searches_expires_at ON font_searches (expires_at);
