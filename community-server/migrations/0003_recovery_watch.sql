-- Server-side recovery watch: encrypted LOC ID on open incidents only.
ALTER TABLE incidents ADD COLUMN loc_enc TEXT;            -- AES-GCM, deleted when the incident closes
ALTER TABLE incidents ADD COLUMN nbn_confirmed INTEGER NOT NULL DEFAULT 0;  -- NBN Co reported an outage
ALTER TABLE incidents ADD COLUMN nbn_restored_at INTEGER; -- server saw NBN Co report normal
ALTER TABLE incidents ADD COLUMN checked_at INTEGER;      -- last server-side NBN check
