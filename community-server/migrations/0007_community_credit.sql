-- Contributor credit (opt-in name for the Hall of Fame) and recordings per modem model.
ALTER TABLE router_issues ADD COLUMN credit TEXT NOT NULL DEFAULT '';
ALTER TABLE router_issues ADD COLUMN recordings INTEGER NOT NULL DEFAULT 0;
UPDATE router_issues SET recordings = 1 WHERE length(capture) > 0;
