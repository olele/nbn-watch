-- Diagnostic captures (sanitised on the user's computer) attached to router issues.
ALTER TABLE router_issues ADD COLUMN capture TEXT NOT NULL DEFAULT '';
ALTER TABLE router_issues ADD COLUMN capture_at INTEGER;
