/**
 * zonic-track v2 — reports app events to the ZonicMe hub (zonic-hub-ingest).
 * Works with no setup: the ingest URL defaults to the production hub.
 *   window.ZONIC_APP_ID = 'myyanga'   (set before this script)
 *   ZonicTrack.span('name', {…})      custom event
 * Signed-in users are linked across apps by a one-way hash of their email
 * (read from the Supabase session already in the browser). Raw emails never
 * leave the device. Test accounts (@zonicme-test.com) are stored as demo data.
 */
(function (global) {
  const BUFFER_KEY = "zonicme_span_buffer_v1";
  const SESSION_KEY = "zonicme_session_v1";
  const MAX_BUFFER = 200;
  const DEFAULT_URL = "https://qdhlbplzdblcvvaaluwu.supabase.co/functions/v1/zonic-hub-ingest";
  let flushing = false;

  function appId() {
    return global.ZONIC_APP_ID || document.documentElement?.dataset?.zonicApp || "unknown";
  }
  function ingestUrl() {
    if (typeof global.ZONICME_INGEST_URL === "string" && global.ZONICME_INGEST_URL && !global.ZONICME_INGEST_URL.includes("YOUR-SUPABASE")) return global.ZONICME_INGEST_URL;
    try { const v = localStorage.getItem("zonicme_ingest_url"); if (v) return v; } catch (_) {}
    return DEFAULT_URL;
  }
  function readBuffer() { try { return JSON.parse(localStorage.getItem(BUFFER_KEY) || "[]"); } catch (_) { return []; } }
  function writeBuffer(items) { try { localStorage.setItem(BUFFER_KEY, JSON.stringify(items.slice(-MAX_BUFFER))); } catch (_) {} }
  function sessionId() {
    try {
      const now = Date.now();
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (s && now - s.t < 30 * 60 * 1000) { s.t = now; sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); return s.id; }
      const id = (crypto.randomUUID ? crypto.randomUUID() : String(now) + Math.random().toString(16).slice(2));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, t: now }));
      return id;
    } catch (_) { return "nosession"; }
  }
  async function sha256(s) {
    try {
      const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
    } catch (_) { return null; }
  }
  /** Email of the signed-in user, read from any Supabase session in this browser. */
  function sessionEmail() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/.test(k)) {
          const v = JSON.parse(localStorage.getItem(k) || "null");
          const e = v?.user?.email || v?.currentSession?.user?.email;
          if (e) return String(e).trim().toLowerCase();
        }
      }
    } catch (_) {}
    return null;
  }

  function makeSpan(name, attrs) {
    return { name, app: appId(), ts: new Date().toISOString(), attrs: attrs || {} };
  }

  async function buildBody(spans) {
    const email = sessionEmail();
    const body = { app: appId(), session: sessionId(), events: spans.map((s) => ({ name: s.name, ts: s.ts, attrs: s.attrs, app: s.app })) };
    if (email) {
      const h = await sha256(email);
      if (h) body.identity = { emailHash: h };
      if (email.endsWith("@zonicme-test.com")) body.demo = true;
    }
    return body;
  }

  async function flush() {
    if (flushing) return { flushed: 0, remote: false };
    const spans = readBuffer();
    if (!spans.length) return { flushed: 0, remote: false };
    flushing = true;
    try {
      const res = await fetch(ingestUrl(), {
        method: "POST", mode: "cors", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await buildBody(spans.slice(0, 50))),
      });
      if (res.ok) { writeBuffer(readBuffer().slice(Math.min(spans.length, 50))); return { flushed: Math.min(spans.length, 50), remote: true }; }
      return { flushed: 0, remote: false, status: res.status, buffered: spans.length };
    } catch (err) {
      return { flushed: 0, remote: false, error: String(err), buffered: spans.length };
    } finally { flushing = false; }
  }

  function span(name, attrs) {
    const s = makeSpan(name, attrs);
    const buf = readBuffer(); buf.push(s); writeBuffer(buf);
    if (buf.length >= 5) flush();
    return s;
  }
  function getSpans(filterApp) { const all = readBuffer(); return filterApp ? all.filter((s) => s.app === filterApp) : all; }

  async function ingestOrbit(manifestUrls) {
    const results = [];
    await Promise.all((manifestUrls || []).map(async (entry) => {
      const url = typeof entry === "string" ? entry : entry.orbit || entry.url;
      const id = typeof entry === "string" ? url : entry.id;
      if (!url) return;
      try {
        const res = await fetch(url, { mode: "cors", cache: "no-store" });
        if (!res.ok) { results.push({ id, ok: false, status: res.status }); return; }
        results.push({ id, ok: true, feed: await res.json() });
      } catch (err) { results.push({ id, ok: false, error: String(err) }); }
    }));
    return results;
  }

  global.ZonicTrack = { span, flush, getSpans, ingestOrbit, readBuffer, BUFFER_KEY };

  if (typeof document !== "undefined") {
    const pv = () => span("page_view", { path: location.pathname });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pv); else pv();
    // single-page apps: report route changes
    let last = location.pathname;
    setInterval(() => { if (location.pathname !== last) { last = location.pathname; pv(); } }, 1500);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    setTimeout(flush, 3000);
  }
})(typeof window !== "undefined" ? window : globalThis);
