// Pure helpers for Telegram linking/relay, router-support issues and app releases.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const CODE_TTL_SEC = 15 * 60;
export const NOTIFY_PER_HOUR = 30;

/** Random link code like "NBN7K4P2Q" (also valid as a Telegram /start payload). */
export function makeCode(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = randomBytes(6);
  let out = "NBN";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** Extract a link code from "/start NBN…", "NBN-…", "nbn …" etc. */
export function parseCode(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.toUpperCase().replace(/^\/START(@\w+)?\s*/, "").replace(/[\s-]/g, "");
  const m = cleaned.match(/^NBN([A-Z0-9]{6})$/);
  if (!m) return null;
  const code = "NBN" + m[1];
  return [...m[1]].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Validate a relay notification; returns {ok, value|error}. */
export function validateNotify(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "bad body" };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const message = typeof body.message === "string" ? body.message.slice(0, 3500) : "";
  if (!title) return { ok: false, error: "missing title" };
  const emoji = typeof body.emoji === "string" ? [...body.emoji].slice(0, 6).join("") : "";
  return { ok: true, value: { title, message, emoji, silent: body.silent === true } };
}

export function formatTelegram({ title, message, emoji }) {
  const head = `<b>${escapeHtml((emoji ? emoji + " " : "") + title)}</b>`;
  return message ? `${head}\n${escapeHtml(message)}` : head;
}

/** Sliding hourly window: returns {allowed, start, count}. */
export function rateWindow(start, count, nowSec, limit = NOTIFY_PER_HOUR) {
  if (start == null || nowSec - start >= 3600) return { allowed: true, start: nowSec, count: 1 };
  if (count >= limit) return { allowed: false, start, count };
  return { allowed: true, start, count: count + 1 };
}

// --------------------------------------------------------------------------
// Router-support issues: fingerprints of routers the app cannot read yet.
// Never contains passwords: the app sends model info and a sanitized login page.
// --------------------------------------------------------------------------

const FP_FIELDS = {
  gateway_vendor: 60,
  title: 120,
  server_header: 120,
  realm: 120,
  upnp_manufacturer: 80,
  upnp_model: 80,
  upnp_model_number: 60,
  upnp_friendly: 120,
  os: 40,
  app_version: 20,
  error: 300,
};

export function validateRouterIssue(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "bad body" };
  const value = {};
  for (const [k, max] of Object.entries(FP_FIELDS)) {
    value[k] = typeof body[k] === "string" ? body[k].replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
  }
  value.login_page = typeof body.login_page === "string" ? body.login_page.slice(0, 20000) : "";
  value.paths = Array.isArray(body.paths)
    ? body.paths.filter((p) => typeof p === "string").map((p) => p.slice(0, 80)).slice(0, 40)
    : [];
  // Optional diagnostic capture (already sanitised by the app), kept as JSON text.
  value.capture = "";
  if (body.capture && typeof body.capture === "object" && body.capture.format === "nbnw-capture-1" && Array.isArray(body.capture.entries)) {
    const text = JSON.stringify(body.capture);
    if (text.length <= 600_000) value.capture = text;
  }
  if (!value.title && !value.server_header && !value.upnp_model && !value.login_page && !value.capture) {
    return { ok: false, error: "empty fingerprint" };
  }
  return { ok: true, value };
}

/** Stable key so many users with the same router collapse into one issue. */
export function fingerprintKey(v) {
  return [v.upnp_manufacturer, v.upnp_model, v.upnp_model_number, v.title, v.server_header, v.realm]
    .map((s) => (s || "").toLowerCase())
    .join("|");
}

// --------------------------------------------------------------------------
// App releases (auto-update manifest)
// --------------------------------------------------------------------------

export const PLATFORMS = ["linux", "windows", "macos"];

export function validateRelease(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "bad body" };
  const { platform, version, url, sha256, notes } = body;
  if (!PLATFORMS.includes(platform)) return { ok: false, error: "bad platform" };
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, error: "bad version" };
  if (typeof url !== "string" || !url.startsWith("https://")) return { ok: false, error: "bad url" };
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: "bad sha256" };
  return { ok: true, value: { platform, version, url, sha256, notes: typeof notes === "string" ? notes.slice(0, 2000) : "" } };
}

/** Constant-time-ish bearer check. */
export function bearerOk(header, token) {
  if (!token || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const given = header.slice(7);
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
