// NBN community outage server (Cloudflare Worker + D1).
//   POST /api/report  anonymous report from the desktop app
//   GET  /api/zones      reporting devices per zone (JSON)
//   GET  /api/alerts     open problems as map markers (JSON)
//   GET  /api/incidents  problem log: started / recovered (JSON, ?days=1..30)
//   GET  /               public map + log page
import {
  PROBLEMS,
  REPORT_TTL_SEC,
  aggregate,
  buildAlerts,
  buildStats,
  gridCentre,
  decryptLoc,
  encryptLoc,
  logRows,
  planIncident,
  planWatch,
  sha256Hex,
  validateReport,
} from "./logic.js";
import {
  CODE_TTL_SEC,
  bearerOk,
  fingerprintKey,
  formatTelegram,
  makeCode,
  parseCode,
  rateWindow,
  validateNotify,
  validateRelease,
  validateRouterIssue,
} from "./extras.js";
import { PAGE } from "./page.js";

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#0ca30c" opacity=".25"/><circle cx="16" cy="16" r="9" fill="#0ca30c"/></svg>';
const MIN_INTERVAL_SEC = 120; // one report per device per 2 minutes
const MAX_DEVICES_PER_IP = 20; // per active window; CGNAT-friendly but limits spam
const MAX_BODY = 2048;
const RETAIN_SEC = 7 * 24 * 3600;
const WATCH_CRON = "*/5 * * * *";
const WATCH_MAX_CHECKS = 40; // stay under the free plan's 50 subrequests per run
const NBN_URL = "https://places.nbnco.net.au/places/v1/maintenance";
const NBN_HEADERS = {
  Referer: "https://www.nbnco.com.au/support/network-status",
  "X-NBN-Recaptcha-Token": "nbn-status-monitor",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/report" && request.method === "POST") return await report(request, env);
      if (url.pathname === "/api/zones" && request.method === "GET") return await zones(env);
      if (url.pathname === "/api/alerts" && request.method === "GET") return await alerts(env);
      if (url.pathname === "/api/incidents" && request.method === "GET") return await incidents(env, url);
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
      }
      if (url.pathname === "/api/health") return json({ ok: true });
      if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
        return new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
      }
      if (request.method === "POST") {
        const route = {
          "/api/telegram/code": telegramCode,
          "/api/telegram/status": telegramStatus,
          "/api/telegram/unlink": telegramUnlink,
          "/api/notify": notify,
          "/api/router-issue": routerIssue,
          "/telegram/webhook": telegramWebhook,
          "/api/admin/router-issues/ack": adminAck,
          "/api/admin/release": adminRelease,
        }[url.pathname];
        if (route) return await route(request, env);
      }
      if (url.pathname === "/api/admin/router-issues" && request.method === "GET") return await adminIssues(request, env);
      const capMatch = url.pathname.match(/^\/api\/admin\/router-issues\/(\d+)\/capture$/);
      if (capMatch && request.method === "GET") return await adminCapture(request, env, Number(capMatch[1]));
      if (url.pathname === "/api/app/latest" && request.method === "GET") return await appLatest(env, url);
      if (url.pathname === "/api/stats" && request.method === "GET") return await stats(env, url);
      if (url.pathname === "/api/config" && request.method === "GET") {
        // Approximate visitor location from Cloudflare's IP geolocation (city level),
        // used only to centre the map; never stored or logged.
        const cf = request.cf || {};
        const near =
          cf.country === "AU" && cf.latitude && cf.longitude
            ? { lat: Number(cf.latitude), lng: Number(cf.longitude), city: String(cf.city || "").slice(0, 40) }
            : null;
        return json(
          { turnstile_site_key: env.TURNSTILE_SITE_KEY || "", problems: PROBLEMS, links: LINKS, near },
          200,
          { "cache-control": "private, no-store" },
        );
      }
      if (url.pathname === "/api/address-search" && request.method === "GET") return await addressSearch(request, env, url);
      if (url.pathname === "/api/manual-report" && request.method === "POST") return await manualReport(request, env);
      if (url.pathname === "/api/manual-report/close" && request.method === "POST") return await manualClose(request, env);
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error("handler error", e?.message);
      return json({ error: "server error" }, 500);
    }
  },

  // Cron trigger: forget silent devices, close incidents with no reports for 3 days,
  // and drop log entries older than 90 days.
  async scheduled(event, env) {
    if (event.cron === WATCH_CRON) {
      // Manual reports fade unless someone confirms them again.
      await env.DB.prepare(
        "UPDATE incidents SET ended_at = last_seen + ?, end_reason = 'expired' WHERE kind = 'user_report' AND ended_at IS NULL AND last_seen < ?",
      )
        .bind(REPORT_TTL_SEC, now() - REPORT_TTL_SEC)
        .run();
      return watchRecoveries(env);
    }
    const t = now();
    await env.DB.batch([
      env.DB.prepare("UPDATE incidents SET loc_enc = NULL WHERE ended_at IS NOT NULL AND loc_enc IS NOT NULL"),
      env.DB.prepare("DELETE FROM reports WHERE updated_at < ?").bind(t - RETAIN_SEC),
      env.DB.prepare(
        "UPDATE incidents SET ended_at = last_seen, end_reason = 'no_reports', loc_enc = NULL WHERE ended_at IS NULL AND last_seen < ?",
      ).bind(t - 3 * 24 * 3600),
      env.DB.prepare("DELETE FROM incidents WHERE started_at < ?").bind(t - 90 * 24 * 3600),
      env.DB.prepare("DELETE FROM rate_limits WHERE win_start < ?").bind(t - 2 * 3600),
    ]);
  },
};

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://challenges.cloudflare.com; " +
    "style-src 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "img-src 'self' data: blob:; worker-src blob:; child-src blob:; frame-src https://challenges.cloudflare.com; " +
    "connect-src 'self' https://tiles.openfreemap.org",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...SECURITY, ...extra },
  });
}

const now = () => Math.floor(Date.now() / 1000);

async function report(request, env) {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const check = validateReport(body);
  if (!check.ok) return json({ error: check.error }, 400);
  const r = check.value;

  const salt = env.HASH_SALT;
  if (!salt) return json({ error: "server not configured" }, 503);
  const t = now();
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const deviceHash = await sha256Hex(`${salt}:device:${r.device}`);
  const ipHash = (await sha256Hex(`${salt}:ip:${day}:${ip}`)).slice(0, 32);

  const prev = await env.DB.prepare("SELECT updated_at FROM reports WHERE device_hash = ?").bind(deviceHash).first();
  if (prev && t - prev.updated_at < MIN_INTERVAL_SEC) {
    return json({ error: "too soon" }, 429, { "retry-after": String(MIN_INTERVAL_SEC) });
  }
  if (!prev) {
    const active = activeMinutes(env) * 60;
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND updated_at >= ?")
      .bind(ipHash, t - active)
      .first();
    if ((row?.n ?? 0) >= MAX_DEVICES_PER_IP) return json({ error: "too many devices" }, 429);
  }

  const locEnc = r.loc_id ? await encryptLoc(salt, r.loc_id) : null;
  const confirmed = r.nbn === "unplanned" || r.nbn === "degraded" ? 1 : 0;
  const open = await env.DB.prepare(
    "SELECT id, zone, kind, started_at FROM incidents WHERE device_hash = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
  )
    .bind(deviceHash)
    .first();
  const plan = planIncident(open, r, t);

  const stmts = [
    env.DB.prepare(
      `INSERT INTO reports (device_hash, ip_hash, zone, suburb, tech, nbn, connection, mobile_tech, mobile_since,
                            down_mbps, updated_at, state, postcode, lat, lng)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT(device_hash) DO UPDATE SET
         ip_hash=?2, zone=?3, suburb=?4, tech=?5, nbn=?6, connection=?7, mobile_tech=?8, mobile_since=?9,
         down_mbps=?10, updated_at=?11, state=?12, postcode=?13, lat=?14, lng=?15`,
    ).bind(deviceHash, ipHash, r.zone, r.suburb, r.tech, r.nbn, r.connection, r.mobile_tech, r.mobile_since,
      r.down_mbps, t, r.state, r.postcode, r.lat, r.lng),
  ];
  if (plan.action === "close" || plan.action === "reopen") {
    stmts.push(
      env.DB.prepare("UPDATE incidents SET ended_at = ?, end_reason = 'recovered', loc_enc = NULL WHERE id = ?").bind(
        plan.ended_at ?? t,
        open.id,
      ),
    );
  }
  if (plan.action === "open" || plan.action === "reopen") {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO incidents (device_hash, zone, suburb, state, postcode, lat, lng, kind, started_at, last_seen,
                                loc_enc, nbn_confirmed, tech)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(deviceHash, r.zone, r.suburb, r.state, r.postcode, r.lat, r.lng, plan.kind, plan.started_at, t, locEnc,
        confirmed, r.tech),
    );
  }
  if (plan.action === "touch") {
    stmts.push(
      env.DB.prepare(
        `UPDATE incidents SET last_seen = ?, kind = ?, lat = ?, lng = ?, loc_enc = COALESCE(?, loc_enc),
           nbn_confirmed = MAX(nbn_confirmed, ?),
           nbn_restored_at = CASE WHEN ? = 1 THEN NULL ELSE nbn_restored_at END
         WHERE id = ?`,
      ).bind(t, plan.kind, r.lat, r.lng, locEnc, confirmed, confirmed, open.id),
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true, incident: plan.action });
}

function activeMinutes(env) {
  const n = Number(env.ACTIVE_MINUTES ?? 15);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

async function zones(env) {
  const t = now();
  const active = activeMinutes(env);
  const { results } = await env.DB.prepare(
    "SELECT device_hash, zone, suburb, tech, nbn, connection, down_mbps, updated_at FROM reports WHERE updated_at >= ?",
  )
    .bind(t - active * 60)
    .all();
  const min = Math.max(1, Number(env.MIN_REPORTERS ?? 1) || 1);
  return json(aggregate(results, { nowSec: t, activeMinutes: active, minReporters: min }), 200, {
    "cache-control": "public, max-age=30",
  });
}

async function alerts(env) {
  const t = now();
  const { results } = await env.DB.prepare(
    "SELECT zone, suburb, state, postcode, lat, lng, kind, started_at, last_seen, nbn_restored_at FROM incidents WHERE ended_at IS NULL",
  ).all();
  return json({ generated_at: new Date(t * 1000).toISOString(), alerts: buildAlerts(results, t) }, 200, {
    "cache-control": "public, max-age=30",
  });
}

async function incidents(env, url) {
  const t = now();
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const { results } = await env.DB.prepare(
    `SELECT zone, suburb, state, postcode, kind, started_at, ended_at, end_reason FROM incidents
     WHERE (started_at >= ? OR ended_at IS NULL) AND COALESCE(end_reason, '') != 'replaced'
     ORDER BY started_at DESC LIMIT 500`,
  )
    .bind(t - days * 24 * 3600)
    .all();
  return json({ generated_at: new Date(t * 1000).toISOString(), days, incidents: logRows(results, t) }, 200, {
    "cache-control": "public, max-age=30",
  });
}

// Every 5 minutes: check NBN Co for open incidents the server can watch, so a
// recovery is logged even when the affected computer is offline.
async function watchRecoveries(env) {
  const t = now();
  const { results } = await env.DB.prepare(
    `SELECT id, loc_enc, last_seen, nbn_confirmed FROM incidents
     WHERE ended_at IS NULL AND loc_enc IS NOT NULL ORDER BY COALESCE(checked_at, 0) LIMIT ?`,
  )
    .bind(WATCH_MAX_CHECKS)
    .all();
  const byLoc = new Map();
  for (const inc of results) {
    const loc = await decryptLoc(env.HASH_SALT, inc.loc_enc);
    if (!loc) continue;
    if (!byLoc.has(loc)) byLoc.set(loc, []);
    byLoc.get(loc).push(inc);
  }
  const stmts = [];
  let checked = 0;
  let closed = 0;
  for (const [loc, incs] of byLoc) {
    let display = "";
    try {
      const r = await fetch(`${NBN_URL}?locationId=${loc}&uniqueid=${Date.now()}`, { headers: NBN_HEADERS });
      if (r.ok) display = String((await r.json()).displayOutage ?? "");
    } catch (e) {
      console.error("nbn check failed", e?.message);
    }
    checked++;
    for (const inc of incs) {
      const plan = planWatch(inc, display, t);
      if (plan.action === "close") {
        closed++;
        stmts.push(
          env.DB.prepare(
            `UPDATE incidents SET ended_at = ?, end_reason = 'nbn_restored', nbn_restored_at = COALESCE(nbn_restored_at, ?),
               loc_enc = NULL, checked_at = ? WHERE id = ? AND ended_at IS NULL`,
          ).bind(t, t, t, inc.id),
        );
      } else if (plan.action === "restored") {
        stmts.push(
          env.DB.prepare("UPDATE incidents SET nbn_restored_at = COALESCE(nbn_restored_at, ?), checked_at = ? WHERE id = ?").bind(
            t,
            t,
            inc.id,
          ),
        );
      } else if (plan.action === "still_down") {
        stmts.push(
          env.DB.prepare("UPDATE incidents SET nbn_confirmed = 1, nbn_restored_at = NULL, checked_at = ? WHERE id = ?").bind(
            t,
            inc.id,
          ),
        );
      } else {
        stmts.push(env.DB.prepare("UPDATE incidents SET checked_at = ? WHERE id = ?").bind(t, inc.id));
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  console.log(`recovery watch: ${checked} locations checked, ${closed} incidents closed`);
}

// ---------------------------------------------------------------------------
// Device-authenticated helpers (the random device id is the app's secret)
// ---------------------------------------------------------------------------

async function readJson(request, max = 8192) {
  const text = await request.text();
  if (text.length > max) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function deviceHash(env, body) {
  if (!body || typeof body.device !== "string" || !/^[0-9a-f]{32}$/.test(body.device)) return null;
  return sha256Hex(`${env.HASH_SALT}:device:${body.device}`);
}

async function tg(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: "bot not configured" };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// ---------------------------------------------------------------------------
// Telegram linking: app gets a code, user sends it to the bot, server links.
// ---------------------------------------------------------------------------

async function telegramCode(request, env) {
  const body = await readJson(request);
  const dev = await deviceHash(env, body);
  if (!dev) return json({ error: "bad device" }, 400);
  const t = now();
  const code = makeCode();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tg_codes WHERE device_hash = ? OR expires_at < ?").bind(dev, t),
    env.DB.prepare("INSERT INTO tg_codes (code, device_hash, expires_at) VALUES (?, ?, ?)").bind(code, dev, t + CODE_TTL_SEC),
  ]);
  const bot = env.TELEGRAM_BOT_USERNAME || "";
  return json({
    code,
    bot,
    link: bot ? `https://t.me/${bot}?start=${code}` : null,
    expires_in: CODE_TTL_SEC,
  });
}

async function telegramStatus(request, env) {
  const dev = await deviceHash(env, await readJson(request));
  if (!dev) return json({ error: "bad device" }, 400);
  const row = await env.DB.prepare("SELECT first_name, linked_at FROM tg_links WHERE device_hash = ?").bind(dev).first();
  return json({ linked: !!row, name: row?.first_name ?? "", linked_at: row?.linked_at ?? null, bot: env.TELEGRAM_BOT_USERNAME || "" });
}

async function telegramUnlink(request, env) {
  const dev = await deviceHash(env, await readJson(request));
  if (!dev) return json({ error: "bad device" }, 400);
  const row = await env.DB.prepare("SELECT chat_id FROM tg_links WHERE device_hash = ?").bind(dev).first();
  await env.DB.prepare("DELETE FROM tg_links WHERE device_hash = ?").bind(dev).run();
  if (row) await tg(env, "sendMessage", { chat_id: row.chat_id, text: "🔕 NBN Monitor alerts turned off for this computer." });
  return json({ ok: true });
}

async function telegramWebhook(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ error: "forbidden" }, 403);
  }
  const update = await readJson(request, 65536);
  const msg = update?.message;
  if (!msg || msg.chat?.type !== "private" || typeof msg.text !== "string") return json({ ok: true });
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const t = now();
  if (/^\/stop\b/i.test(text)) {
    await env.DB.prepare("DELETE FROM tg_links WHERE chat_id = ?").bind(chatId).run();
    await tg(env, "sendMessage", { chat_id: chatId, text: "🔕 NBN Monitor alerts stopped for all your computers." });
    return json({ ok: true });
  }
  const code = parseCode(text);
  if (!code) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "👋 This bot sends NBN Monitor alerts.\nOpen the NBN Monitor app → Notifications → Connect Telegram, then send the code shown there.",
    });
    return json({ ok: true });
  }
  const row = await env.DB.prepare("SELECT device_hash FROM tg_codes WHERE code = ? AND expires_at >= ?").bind(code, t).first();
  if (!row) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ That code is unknown or expired. Get a new one in the NBN Monitor app." });
    return json({ ok: true });
  }
  const name = String(msg.from?.first_name ?? "").slice(0, 40);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tg_links (device_hash, chat_id, first_name, linked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(device_hash) DO UPDATE SET chat_id = excluded.chat_id, first_name = excluded.first_name, linked_at = excluded.linked_at`,
    ).bind(row.device_hash, chatId, name, t),
    env.DB.prepare("DELETE FROM tg_codes WHERE code = ?").bind(code),
  ]);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: "✅ <b>Connected to NBN Monitor</b>\nYou'll get alerts here when your NBN goes down, switches to mobile backup, or recovers.\nSend /stop to turn alerts off.",
  });
  return json({ ok: true });
}

async function notify(request, env) {
  const body = await readJson(request);
  const dev = await deviceHash(env, body);
  if (!dev) return json({ error: "bad device" }, 400);
  const check = validateNotify(body);
  if (!check.ok) return json({ error: check.error }, 400);
  const link = await env.DB.prepare("SELECT chat_id, win_start, win_count FROM tg_links WHERE device_hash = ?").bind(dev).first();
  if (!link) return json({ error: "not linked" }, 404);
  const t = now();
  const win = rateWindow(link.win_start, link.win_count ?? 0, t);
  if (!win.allowed) return json({ error: "rate limited" }, 429);
  await env.DB.prepare("UPDATE tg_links SET win_start = ?, win_count = ? WHERE device_hash = ?").bind(win.start, win.count, dev).run();
  const res = await tg(env, "sendMessage", {
    chat_id: link.chat_id,
    text: formatTelegram(check.value),
    parse_mode: "HTML",
    disable_notification: check.value.silent,
    link_preview_options: { is_disabled: true },
  });
  if (!res.ok) {
    if (res.error_code === 403) await env.DB.prepare("DELETE FROM tg_links WHERE device_hash = ?").bind(dev).run();
    return json({ error: "telegram rejected" }, 502);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Router-support issues
// ---------------------------------------------------------------------------

async function routerIssue(request, env) {
  const body = await readJson(request, 700_000);
  const dev = await deviceHash(env, body);
  if (!dev) return json({ error: "bad device" }, 400);
  const check = validateRouterIssue(body);
  if (!check.ok) return json({ error: check.error }, 400);
  const v = check.value;
  const isp = String(request.cf?.asOrganization ?? "").slice(0, 80); // ISP from the network, no IP stored
  const country = String(request.cf?.country ?? "").slice(0, 4);
  const key = (await sha256Hex(fingerprintKey(v))).slice(0, 32);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO router_issues (fp_key, gateway_vendor, title, server_header, realm, upnp_manufacturer, upnp_model,
        upnp_model_number, upnp_friendly, login_page, paths, error, isp, country, os, app_version,
        first_seen, last_seen, reports, devices)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17, 1, ?18)
     ON CONFLICT(fp_key) DO UPDATE SET last_seen = ?17, reports = reports + 1, isp = ?13, error = ?12, synced = CASE WHEN length(?19) > 0 THEN 0 ELSE synced END,
        capture = CASE WHEN length(?19) > 0 THEN ?19 ELSE capture END,
        capture_at = CASE WHEN length(?19) > 0 THEN ?17 ELSE capture_at END,
        login_page = CASE WHEN length(?10) > 0 THEN ?10 ELSE login_page END,
        devices = CASE WHEN instr(devices, ?18) > 0 THEN devices ELSE substr(devices || ',' || ?18, 1, 2000) END`,
  )
    .bind(key, v.gateway_vendor, v.title, v.server_header, v.realm, v.upnp_manufacturer, v.upnp_model, v.upnp_model_number,
      v.upnp_friendly, v.login_page, JSON.stringify(v.paths), v.error, isp, country, v.os, v.app_version, t, dev.slice(0, 12),
      v.capture)
    .run();
  return json({ ok: true, issue: key });
}

async function adminIssues(request, env) {
  if (!bearerOk(request.headers.get("authorization"), env.ADMIN_TOKEN)) return json({ error: "forbidden" }, 403);
  const { results } = await env.DB.prepare(
    `SELECT id, fp_key, gateway_vendor, title, server_header, realm, upnp_manufacturer, upnp_model, upnp_model_number,
            upnp_friendly, login_page, paths, error, isp, country, os, app_version, first_seen, last_seen, reports,
            (length(devices) - length(replace(devices, ',', '')) + 1) AS device_count, synced,
            length(capture) AS capture_bytes
     FROM router_issues WHERE synced = 0 ORDER BY last_seen DESC LIMIT 50`,
  ).all();
  return json({ issues: results });
}

async function adminAck(request, env) {
  if (!bearerOk(request.headers.get("authorization"), env.ADMIN_TOKEN)) return json({ error: "forbidden" }, 403);
  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Number.isInteger).slice(0, 100) : [];
  if (ids.length) {
    await env.DB.batch(ids.map((id) => env.DB.prepare("UPDATE router_issues SET synced = 1 WHERE id = ?").bind(id)));
  }
  return json({ ok: true, acked: ids.length });
}

// ---------------------------------------------------------------------------
// App releases (auto-update)
// ---------------------------------------------------------------------------

async function appLatest(env, url) {
  const platform = url.searchParams.get("platform") || "";
  const row = await env.DB.prepare("SELECT version, url, sha256, notes, published_at FROM app_releases WHERE platform = ?")
    .bind(platform)
    .first();
  if (!row) return json({ error: "no release" }, 404);
  return json({ platform, ...row }, 200, { "cache-control": "public, max-age=300" });
}

async function adminRelease(request, env) {
  if (!bearerOk(request.headers.get("authorization"), env.ADMIN_TOKEN)) return json({ error: "forbidden" }, 403);
  const check = validateRelease(await readJson(request));
  if (!check.ok) return json({ error: check.error }, 400);
  const r = check.value;
  await env.DB.prepare(
    `INSERT INTO app_releases (platform, version, url, sha256, notes, published_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET version = excluded.version, url = excluded.url, sha256 = excluded.sha256,
       notes = excluded.notes, published_at = excluded.published_at`,
  )
    .bind(r.platform, r.version, r.url, r.sha256, r.notes, now())
    .run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Public stats and manual reports (no app needed)
// ---------------------------------------------------------------------------

const LINKS = {
  discord: "",
  github: "https://github.com/olele/nbn-watch",
  discussions: "https://github.com/olele/nbn-watch/discussions",
  reddit: "https://www.reddit.com/r/nbn/",
  whirlpool: "https://forums.whirlpool.net.au/",
  nbn_status: "https://www.nbnco.com.au/support/network-status",
};

async function stats(env, url) {
  const t = now();
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const { results } = await env.DB.prepare(
    `SELECT kind, suburb, state, tech, started_at, ended_at, end_reason FROM incidents
     WHERE started_at >= ? AND COALESCE(end_reason, '') != 'replaced'`,
  )
    .bind(t - days * 86400)
    .all();
  return json(buildStats(results, t, days), 200, { "cache-control": "public, max-age=120" });
}

async function ipKey(request, env, purpose) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  return `${purpose}:${(await sha256Hex(`${env.HASH_SALT}:rl:${day}:${ip}`)).slice(0, 24)}`;
}

async function allow(env, key, limit, windowSec = 3600) {
  const t = now();
  const row = await env.DB.prepare("SELECT win_start, count FROM rate_limits WHERE key = ?").bind(key).first();
  if (row && t - row.win_start < windowSec && row.count >= limit) return false;
  if (!row || t - row.win_start >= windowSec) {
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits (key, win_start, count) VALUES (?, ?, 1)").bind(key, t).run();
  } else {
    await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  }
  return true;
}

async function turnstileOk(env, token, request) {
  if (!env.TURNSTILE_SECRET) return false;
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  return data.success === true;
}

async function addressSearch(request, env, url) {
  if (!(await allow(env, await ipKey(request, env, "search"), 60))) return json({ error: "too many searches — try later" }, 429);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);
  if (q.length < 4) return json({ results: [] });
  const r = await fetch(`https://places.nbnco.net.au/places/v1/autocomplete?query=${encodeURIComponent(q)}`, { headers: NBN_HEADERS });
  const data = r.ok ? await r.json().catch(() => ({})) : {};
  const results = (data.suggestions || [])
    .filter((s) => typeof s?.id === "string" && /^LOC\d{12}$/.test(s.id))
    .slice(0, 8)
    .map((s) => ({ loc_id: s.id, address: String(s.formattedAddress || "").slice(0, 120) }));
  return json({ results });
}

async function manualReport(request, env) {
  const body = await readJson(request);
  const loc = typeof body?.loc_id === "string" && /^LOC\d{12}$/.test(body.loc_id) ? body.loc_id : null;
  const problem = Object.hasOwn(PROBLEMS, body?.problem) ? body.problem : null;
  if (!loc || !problem) return json({ error: "choose your address and the problem" }, 400);
  if (!(await turnstileOk(env, body.turnstile, request))) return json({ error: "please complete the check" }, 403);
  if (!(await allow(env, await ipKey(request, env, "report"), 3))) return json({ error: "you've reported recently — thanks!" }, 429);
  const r = await fetch(`https://places.nbnco.net.au/places/v2/details/${loc}`, { headers: NBN_HEADERS });
  const d = r.ok ? await r.json().catch(() => null) : null;
  const area = d?.servingArea || {};
  const detail = d?.addressDetail || {};
  if (!/^CSA\d{12}$/.test(area.csaId || "")) return json({ error: "that address isn't on the NBN" }, 400);
  const m = String(detail.formattedAddress || "").match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})\b/);
  const lat = typeof detail.latitude === "number" ? gridCentre(detail.latitude) : null; // ~1 km, never the address
  const lng = typeof detail.longitude === "number" ? gridCentre(detail.longitude) : null;
  const closeToken = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const t = now();
  await env.DB.prepare(
    `INSERT INTO incidents (device_hash, zone, suburb, state, postcode, lat, lng, kind, problem, tech, started_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user_report', ?, ?, ?, ?)`,
  )
    .bind(`manual:${await sha256Hex(closeToken)}`, area.csaId, String(area.description || detail.locality || "").slice(0, 40),
      m?.[1] || "", m?.[2] || "", lat, lng, problem, String(area.techType || "").slice(0, 12), t, t)
    .run();
  return json({ ok: true, close_token: closeToken, area: [area.description, m?.[1], m?.[2]].filter(Boolean).join(" ") });
}

async function manualClose(request, env) {
  const body = await readJson(request);
  if (typeof body?.close_token !== "string" || !/^[0-9a-f]{32}$/.test(body.close_token)) return json({ error: "bad token" }, 400);
  const res = await env.DB.prepare(
    "UPDATE incidents SET ended_at = ?, end_reason = 'recovered' WHERE device_hash = ? AND ended_at IS NULL",
  )
    .bind(now(), `manual:${await sha256Hex(body.close_token)}`)
    .run();
  return json({ ok: true, closed: res.meta?.changes ?? 0 });
}

async function adminCapture(request, env, id) {
  if (!bearerOk(request.headers.get("authorization"), env.ADMIN_TOKEN)) return json({ error: "forbidden" }, 403);
  const row = await env.DB.prepare("SELECT capture FROM router_issues WHERE id = ?").bind(id).first();
  if (!row || !row.capture) return json({ error: "no capture" }, 404);
  return new Response(row.capture, { headers: { "content-type": "application/json" } });
}
