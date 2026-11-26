-- Problem log: when each reporting device's issue started and recovered.
CREATE TABLE IF NOT EXISTS incidents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_hash  TEXT NOT NULL,
  zone         TEXT NOT NULL,
  suburb       TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT '',
  postcode     TEXT NOT NULL DEFAULT '',
  lat          REAL,
  lng          REAL,
  kind         TEXT NOT NULL,      -- nbn_outage | mobile_backup | degraded
  started_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  ended_at     INTEGER,            -- NULL while ongoing
  end_reason   TEXT,               -- recovered | nbn_restored | no_reports
  loc_enc      TEXT,               -- AES-GCM LOC ID, only while open (recovery watch)
  nbn_confirmed INTEGER NOT NULL DEFAULT 0,
  nbn_restored_at INTEGER,
  checked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS incidents_open ON incidents (device_hash) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS incidents_started ON incidents (started_at);
