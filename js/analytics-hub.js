/**
 * ZonicMe Analytics Hub — orbit aggregation, demographics, CSS bar charts.
 * Fail-open: works without ingest URL or remote APIs.
 */
(function (global) {
  const MOCK_DISABLED_KEY = "zonicme_mock_disabled_v1";
  const ORBIT_CACHE_KEY = "zonicme_orbit_lastgood_v1";
  const ORBIT_TIMEOUT_MS = 4500;
  /** Child apps publish at different paths; try each before giving up. */
  const MANIFEST_PATHS = ["/orbit-manifest.json", "/orbit/manifest.json"];

  const DEMO_METRICS = {
    myyanga: { activeUsers7d: 14820, sessions24h: 3640, events: 486000 },
    myafriart: { activeUsers7d: 7340, sessions24h: 1180, events: 268000 },
    rubba: { activeUsers7d: 5120, sessions24h: 890, events: 176000 },
    adspot: { activeUsers7d: 26800, sessions24h: 11240, events: 1040000 },
    owanbex: { activeUsers7d: 4180, sessions24h: 780, events: 124000 },
  };

  const DEMO_DEMOGRAPHICS = {
    mock: true,
    regions: [
      { label: "West Africa", pct: 38 },
      { label: "East Africa", pct: 22 },
      { label: "Southern Africa", pct: 14 },
      { label: "North Africa", pct: 11 },
      { label: "Diaspora", pct: 15 },
    ],
    ageBands: [
      { label: "18–24", pct: 28 },
      { label: "25–34", pct: 41 },
      { label: "35–44", pct: 19 },
      { label: "45+", pct: 12 },
    ],
    interests: [
      { label: "Fashion & style", pct: 30 },
      { label: "Art & culture", pct: 18 },
      { label: "Media & ads", pct: 16 },
      { label: "Life planning", pct: 14 },
      { label: "Celebrations", pct: 12 },
      { label: "Other", pct: 10 },
    ],
  };

  function fmt(n) {
    if (n == null || Number.isNaN(+n)) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function isMockDisabled() {
    try {
      return localStorage.getItem(MOCK_DISABLED_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function disableMockSeed() {
    try {
      localStorage.setItem(MOCK_DISABLED_KEY, "1");
    } catch (_) {}
  }

  function enableMockSeed() {
    try {
      localStorage.removeItem(MOCK_DISABLED_KEY);
    } catch (_) {}
  }

  function getDemoMetrics(appId) {
    return DEMO_METRICS[appId] || null;
  }

  /** Last-known-good orbit feeds survive a child app going offline. */
  function readLastGood() {
    try {
      const raw = localStorage.getItem(ORBIT_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeLastGood(map) {
    try {
      localStorage.setItem(ORBIT_CACHE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function rememberLastGood(appId, feed, url) {
    if (!appId || !feed?.metrics) return;
    const map = readLastGood();
    map[appId] = { feed, url, savedAt: Date.now() };
    writeLastGood(map);
  }

  function clearLastGood() {
    try {
      localStorage.removeItem(ORBIT_CACHE_KEY);
    } catch (_) {}
  }

  /** Fetch JSON with a hard timeout so one slow app can never stall the hub. */
  async function fetchJson(url, timeoutMs = ORBIT_TIMEOUT_MS) {
    if (!url) return null;
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        mode: "cors",
        cache: "no-store",
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json && typeof json === "object" ? json : null;
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Candidate live manifest URLs for an app: the configured one first, then the
   * conventional paths derived from the app's own origin.
   */
  function manifestCandidates(app, lastGood) {
    const urls = [];
    // A URL that worked before is the most likely to work again.
    const proven = lastGood?.[app?.id]?.url;
    if (proven) urls.push(proven);
    if (app?.orbitLive) urls.push(app.orbitLive);
    if (app?.url) {
      try {
        const origin = new URL(app.url).origin;
        MANIFEST_PATHS.forEach((p) => urls.push(origin + p));
      } catch (_) {}
    }
    return [...new Set(urls)];
  }

  function hasMetrics(feed) {
    return !!feed?.metrics && Object.keys(feed.metrics).length > 0;
  }

  /**
   * Resolve one app's orbit feed through the full fallback chain:
   * live manifest -> local fixture -> last-known-good -> mock seed.
   * Always resolves; never throws.
   */
  async function resolveAppOrbit(app, options = {}) {
    const timeoutMs = options.timeoutMs || ORBIT_TIMEOUT_MS;
    const lastGood = options.lastGood || readLastGood();
    const mockOff = isMockDisabled();

    for (const url of manifestCandidates(app, lastGood)) {
      const feed = await fetchJson(url, timeoutMs);
      if (hasMetrics(feed)) {
        const entry = { ...feed, _source: "live", _url: url, mock: !!feed.mock };
        if (!feed.mock) rememberLastGood(app.id, feed, url);
        return entry;
      }
    }

    const local = await fetchJson(app?.orbit, timeoutMs);
    if (hasMetrics(local)) {
      return { ...local, _source: "local", _url: app.orbit, mock: !!local.mock };
    }

    const saved = lastGood[app?.id]?.feed;
    if (hasMetrics(saved)) {
      return {
        ...saved,
        _source: "last-good",
        _savedAt: lastGood[app.id].savedAt,
        mock: !!saved.mock,
      };
    }

    const seed = app?._demo || DEMO_METRICS[app?.id];
    if (seed && !mockOff) {
      return { metrics: seed, demo: true, mock: true, _source: "mock-seed" };
    }
    return null;
  }

  /**
   * Populate `cache` (keyed by app id) for every app in parallel.
   * Returns the same cache object so callers can render immediately after.
   */
  async function ingestOrbit(apps, cache = {}, options = {}) {
    await Promise.all(
      (apps || []).map(async (app) => {
        if (!app?.id) return;
        const entry = await resolveAppOrbit(app, options);
        if (entry) {
          cache[app.id] = entry;
          try {
            global.ZonicTrack?.span?.("orbit_ingest", {
              app: app.id,
              source: entry._source,
              mock: !!entry.mock,
            });
          } catch (_) {}
        }
      })
    );
    return cache;
  }

  /** Seed the cache so charts are never empty on first paint (last-good, then mock). */
  function seedCache(apps, cache = {}) {
    const lastGood = readLastGood();
    (apps || []).forEach((app) => {
      if (!app?.id || cache[app.id]) return;
      const saved = lastGood[app.id]?.feed;
      if (hasMetrics(saved)) {
        cache[app.id] = {
          ...saved,
          _source: "last-good",
          _savedAt: lastGood[app.id].savedAt,
          mock: !!saved.mock,
        };
        return;
      }
      if (isMockDisabled()) return;
      const seed = app._demo || DEMO_METRICS[app.id];
      if (seed) {
        cache[app.id] = {
          metrics: seed,
          demographics: structuredClone(DEMO_DEMOGRAPHICS),
          demo: true,
          mock: true,
          _source: "mock-seed",
        };
      }
    });
    return cache;
  }

  function mergeDemographics(feeds) {
    const live = [];
    const mockOnly = [];
    (feeds || []).forEach((f) => {
      const d = f?.demographics;
      if (!d) return;
      if (d.mock) mockOnly.push(d);
      else live.push(d);
    });
    // Prefer live demographics; otherwise average the orbit mock fixtures
    // so Analytics still reflects the richer per-app seed data.
    const use = live.length ? live : mockOnly;
    if (!use.length) return structuredClone(DEMO_DEMOGRAPHICS);

    const buckets = { regions: {}, ageBands: {}, interests: {} };
    use.forEach((d) => {
      ["regions", "ageBands", "interests"].forEach((key) => {
        (d[key] || []).forEach((row) => {
          if (!row?.label) return;
          buckets[key][row.label] = (buckets[key][row.label] || 0) + (+row.pct || 0);
        });
      });
    });
    const count = use.length;
    function normalize(map) {
      const entries = Object.entries(map).map(([label, sum]) => ({
        label,
        pct: Math.round(sum / count),
      }));
      entries.sort((a, b) => b.pct - a.pct);
      return entries;
    }
    return {
      mock: !live.length,
      regions: normalize(buckets.regions),
      ageBands: normalize(buckets.ageBands),
      interests: normalize(buckets.interests),
    };
  }

  /**
   * Build orbit rows from apps + cache. Respects mock-disabled flag.
   */
  function buildOrbitRows(apps, orbitCache) {
    const mockOff = isMockDisabled();
    return (apps || []).map((a) => {
      const cached = orbitCache?.[a.id];
      let metrics = cached?.metrics;
      let source = "none";
      let mock = false;

      if (cached?.metrics) {
        source = cached._source || (cached.demo ? "mock-seed" : "orbit");
        mock = !!cached.mock || !!cached.demo;
        metrics = cached.metrics;
      } else if (!mockOff && a._demo) {
        source = "mock-seed";
        mock = true;
        metrics = a._demo;
      }

      return {
        id: a.id,
        name: a.name || a.id,
        color: a.color || "#E85D04",
        metrics: metrics || {},
        source,
        mock,
      };
    });
  }

  /** Short, human-readable status for an app row (operator-facing). */
  function sourceLabel(row) {
    if (!row) return "not reporting";
    if (row.mock) return "sample data";
    switch (row.source) {
      case "live":
        return "reporting live";
      case "local":
        return "reporting live";
      case "last-good":
        return "last known figures";
      case "none":
        return "not reporting";
      default:
        return "reporting live";
    }
  }

  function aggregateTotals(rows) {
    const totals = { users: 0, sessions: 0, events: 0, live: 0, mockCount: 0 };
    rows.forEach((r) => {
      if (!r.metrics || !Object.keys(r.metrics).length) return;
      totals.live++;
      if (r.mock) totals.mockCount++;
      totals.users += r.metrics.activeUsers7d || 0;
      totals.sessions += r.metrics.sessions24h || 0;
      totals.events += r.metrics.events || 0;
    });
    return totals;
  }

  function barChartHtml(title, items, { maxPct = 100, accent = "#E85D04" } = {}) {
    const rows = (items || []).slice(0, 8);
    if (!rows.length) {
      return `<div class="chart-panel"><h4>${esc(title)}</h4><p class="chart-empty">No data yet.</p></div>`;
    }
    const maxVal = Math.max(...rows.map((r) => +r.pct || +r.value || 0), 1);
    return `
      <div class="chart-panel">
        <h4>${esc(title)}</h4>
        <div class="bar-chart">
          ${rows
            .map((r) => {
              const val = +r.pct || +r.value || 0;
              const pct = Math.min(100, Math.round((val / maxVal) * 100));
              return `
            <div class="bar-row">
              <span class="bar-label">${esc(r.label)}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${esc(r.color || accent)}"></div></div>
              <span class="bar-val">${esc(r.pct != null ? r.pct + "%" : fmt(val))}</span>
            </div>`;
            })
            .join("")}
        </div>
      </div>`;
  }

  /** `markMock` flags sample-data apps for operators; the public hub turns it off. */
  function appCompareChart(rows, metricKey, title, { markMock = true } = {}) {
    const items = rows
      .filter((r) => r.metrics?.[metricKey] != null)
      .map((r) => ({
        label: markMock && r.mock ? `${r.name} (sample)` : r.name,
        value: r.metrics[metricKey],
        color: r.color,
      }))
      .sort((a, b) => b.value - a.value);
    return barChartHtml(title, items.map((i) => ({ ...i, pct: null })));
  }

  function demographicsHtml(demo, { showMockBadge = true } = {}) {
    const mock = demo?.mock;
    const badge =
      showMockBadge && mock
        ? `<span class="pill warn mock-badge">sample data</span>`
        : showMockBadge && !mock
          ? `<span class="pill ok mock-badge">reporting live</span>`
          : "";
    return `
      <div class="demo-section">
        <div class="demo-head">
          <h3>Demographics</h3>
          ${badge}
        </div>
        <p class="demo-lead">Anonymised, aggregated orbit signals — no personal identifiers.</p>
        <div class="chart-grid-3">
          ${barChartHtml("Region", demo.regions, { accent: "#0d9488" })}
          ${barChartHtml("Age band", demo.ageBands, { accent: "#E85D04" })}
          ${barChartHtml("Interests", demo.interests, { accent: "#1A6B5A" })}
        </div>
      </div>`;
  }

  function spanSummary() {
    const spans = global.ZonicTrack?.getSpans?.() || [];
    const byApp = {};
    spans.forEach((s) => {
      byApp[s.app] = (byApp[s.app] || 0) + 1;
    });
    return { total: spans.length, byApp };
  }

  global.ZonicAnalyticsHub = {
    MOCK_DISABLED_KEY,
    ORBIT_CACHE_KEY,
    ORBIT_TIMEOUT_MS,
    DEMO_METRICS,
    DEMO_DEMOGRAPHICS,
    fmt,
    esc,
    isMockDisabled,
    disableMockSeed,
    enableMockSeed,
    getDemoMetrics,
    mergeDemographics,
    fetchJson,
    manifestCandidates,
    resolveAppOrbit,
    ingestOrbit,
    seedCache,
    readLastGood,
    clearLastGood,
    buildOrbitRows,
    sourceLabel,
    aggregateTotals,
    barChartHtml,
    appCompareChart,
    demographicsHtml,
    spanSummary,
  };
})(typeof window !== "undefined" ? window : globalThis);
