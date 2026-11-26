// Pure logic for the community server: validation and zone aggregation.
// No I/O here so it can be unit-tested with `node --test`.

export const NBN_STATES = ["ok", "unplanned", "degraded", "planned", "error"];
export const CONNECTIONS = ["nbn", "mobile", "unknown"];
const ZONE_RE = /^CSA\d{12}$/;
const DEVICE_RE = /^[0-9a-f]{32}$/;
const LOC_RE = /^LOC\d{12}$/;
const TEXT_RE = /^[\p{L}\p{N} .'()-]*$/u;
export const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
export const GRID_DEG = 0.01; // ~1 km cells: alerts show an area, never a house

/** Snap to the centre of a grid cell (server-side too, so exact points are never stored). */
export function gridCentre(value) {
  return Math.round((Math.floor(value / GRID_DEG) + 0.5) * GRID_DEG * 1000) / 1000;
}

/** Validate a client report. Returns {ok:true, value} or {ok:false, error}. */
export function validateReport(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("body must be an object");
  if (body.v !== 1) return bad("unsupported version");
  if (typeof body.device !== "string" || !DEVICE_RE.test(body.device)) return bad("bad device");
  if (typeof body.zone !== "string" || !ZONE_RE.test(body.zone)) return bad("bad zone");
  if (!NBN_STATES.includes(body.nbn)) return bad("bad nbn");
  if (!CONNECTIONS.includes(body.connection)) return bad("bad connection");
  const suburb = cleanText(body.suburb, 40);
  const tech = cleanText(body.tech, 12);
  const mobileTech = ["", "3G", "4G", "5G"].includes(body.mobile_tech ?? "") ? body.mobile_tech ?? "" : "";
  let down = null;
  if (body.down_mbps !== null && body.down_mbps !== undefined) {
    if (typeof body.down_mbps !== "number" || !Number.isFinite(body.down_mbps)) return bad("bad down_mbps");
    if (body.down_mbps < 0 || body.down_mbps > 10000) return bad("bad down_mbps");
    down = Math.round(body.down_mbps * 10) / 10;
  }
  let nbnSince = null;
  if (body.connection === "nbn" && typeof body.nbn_since === "string" && body.nbn_since) {
    const t = Date.parse(body.nbn_since);
    if (Number.isNaN(t)) return bad("bad nbn_since");
    nbnSince = new Date(t).toISOString();
  }
  let mobileSince = null;
  if (typeof body.mobile_since === "string" && body.mobile_since) {
    const t = Date.parse(body.mobile_since);
    if (Number.isNaN(t)) return bad("bad mobile_since");
    mobileSince = new Date(t).toISOString();
  }
  let lat = null;
  let lng = null;
  if (typeof body.lat === "number" && typeof body.lng === "number") {
    // Australia incl. Tasmania and territories' mainland bounds.
    if (body.lat < -45 || body.lat > -9 || body.lng < 112 || body.lng > 155) return bad("bad location");
    lat = gridCentre(body.lat);
    lng = gridCentre(body.lng);
  }
  const state = STATES.includes(body.state) ? body.state : "";
  const postcode = typeof body.postcode === "string" && /^\d{4}$/.test(body.postcode) ? body.postcode : "";
  return {
    ok: true,
    value: {
      device: body.device,
      zone: body.zone,
      suburb: suburb ?? "",
      tech: tech ?? "",
      state,
      postcode,
      lat,
      lng,
      // Recovery watch: only accepted on problem reports; never stored in plain text.
      loc_id: typeof body.loc_id === "string" && LOC_RE.test(body.loc_id) && incidentKind(body) ? body.loc_id : null,
      nbn: body.nbn,
      connection: body.connection,
      mobile_tech: body.connection === "mobile" ? mobileTech : "",
      mobile_since: body.connection === "mobile" ? mobileSince : null,
      nbn_since: nbnSince,
      down_mbps: down,
    },
  };
}

function bad(error) {
  return { ok: false, error };
}

function cleanText(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "";
  const s = value.trim().slice(0, max);
  return TEXT_RE.test(s) ? s : "";
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mode(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** A device counts as "affected" if NBN Co reports an outage or its router fell back to mobile. */
export function isAffected(row) {
  return row.nbn === "unplanned" || row.connection === "mobile";
}

/**
 * Combine the latest report per device into public zone summaries.
 * Zones with fewer than `minReporters` distinct devices are hidden (only
 * counted in `hidden_reporters`) so a single household is never exposed.
 * (Distinct IPs are not required: during an outage users share carrier
 * CGNAT addresses on 4G backup. Spam is limited per IP at ingest instead.)
 */
export function aggregate(rows, { nowSec, activeMinutes = 15, minReporters = 1 }) {
  const cutoff = nowSec - activeMinutes * 60;
  const byZone = new Map();
  for (const r of rows) {
    if (r.updated_at < cutoff) continue;
    if (!byZone.has(r.zone)) byZone.set(r.zone, []);
    byZone.get(r.zone).push(r);
  }
  const zones = [];
  let hidden = 0;
  for (const [zone, list] of byZone) {
    const devices = new Set(list.map((r) => r.device_hash)).size;
    if (devices < minReporters) {
      hidden += list.length;
      continue;
    }
    const affected = list.filter(isAffected).length;
    const nbnOutage = list.filter((r) => r.nbn === "unplanned").length;
    const degraded = list.filter((r) => r.nbn === "degraded").length;
    const planned = list.filter((r) => r.nbn === "planned").length;
    const routerKnown = list.filter((r) => r.connection !== "unknown");
    const onMobile = routerKnown.filter((r) => r.connection === "mobile").length;
    const nbnSpeeds = list.filter((r) => r.connection !== "mobile" && r.down_mbps != null).map((r) => r.down_mbps);
    const share = affected / list.length;
    let status = "ok";
    if (share >= 0.5) status = "down";
    else if (share >= 0.2 || degraded / list.length >= 0.5) status = "degraded";
    else if (planned / list.length >= 0.5) status = "planned";
    zones.push({
      zone,
      suburb: mode(list.map((r) => r.suburb)),
      tech: mode(list.map((r) => r.tech)),
      status,
      reporters: list.length,
      affected,
      nbn_outage: nbnOutage,
      degraded,
      planned,
      router_reporters: routerKnown.length,
      on_mobile: onMobile,
      median_down_mbps: median(nbnSpeeds),
      last_report: new Date(Math.max(...list.map((r) => r.updated_at)) * 1000).toISOString(),
    });
  }
  const order = { down: 0, degraded: 1, planned: 2, ok: 3 };
  zones.sort((a, b) => order[a.status] - order[b.status] || b.reporters - a.reporters || a.zone.localeCompare(b.zone));
  return {
    generated_at: new Date(nowSec * 1000).toISOString(),
    active_minutes: activeMinutes,
    min_reporters: minReporters,
    zones,
    hidden_reporters: hidden,
  };
}

// ---------------------------------------------------------------------------
// Incidents: one row per device problem, opened when a report shows an issue
// and closed (with the recovery time) when the same device reports normal.
// ---------------------------------------------------------------------------

export const MAX_BACKDATE_SEC = 2 * 24 * 3600;
export const STALE_SEC = 20 * 60; // no report for 20 min while affected: probably offline

/**
 * What kind of problem a report shows, or null if none.
 * A router reading is authoritative and real-time: on NBN means working, even
 * while NBN Co's status page still lists the (lagging) outage. NBN Co's status
 * decides only when the device cannot read its router.
 */
export function incidentKind(r) {
  if (r.connection === "mobile") return "mobile_backup";
  if (r.connection === "nbn") return null;
  if (r.nbn === "unplanned") return "nbn_outage";
  if (r.nbn === "degraded") return "degraded";
  return null;
}

/**
 * Decide what a report does to the device's open incident (if any).
 * Returns {action: "open" | "touch" | "close" | "reopen" | "none", ...}.
 */
export function planIncident(open, r, nowSec) {
  const kind = incidentKind(r);
  if (open && open.zone !== r.zone) {
    return kind ? { action: "reopen", kind, started_at: startTime(r, nowSec) } : { action: "close", ended_at: nowSec };
  }
  if (kind && !open) return { action: "open", kind, started_at: startTime(r, nowSec) };
  if (kind && open) return { action: "touch", kind };
  if (!kind && open) return { action: "close", ended_at: endTime(open, r, nowSec) };
  return { action: "none" };
}

// Recovery time: when the router came back on NBN, if it is within the incident.
function endTime(open, r, nowSec) {
  if (r.nbn_since) {
    const t = Math.floor(Date.parse(r.nbn_since) / 1000);
    if (Number.isFinite(t) && t <= nowSec && t >= (open.started_at ?? 0)) return t;
  }
  return nowSec;
}

function startTime(r, nowSec) {
  if (r.connection === "mobile" && r.mobile_since) {
    const t = Math.floor(Date.parse(r.mobile_since) / 1000);
    if (Number.isFinite(t) && t <= nowSec && nowSec - t <= MAX_BACKDATE_SEC) return t;
  }
  return nowSec;
}

const KIND_RANK = { nbn_outage: 3, mobile_backup: 3, degraded: 1 };

/** Group open incidents into map markers by grid cell (or zone when no location). */
export function buildAlerts(open, nowSec) {
  const groups = new Map();
  for (const i of open) {
    const key = i.lat != null && i.lng != null ? `${i.lat},${i.lng}` : `zone:${i.zone}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const alerts = [];
  for (const list of groups.values()) {
    const kinds = {};
    for (const i of list) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
    const top = Object.keys(kinds).sort((a, b) => (KIND_RANK[b] ?? 0) - (KIND_RANK[a] ?? 0))[0];
    const lastSeen = Math.max(...list.map((i) => i.last_seen));
    alerts.push({
      lat: list[0].lat ?? null,
      lng: list[0].lng ?? null,
      zone: list[0].zone,
      suburb: list[0].suburb,
      state: list[0].state ?? "",
      postcode: list[0].postcode ?? "",
      devices: list.length,
      kinds,
      severity: top === "degraded" ? "degraded" : "outage",
      since: iso(Math.min(...list.map((i) => i.started_at))),
      last_report: iso(lastSeen),
      reporting: nowSec - lastSeen <= STALE_SEC, // false: affected devices went quiet (offline?)
      nbn_restored: list.every((i) => i.nbn_restored_at != null), // NBN Co now reports normal
    });
  }
  alerts.sort((a, b) => b.devices - a.devices || a.since.localeCompare(b.since));
  return alerts;
}

/** Public incident log rows (no device identifiers). */
export function logRows(incidents, nowSec) {
  return incidents.map((i) => {
    const end = i.ended_at ?? null;
    return {
      suburb: i.suburb,
      state: i.state ?? "",
      postcode: i.postcode ?? "",
      zone: i.zone,
      kind: i.kind,
      started_at: iso(i.started_at),
      ended_at: end != null ? iso(end) : null,
      status:
        end == null
          ? "ongoing"
          : ["recovered", "nbn_restored", "expired"].includes(i.end_reason)
            ? i.end_reason
            : "no_reports",
      duration_min: Math.max(0, Math.round(((end ?? nowSec) - i.started_at) / 60)),
    };
  });
}

function iso(sec) {
  return new Date(sec * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Server-side recovery watch
// ---------------------------------------------------------------------------

/**
 * Decide what the server does after checking NBN Co for an open incident.
 * Only incidents where NBN Co itself confirmed an outage are closed this way
 * (a router on mobile backup with no NBN outage is a local fault).
 */
export function planWatch(incident, displayOutage, nowSec) {
  if (!displayOutage) return { action: "none" };
  if (displayOutage.startsWith("UNPLANNED") || displayOutage.startsWith("DEGRADATION")) {
    return { action: "still_down" };
  }
  if (!incident.nbn_confirmed) return { action: "none" };
  const quiet = nowSec - incident.last_seen > STALE_SEC;
  return quiet ? { action: "close" } : { action: "restored" };
}

async function watchKey(salt) {
  const raw = new TextEncoder().encode(`${salt}:recovery-watch-key`);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptLoc(salt, loc) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await watchKey(salt), new TextEncoder().encode(loc)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptLoc(salt, enc) {
  try {
    const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await watchKey(salt), bytes.slice(12));
    const loc = new TextDecoder().decode(pt);
    return LOC_RE.test(loc) ? loc : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Statistics for the public page: outage counts and recovery times.
// ---------------------------------------------------------------------------

/** Median of a numeric list (null when empty). */
function med(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarise(list, nowSec) {
  const closed = list.filter((i) => i.ended_at != null && i.end_reason !== "replaced");
  const mins = closed.map((i) => Math.max(0, (i.ended_at - i.started_at) / 60));
  return {
    incidents: list.length,
    ongoing: list.filter((i) => i.ended_at == null).length,
    resolved: closed.length,
    mean_recovery_min: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    median_recovery_min: mins.length ? Math.round(med(mins)) : null,
    longest_min: mins.length ? Math.round(Math.max(...mins)) : null,
    downtime_min: Math.round(list.reduce((n, i) => n + Math.max(0, ((i.ended_at ?? nowSec) - i.started_at) / 60), 0)),
  };
}

/**
 * Stats over incidents (already filtered to the window): overall, per area
 * (suburb + state), per state, per technology and per day, plus whether the
 * report came from the app (router/NBN Co detection) or a person.
 */
export function buildStats(incidents, nowSec, days) {
  const groupBy = (keyFn) => {
    const m = new Map();
    for (const i of incidents) {
      const k = keyFn(i);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(i);
    }
    return m;
  };
  const areas = [...groupBy((i) => [i.suburb, i.state].filter(Boolean).join(" ") || null)]
    .map(([area, list]) => ({ area, ...summarise(list, nowSec) }))
    .sort((a, b) => b.incidents - a.incidents || b.downtime_min - a.downtime_min)
    .slice(0, 20);
  const byState = [...groupBy((i) => i.state || null)].map(([state, list]) => ({ state, ...summarise(list, nowSec) }));
  byState.sort((a, b) => b.incidents - a.incidents);
  const byTech = [...groupBy((i) => i.tech || null)].map(([tech, list]) => ({ tech, ...summarise(list, nowSec) }));
  byTech.sort((a, b) => b.incidents - a.incidents);
  const daily = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = Math.floor(nowSec / 86400) * 86400 - d * 86400;
    const n = incidents.filter((i) => i.started_at >= start && i.started_at < start + 86400).length;
    daily.push({ date: new Date(start * 1000).toISOString().slice(0, 10), incidents: n });
  }
  return {
    days,
    overall: summarise(incidents, nowSec),
    sources: {
      app: incidents.filter((i) => i.kind !== "user_report").length,
      people: incidents.filter((i) => i.kind === "user_report").length,
    },
    areas,
    states: byState,
    tech: byTech,
    daily,
  };
}

export const PROBLEMS = {
  down: "No internet",
  slow: "Very slow",
  dropouts: "Keeps dropping out",
  phone: "Phone / VoIP not working",
};
export const REPORT_TTL_SEC = 6 * 3600; // a manual report fades after 6 hours unless confirmed again
