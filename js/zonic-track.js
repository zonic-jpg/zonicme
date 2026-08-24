/**
 * zonic-track — lightweight client span/event reporter for ZonicMe Analytics.
 * Posts to ZONICME_INGEST_URL (zonic-hub-ingest) when configured; otherwise
 * buffers spans in localStorage for the hub analytics UI to display.
 *
 * Usage (child apps):
 *   <script>window.ZONIC_APP_ID='myyanga'; window.ZONICME_INGEST_URL='…';</script>
 *   <script src="https://…/js/zonic-track.js"></script>
 *   ZonicTrack.span('page_view', { path: location.pathname });
 */
(function (global) {
  const BUFFER_KEY = "zonicme_span_buffer_v1";
  const MAX_BUFFER = 200;

  function appId() {
    return (
      global.ZONIC_APP_ID ||
      document.documentElement?.dataset?.zonicApp ||
      "unknown"
    );
  }

  function ingestUrl() {
    if (typeof global.ZONICME_INGEST_URL === "string" && global.ZONICME_INGEST_URL) {
      return global.ZONICME_INGEST_URL;
    }
    try {
      return localStorage.getItem("zonicme_ingest_url") || "";
    } catch (_) {
      return "";
    }
  }

  function readBuffer() {
    try {
      return JSON.parse(localStorage.getItem(BUFFER_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function writeBuffer(items) {
    try {
      localStorage.setItem(BUFFER_KEY, JSON.stringify(items.slice(-MAX_BUFFER)));
    } catch (_) {}
  }

  function makeSpan(name, attrs) {
    return {
      name,
      app: appId(),
      ts: new Date().toISOString(),
      attrs: attrs || {},
    };
  }

  function toIngestPayload(spans) {
    return {
      source: "zonic-hub",
      version: "1.0",
      kind: "analytics-spans",
      records: spans.map((s, i) => ({
        externalRef: `span-${s.app}-${s.ts}-${i}`,
        matchKeys: {
          handle: `@${s.app}`,
          platform: "zonicme-orbit",
        },
        demographics: {
          anonymized: true,
          interests: [s.name, s.app],
          span: s,
          affluenceScore: undefined,
        },
        collectedAt: s.ts,
      })),
    };
  }

  async function flush() {
    const spans = readBuffer();
    if (!spans.length) return { flushed: 0, remote: false };
    const url = ingestUrl();
    if (!url || url.includes("YOUR-SUPABASE")) {
      return { flushed: 0, remote: false, buffered: spans.length };
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
          ...(global.ZONIC_HUB_API_KEY
            ? { "X-Zonic-Api-Key": global.ZONIC_HUB_API_KEY }
            : {}),
        },
        body: JSON.stringify(toIngestPayload(spans)),
      });
      if (res.ok) {
        writeBuffer([]);
        return { flushed: spans.length, remote: true };
      }
      return { flushed: 0, remote: false, status: res.status, buffered: spans.length };
    } catch (err) {
      return { flushed: 0, remote: false, error: String(err), buffered: spans.length };
    }
  }

  function span(name, attrs) {
    const s = makeSpan(name, attrs);
    const buf = readBuffer();
    buf.push(s);
    writeBuffer(buf);
    if (buf.length >= 10) flush();
    return s;
  }

  function getSpans(filterApp) {
    const all = readBuffer();
    if (!filterApp) return all;
    return all.filter((s) => s.app === filterApp);
  }

  /** Fetch child orbit manifests (same pattern as hub ingestOrbit). */
  async function ingestOrbit(manifestUrls) {
    const results = [];
    await Promise.all(
      (manifestUrls || []).map(async (entry) => {
        const url = typeof entry === "string" ? entry : entry.orbit || entry.url;
        const id = typeof entry === "string" ? url : entry.id;
        if (!url) return;
        try {
          const res = await fetch(url, { mode: "cors", cache: "no-store" });
          if (!res.ok) {
            results.push({ id, ok: false, status: res.status });
            return;
          }
          const feed = await res.json();
          results.push({ id, ok: true, feed });
          span("orbit_ingest", { app: id || feed.appId, metrics: feed.metrics || {} });
        } catch (err) {
          results.push({ id, ok: false, error: String(err) });
        }
      })
    );
    return results;
  }

  global.ZonicTrack = {
    span,
    flush,
    getSpans,
    ingestOrbit,
    readBuffer,
    BUFFER_KEY,
  };

  // Auto page view when included as a script tag
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      span("page_view", { path: location.pathname + location.search, href: location.href });
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
