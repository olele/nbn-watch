import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearerOk, escapeHtml, fingerprintKey, formatTelegram, makeCode, parseCode, rateWindow,
  validateNotify, validateRelease, validateRouterIssue,
} from "../src/extras.js";

test("link codes are random, unambiguous and parse from bot messages", () => {
  const code = makeCode();
  assert.match(code, /^NBN[A-HJ-NP-Z2-9]{6}$/);
  assert.notEqual(code, makeCode());
  assert.equal(parseCode(`/start ${code}`), code);
  assert.equal(parseCode(`/start@FaMuLei_bot ${code}`), code);
  assert.equal(parseCode(`nbn-${code.slice(3, 6)} ${code.slice(6)}`.toLowerCase()), code);
  assert.equal(parseCode("/start"), null);
  assert.equal(parseCode("NBN0OOIL1"), null); // ambiguous characters never issued
  assert.equal(parseCode("hello"), null);
});

test("relay messages are validated and escaped", () => {
  assert.equal(validateNotify({}).ok, false);
  const v = validateNotify({ title: "NBN <Down>", message: "a & b", emoji: "🔴🏢🔴🏢🔴🏢🔴", silent: true }).value;
  assert.equal([...v.emoji].length, 6);
  assert.equal(formatTelegram(v), "<b>🔴🏢🔴🏢🔴🏢 NBN &lt;Down&gt;</b>\na &amp; b");
  assert.equal(escapeHtml("<b>"), "&lt;b&gt;");
});

test("hourly rate window", () => {
  let w = rateWindow(null, 0, 1000, 2);
  assert.deepEqual(w, { allowed: true, start: 1000, count: 1 });
  w = rateWindow(w.start, w.count, 1100, 2);
  assert.equal(w.allowed, true);
  assert.equal(rateWindow(w.start, w.count, 1200, 2).allowed, false);
  assert.equal(rateWindow(w.start, w.count, 1000 + 3600, 2).allowed, true);
});

test("router issue fingerprints", () => {
  assert.equal(validateRouterIssue({}).ok, false);
  const r = validateRouterIssue({ title: "TP-Link\u0007 Archer", upnp_model: "AX55", paths: ["/a", 3], login_page: "x".repeat(30000) });
  assert.ok(r.ok);
  assert.equal(r.value.title, "TP-Link  Archer");
  assert.deepEqual(r.value.paths, ["/a"]);
  assert.equal(r.value.login_page.length, 20000);
  assert.equal(fingerprintKey(r.value), fingerprintKey({ ...r.value, error: "different" }));
});

test("releases and admin auth", () => {
  const ok = { platform: "linux", version: "0.2.0", url: "https://x/y", sha256: "a".repeat(64) };
  assert.ok(validateRelease(ok).ok);
  for (const bad of [{ platform: "dos" }, { version: "1.0" }, { url: "http://x" }, { sha256: "z" }]) {
    assert.equal(validateRelease({ ...ok, ...bad }).ok, false);
  }
  assert.ok(bearerOk("Bearer secret", "secret"));
  assert.ok(!bearerOk("Bearer secreT", "secret"));
  assert.ok(!bearerOk("Bearer secret", ""));
  assert.ok(!bearerOk(null, "secret"));
});

test("router issue keeps a sanitised capture and drops oversized/foreign ones", () => {
  const capture = { format: "nbnw-capture-1", entries: [{ path: "/status", body: "x" }] };
  assert.equal(JSON.parse(validateRouterIssue({ capture }).value.capture).entries[0].path, "/status");
  assert.equal(validateRouterIssue({ title: "x", capture: { format: "other", entries: [] } }).value.capture, "");
  const huge = { format: "nbnw-capture-1", entries: [{ body: "x".repeat(700000) }] };
  assert.equal(validateRouterIssue({ title: "x", capture: huge }).value.capture, "");
});
