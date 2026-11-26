-- Several official registers (NBN Co + providers) share one table.
ALTER TABLE nbnco_outages ADD COLUMN source TEXT NOT NULL DEFAULT 'nbnco';
UPDATE nbnco_outages SET ref = 'nbnco:' || ref WHERE ref NOT LIKE '%:%';
CREATE INDEX IF NOT EXISTS nbnco_outages_source ON nbnco_outages (source, start_at);
