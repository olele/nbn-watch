-- Manual outage reports (no app needed). Anonymous, protected by Turnstile + per-IP limits.
ALTER TABLE incidents ADD COLUMN problem TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN tech TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS incidents_kind ON incidents (kind, started_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  key       TEXT PRIMARY KEY,      -- "<purpose>:<daily ip hash>"
  win_start INTEGER NOT NULL,
  count     INTEGER NOT NULL
);
