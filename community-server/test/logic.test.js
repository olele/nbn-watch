import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregate, buildAlerts, buildStats, decryptLoc, encryptLoc, gridCentre, logRows, planIncident, planWatch, sha256Hex, validateReport } from "../src/logic.js";

const DEVICE = "0123456789abcdef0123456789abcdef";
const good = {
  v: 1, device: DEVICE, zone: "CSA300000000459", suburb: "Kew", tech: "HFC",
  nbn: "unplanned", connection: "mobile", mobile_tech: "4G",
  mobile_since: "2026-11-25T21:39+00:00", down_mbps: 18.04,
};

test("valid report is normalised", () => {
  const r = validateReport(good);
  assert.ok(r.ok);
  assert.equal(r.value.down_mbps, 18);
  assert.equal(r.value.mobile_since, "2026-11-25T21:39:00.000Z");
});

test("rejects bad fields", () => {
  for (const patch of [
    { v: 2 }, { device: "x" }, { zone: "LOC000000000042" }, { nbn: "maybe" },
    { connection: "wifi" }, { down_mbps: -1 }, { down_mbps: "9" }, { mobile_since: "never" },
  ]) {
    assert.equal(validateReport({ ...good, ...patch }).ok, false, JSON.stringify(patch));
  }
  assert.equal(validateReport(null).ok, false);
  assert.equal(validateReport([]).ok, false);
});

test("drops unsafe text and mobile fields when on NBN", () => {
  const r = validateReport({ ...good, suburb: "<script>", connection: "nbn" });
  assert.equal(r.value.suburb, "");
  assert.equal(r.value.mobile_tech, "");
  assert.equal(r.value.mobile_since, null);
});

const NOW = 1_800_000_000;
const row = (i, over = {}) => ({
  device_hash: "d" + i, zone: "CSA300000000459", suburb: "Kew", tech: "HFC",
  nbn: "ok", connection: "nbn", down_mbps: 100, updated_at: NOW - 60, ...over,
});

test("single reporter zones are shown by default", () => {
  assert.equal(aggregate([row(1)], { nowSec: NOW }).zones.length, 1);
  const out = aggregate([row(1), row(2)], { nowSec: NOW, minReporters: 3 });
  assert.deepEqual(out.zones, []);
  assert.equal(out.hidden_reporters, 2);
});

test("stale reports are ignored", () => {
  const out = aggregate([row(1), row(2), row(3, { updated_at: NOW - 3600 })], { nowSec: NOW });
  assert.equal(out.zones[0].reporters, 2);
});

test("outage zone summary", () => {
  const rows = [
    row(1, { nbn: "unplanned", connection: "mobile", down_mbps: 15 }),
    row(2, { nbn: "unplanned", connection: "unknown", down_mbps: null }),
    row(3, { down_mbps: 90 }),
    row(4, { down_mbps: 110, suburb: "Kew East" }),
    row(5, { zone: "CSA300000000001", suburb: "Hawthorn" }),
    row(6, { zone: "CSA300000000001" }), row(7, { zone: "CSA300000000001" }),
  ];
  const out = aggregate(rows, { nowSec: NOW, minReporters: 3 });
  assert.equal(out.zones.length, 2);
  const [kew, other] = out.zones;
  assert.equal(kew.status, "down");
  assert.equal(kew.suburb, "Kew");
  assert.equal(kew.affected, 2);
  assert.equal(kew.on_mobile, 1);
  assert.equal(kew.router_reporters, 3);
  assert.equal(kew.median_down_mbps, 100); // mobile speeds excluded
  assert.equal(other.status, "ok");
});

test("degraded and planned", () => {
  const deg = aggregate([row(1, { nbn: "unplanned" }), row(2), row(3), row(4)], { nowSec: NOW, minReporters: 3 });
  assert.equal(deg.zones[0].status, "degraded");
  const plan = aggregate([row(1, { nbn: "planned" }), row(2, { nbn: "planned" }), row(3)], { nowSec: NOW });
  assert.equal(plan.zones[0].status, "planned");
});

test("sha256Hex", async () => {
  assert.equal((await sha256Hex("abc")).slice(0, 8), "ba7816bf");
});

test("location is re-snapped to the grid and bounded to Australia", () => {
  const r = validateReport({ ...good, lat: -37.80123, lng: 145.03789, state: "VIC", postcode: "3101" });
  assert.equal(r.value.lat, -37.805);
  assert.equal(r.value.lng, 145.035);
  assert.equal(r.value.postcode, "3101");
  assert.equal(validateReport({ ...good, lat: 51.5, lng: -0.1 }).ok, false);
  const none = validateReport({ ...good, state: "XX", postcode: "abc" }).value;
  assert.deepEqual([none.lat, none.state, none.postcode], [null, "", ""]);
  assert.equal(gridCentre(-37.80999), -37.805);
});

const rep = (over = {}) => validateReport({ ...good, ...over }).value;

test("incident lifecycle: open, touch, recover", () => {
  const opened = planIncident(null, rep(), NOW);
  assert.equal(opened.action, "open");
  assert.equal(opened.kind, "mobile_backup");
  const open = { id: 1, zone: good.zone, kind: "mobile_backup" };
  assert.equal(planIncident(open, rep({ connection: "unknown", nbn: "unplanned" }), NOW).action, "touch");
  // Router back on NBN closes it even while NBN Co still lists the outage (their page lags).
  assert.equal(planIncident(open, rep({ connection: "nbn", nbn: "unplanned" }), NOW).action, "close");
  assert.equal(planIncident(open, rep({ connection: "nbn", nbn: "unplanned" }), NOW).ended_at, NOW);
  assert.equal(planIncident(null, rep({ connection: "nbn", nbn: "unplanned" }), NOW).action, "none");
  assert.equal(planIncident(open, rep({ connection: "nbn", nbn: "ok" }), NOW).action, "close");
  assert.equal(planIncident(null, rep({ connection: "nbn", nbn: "ok" }), NOW).action, "none");
  assert.equal(planIncident(null, rep({ connection: "unknown", nbn: "degraded" }), NOW).kind, "degraded");
  assert.equal(planIncident(null, rep({ connection: "unknown", nbn: "planned" }), NOW).action, "none");
});

test("incident start is back-dated only within limits", () => {
  const now = Math.floor(Date.parse("2026-11-26T06:00:00Z") / 1000);
  const recent = planIncident(null, rep({ mobile_since: "2026-11-25T21:39+00:00" }), now);
  assert.equal(recent.started_at, Math.floor(Date.parse("2026-11-25T21:39:00Z") / 1000));
  assert.equal(planIncident(null, rep({ mobile_since: "2026-11-01T00:00+00:00" }), now).started_at, now);
  assert.equal(planIncident(null, rep({ mobile_since: "2026-12-01T00:00+00:00" }), now).started_at, now);
});

test("moving zone closes the old incident", () => {
  const open = { id: 1, zone: "CSA300000000001", kind: "nbn_outage" };
  assert.equal(planIncident(open, rep(), NOW).action, "reopen");
  assert.equal(planIncident(open, rep({ connection: "nbn", nbn: "ok" }), NOW).action, "close");
});

test("alerts group by grid cell and flag quiet devices", () => {
  const inc = (over) => ({ zone: "CSA300000000459", suburb: "Kew", state: "VIC", postcode: "3101",
    lat: -37.805, lng: 145.035, kind: "nbn_outage", started_at: NOW - 3600, last_seen: NOW - 60, ...over });
  const alerts = buildAlerts([
    inc({}), inc({ kind: "mobile_backup", started_at: NOW - 7200 }),
    inc({ lat: -37.815, kind: "degraded", last_seen: NOW - 3600 }),
    inc({ lat: null, lng: null, zone: "CSA300000000001" }),
  ], NOW);
  assert.equal(alerts.length, 3);
  assert.equal(alerts[0].devices, 2);
  assert.deepEqual(alerts[0].kinds, { nbn_outage: 1, mobile_backup: 1 });
  assert.equal(alerts[0].since, new Date((NOW - 7200) * 1000).toISOString());
  assert.equal(alerts[0].reporting, true);
  const deg = alerts.find((a) => a.severity === "degraded");
  assert.equal(deg.reporting, false);
  assert.equal(alerts.find((a) => a.lat === null).zone, "CSA300000000001");
});

test("log rows hide device ids and compute durations", () => {
  const rows = logRows([
    { zone: "Z", suburb: "Kew", kind: "nbn_outage", started_at: NOW - 5400, ended_at: NOW, end_reason: "recovered", device_hash: "secret" },
    { zone: "Z", suburb: "Kew", kind: "mobile_backup", started_at: NOW - 600, ended_at: null },
    { zone: "Z", suburb: "Kew", kind: "degraded", started_at: NOW - 600, ended_at: NOW - 60, end_reason: "no_reports" },
  ], NOW);
  assert.equal(rows[0].status, "recovered");
  assert.equal(rows[0].duration_min, 90);
  assert.equal(rows[1].status, "ongoing");
  assert.equal(rows[2].status, "no_reports");
  assert.ok(!JSON.stringify(rows).includes("secret"));
});

test("loc_id accepted only on problem reports", () => {
  assert.equal(validateReport({ ...good, loc_id: "LOC000000000042" }).value.loc_id, "LOC000000000042");
  assert.equal(validateReport({ ...good, loc_id: "LOC000000000042", connection: "nbn", nbn: "ok" }).value.loc_id, null);
  assert.equal(validateReport({ ...good, loc_id: "1 Smith St" }).value.loc_id, null);
});

test("loc_id encryption round-trips and fails closed", async () => {
  const enc = await encryptLoc("salt", "LOC000000000042");
  assert.ok(!enc.includes("LOC"));
  assert.notEqual(enc, await encryptLoc("salt", "LOC000000000042")); // random IV
  assert.equal(await decryptLoc("salt", enc), "LOC000000000042");
  assert.equal(await decryptLoc("other-salt", enc), null);
  assert.equal(await decryptLoc("salt", "garbage"), null);
});

test("server watch closes only confirmed outages on quiet devices", () => {
  const quiet = { nbn_confirmed: 1, last_seen: NOW - 3600 };
  const active = { nbn_confirmed: 1, last_seen: NOW - 60 };
  assert.equal(planWatch(quiet, "NO_OUTAGE", NOW).action, "close");
  assert.equal(planWatch(active, "NO_OUTAGE", NOW).action, "restored");
  assert.equal(planWatch(quiet, "UNPLANNED_INPROGRESS", NOW).action, "still_down");
  assert.equal(planWatch(quiet, "DEGRADATION_INPROGRESS", NOW).action, "still_down");
  assert.equal(planWatch({ ...quiet, nbn_confirmed: 0 }, "NO_OUTAGE", NOW).action, "none"); // local fault
  assert.equal(planWatch(quiet, "", NOW).action, "none"); // API error
});

test("log shows server-detected recovery", () => {
  const [row] = logRows([{ zone: "Z", suburb: "Kew", kind: "nbn_outage", started_at: NOW - 600, ended_at: NOW, end_reason: "nbn_restored" }], NOW);
  assert.equal(row.status, "nbn_restored");
});

test("recovery time comes from the router when it is back on NBN", () => {
  const open = { id: 1, zone: good.zone, kind: "nbn_outage", started_at: NOW - 7200 };
  const back = rep({ connection: "nbn", nbn: "unplanned", nbn_since: new Date((NOW - 3600) * 1000).toISOString() });
  assert.deepEqual(planIncident(open, back, NOW), { action: "close", ended_at: NOW - 3600 });
  const before = rep({ connection: "nbn", nbn: "ok", nbn_since: new Date((NOW - 9000) * 1000).toISOString() });
  assert.equal(planIncident(open, before, NOW).ended_at, NOW); // older than the incident: use now
  assert.equal(validateReport({ ...good, connection: "nbn", nbn_since: "x" }).ok, false);
});

test("stats: counts, recovery times, groups and daily series", () => {
  const day = 86400;
  const t0 = Math.floor(NOW / day) * day;
  const inc = (over) => ({ kind: "nbn_outage", suburb: "Kew", state: "VIC", tech: "HFC",
    started_at: NOW - 3600, ended_at: NOW - 1800, end_reason: "recovered", ...over });
  const s = buildStats([
    inc({}),                                                   // 30 min
    inc({ started_at: t0 - day + 3600, ended_at: t0 - day + 3600 + 7200 }), // 120 min, yesterday
    inc({ ended_at: null, end_reason: null }),                 // ongoing
    inc({ kind: "user_report", suburb: "Hawthorn", tech: "FTTP", ended_at: NOW - 3000 }),
  ], NOW, 7);
  assert.equal(s.overall.incidents, 4);
  assert.equal(s.overall.ongoing, 1);
  assert.equal(s.overall.mean_recovery_min, Math.round((30 + 120 + 10) / 3));
  assert.equal(s.overall.longest_min, 120);
  assert.deepEqual(s.sources, { app: 3, people: 1 });
  assert.equal(s.areas[0].area, "Kew VIC");
  assert.equal(s.tech.find((x) => x.tech === "FTTP").incidents, 1);
  assert.equal(s.daily.length, 7);
  assert.equal(s.daily.at(-1).incidents, 3); // today (NOW is 8h into its UTC day)
  assert.equal(s.daily.at(-2).incidents, 1);
  assert.equal(buildStats([], NOW, 30).overall.mean_recovery_min, null);
});
