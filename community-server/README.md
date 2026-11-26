# NBN community server

Cloudflare Worker + D1 that collects anonymous reports from the NBN monitor
app and publishes a per-zone outage page.

| Route | |
|---|---|
| `POST /api/report` | anonymous report from the app (validated, rate-limited) |
| `GET /api/zones` | devices reporting per zone (JSON) |
| `GET /api/alerts` | open problems as ~1 km map markers (JSON) |
| `GET /api/incidents?days=7` | problem log: started / recovered / duration (JSON) |
| `GET /` | public map + active alerts + problem log |

Every report that shows a problem (NBN Co unplanned/degraded, or the router on
mobile backup) opens an incident for that device; the device's next normal
report closes it with the recovery time. A device that goes quiet while
affected (no backup, so offline) keeps its alert open, marked "went quiet";
after 3 days with no reports the cron closes it as `no_reports`.

**Server recovery watch** (every 5 minutes): while a report shows a problem, the
app also sends its LOC ID (`COMMUNITY_RECOVERY_WATCH=0` turns this off). The
server stores it AES-GCM encrypted on that open incident only and checks the
NBN API. When NBN Co reports normal for an outage it had confirmed:
- device quiet (offline) → incident closed as `nbn_restored` (🏢 server check);
- device still reporting a problem (e.g. still on 4G) → flagged "NBN Co reports
  normal" but left to the device to close.
The LOC ID is deleted when the incident closes (and by the daily cleanup).

## Privacy model

- The app uploads only the NBN serving area (`CSA…`), suburb, state/postcode,
  the centre of the ~1 km grid square containing the address (re-snapped by the
  server too), access technology, NBN Co state, router connection (nbn/mobile), 3G/4G/5G and a
  recent download speed. Never the address, LOC ID or router password.
- The device id is random. The server stores `sha256(salt + device)` and a
  daily-rotating `sha256(salt + day + ip)` used only for rate limiting; raw IPs
  are never stored.
- Every report counts (`MIN_REPORTERS=1`); raise it to hide zone counts with
  few devices. Devices silent for 7 days and log entries older than 90 days
  are deleted by a daily cron.

## Develop

```bash
npm install
npx wrangler d1 execute nbn-community --local --file=schema.sql
npx wrangler d1 execute nbn-community --local --file=incidents.sql
cp .dev.vars.example .dev.vars   # sets HASH_SALT for local dev
npm run dev -- --port 8799
npm test
```

## Deploy (free tier)

```bash
npx wrangler login
npx wrangler d1 create nbn-community          # paste database_id into wrangler.toml
npx wrangler d1 execute nbn-community --remote --file=schema.sql
npx wrangler d1 execute nbn-community --remote --file=incidents.sql
# existing databases: apply migrations/000N_*.sql in order instead
openssl rand -hex 32 | npx wrangler secret put HASH_SALT
npm run deploy                                # prints https://nbn-community.<you>.workers.dev
```

Then on each app install set `COMMUNITY_URL=https://nbn-community.<you>.workers.dev`.
