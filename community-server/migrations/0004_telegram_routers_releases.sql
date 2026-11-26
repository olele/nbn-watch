-- Telegram linking through the community bot (codes expire after 15 minutes).
CREATE TABLE IF NOT EXISTS tg_codes (
  code        TEXT PRIMARY KEY,
  device_hash TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_links (
  device_hash TEXT PRIMARY KEY,
  chat_id     INTEGER NOT NULL,
  first_name  TEXT NOT NULL DEFAULT '',
  linked_at   INTEGER NOT NULL,
  win_start   INTEGER,            -- hourly notification rate window
  win_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tg_links_chat ON tg_links (chat_id);

-- Routers the app could not read: fingerprints only, never passwords.
CREATE TABLE IF NOT EXISTS router_issues (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fp_key            TEXT NOT NULL UNIQUE,
  gateway_vendor    TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL DEFAULT '',
  server_header     TEXT NOT NULL DEFAULT '',
  realm             TEXT NOT NULL DEFAULT '',
  upnp_manufacturer TEXT NOT NULL DEFAULT '',
  upnp_model        TEXT NOT NULL DEFAULT '',
  upnp_model_number TEXT NOT NULL DEFAULT '',
  upnp_friendly     TEXT NOT NULL DEFAULT '',
  login_page        TEXT NOT NULL DEFAULT '',
  paths             TEXT NOT NULL DEFAULT '[]',
  error             TEXT NOT NULL DEFAULT '',
  isp               TEXT NOT NULL DEFAULT '',
  country           TEXT NOT NULL DEFAULT '',
  os                TEXT NOT NULL DEFAULT '',
  app_version       TEXT NOT NULL DEFAULT '',
  first_seen        INTEGER NOT NULL,
  last_seen         INTEGER NOT NULL,
  reports           INTEGER NOT NULL DEFAULT 1,
  devices           TEXT NOT NULL DEFAULT '',   -- truncated device hashes (distinct count only)
  synced            INTEGER NOT NULL DEFAULT 0  -- 1 once copied to a GitHub issue
);

-- Latest desktop build per platform (auto-update manifest).
CREATE TABLE IF NOT EXISTS app_releases (
  platform     TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  url          TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL
);
