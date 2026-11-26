-- NBN Co's public outage register (major / significant local outages, published
-- under ACMA rules, usually a couple of days after the outage is fixed).
CREATE TABLE IF NOT EXISTS nbnco_outages (
  ref         TEXT PRIMARY KEY,           -- e.g. ACM000000000150
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '',   -- e.g. Significant local outage
  start_at    INTEGER NOT NULL,           -- unix seconds
  end_at      INTEGER,
  duration_h  REAL,
  suburbs     TEXT NOT NULL DEFAULT '',   -- "A; B; C"
  states      TEXT NOT NULL DEFAULT '',
  postcodes   TEXT NOT NULL DEFAULT '',
  techs       TEXT NOT NULL DEFAULT '',
  premises    INTEGER,
  cause       TEXT NOT NULL DEFAULT '',
  natural     TEXT NOT NULL DEFAULT '',
  info        TEXT NOT NULL DEFAULT '',
  published   TEXT NOT NULL DEFAULT '',
  points      TEXT NOT NULL DEFAULT '[]', -- [[lng,lat],...] postcode centres; empty for very wide outages
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nbnco_outages_start ON nbnco_outages (start_at);

-- Postcode centres for placing the register on the map.
-- Data: GeoNames (https://www.geonames.org/), CC BY 4.0.
CREATE TABLE IF NOT EXISTS postcodes (
  postcode TEXT PRIMARY KEY,
  state    TEXT NOT NULL DEFAULT '',
  lat      REAL NOT NULL,
  lng      REAL NOT NULL
);
