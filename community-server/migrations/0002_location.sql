-- For databases created before location columns existed.
ALTER TABLE reports ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN postcode TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN lat REAL;
ALTER TABLE reports ADD COLUMN lng REAL;
