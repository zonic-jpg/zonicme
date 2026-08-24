/**
 * ZonicMe Analytics Hub — orbit aggregation, demographics, CSS bar charts.
 * Fail-open: works without ingest URL or remote APIs.
 */
(function (global) {
  const MOCK_DISABLED_KEY = "zonicme_mock_disabled_v1";

  const DEMO_METRICS = {
    myyanga: { activeUsers7d: 12840, sessions24h: 3120, events: 412000 },
    myafriart: { activeUsers7d: 6200, sessions24h: 980, events: 228000 },
    rubba: { activeUsers7d: 4100, sessions24h: 720, events: 142000 },
    adspot: { activeUsers7d: 24100, sessions24h: 9800, events: 910000 },
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
      { label: "Fashion & style", pct: 34 },
      { label: "Art & culture", pct: 22 },
      { label: "Media & ads", pct: 18 },
      { label: "Life planning", pct: 14 },
      { label: "Other", pct: 12 },
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

  function mergeDemographics(feeds) {
    const buckets = { regions: {}, ageBands: {}, interests: {} };
    let count = 0;
    (feeds || []).forEach((f) => {
      const d = f?.demographics;
      if (!d || d.mock) return;
      count++;
      ["regions", "ageBands", "interests"].forEach((key) => {
        (d[key] || []).forEach((row) => {
          if (!row?.label) return;
          buckets[key][row.label] = (buckets[key][row.label] || 0) + (+row.pct || 0);
        });
      });
    });
    if (!count) return structuredClone(DEMO_DEMOGRAPHICS);
    function normalize(map) {
      const entries = Object.entries(map).map(([label, sum]) => ({
        label,
        pct: Math.round(sum / count),
      }));
      entries.sort((a, b) => b.pct - a.pct);
      return entries;
    }
    return {
      mock: false,
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

      if (cached && !cached.demo) {
        source = cached._source || "orbit";
        mock = !!cached.mock;
      } else if (cached?.demo) {
        source = "mock-fallback";
        mock = true;
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

  function appCompareChart(rows, metricKey, title) {
    const items = rows
      .filter((r) => r.metrics?.[metricKey] != null)
      .map((r) => ({
        label: r.mock ? `${r.name} (mock)` : r.name,
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
        ? `<span class="pill warn mock-badge">mock seed data</span>`
        : showMockBadge && !mock
          ? `<span class="pill ok mock-badge">live orbit</span>`
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
    DEMO_METRICS,
    DEMO_DEMOGRAPHICS,
    fmt,
    esc,
    isMockDisabled,
    disableMockSeed,
    enableMockSeed,
    getDemoMetrics,
    mergeDemographics,
    buildOrbitRows,
    aggregateTotals,
    barChartHtml,
    appCompareChart,
    demographicsHtml,
    spanSummary,
  };
})(typeof window !== "undefined" ? window : globalThis);
