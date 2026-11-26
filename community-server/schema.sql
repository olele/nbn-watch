-- One row per device: its latest report. No addresses, LOC IDs or raw IPs.
CREATE TABLE IF NOT EXISTS reports (
  device_hash  TEXT PRIMARY KEY,   -- sha256(salt + device id)
  ip_hash      TEXT NOT NULL,      -- sha256(salt + day + ip), rotates daily; anti-spam only
  zone         TEXT NOT NULL,      -- NBN serving area, e.g. CSA300000000459
  suburb       TEXT NOT NULL DEFAULT '',
  tech         TEXT NOT NULL DEFAULT '',
  nbn          TEXT NOT NULL,      -- ok | unplanned | degraded | planned | error
  connection   TEXT NOT NULL,      -- nbn | mobile | unknown
  mobile_tech  TEXT NOT NULL DEFAULT '',
  mobile_since TEXT,
  down_mbps    REAL,
  updated_at   INTEGER NOT NULL,   -- unix seconds
  state        TEXT NOT NULL DEFAULT '',
  postcode     TEXT NOT NULL DEFAULT '',
  lat          REAL,               -- ~1 km grid-cell centre, never the address
  lng          REAL
);
CREATE INDEX IF NOT EXISTS reports_updated ON reports (updated_at);
CREATE INDEX IF NOT EXISTS reports_ip ON reports (ip_hash, updated_at);
