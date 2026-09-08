/**
 * ZonicMe shared site chrome — header nav (incl. the Applications dropdown),
 * footer product links, current-page nav highlight, and the year stamp.
 * Loaded on every page so there is exactly one place that knows how these
 * pieces work, instead of five copies drifting apart.
 */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function isHomePage() {
    const last = location.pathname.split("/").pop();
    return last === "" || last === "index.html";
  }

  function appsHref() {
    return isHomePage() ? "#applications" : "index.html#applications";
  }

  function renderNavApps(apps) {
    const menu = document.getElementById("appsMenu");
    if (!menu) return;
    menu.innerHTML =
      apps.map((a) => `<a role="menuitem" href="${appsHref()}" data-app="${esc(a.id)}">${esc(a.name)}</a>`).join("") +
      `<a role="menuitem" href="${appsHref()}">View all →</a>`;

    if (!isHomePage()) return; // elsewhere, a plain link to index.html#applications is correct as-is
    menu.querySelectorAll("[data-app]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("appsDrop")?.classList.remove("open");
        global.dispatchEvent(new CustomEvent("zonic:select-app", { detail: { id: el.getAttribute("data-app") } }));
      });
    });
  }

  function renderFooterSiblings(apps) {
    const el = document.getElementById("footerSiblings");
    if (!el) return;
    el.innerHTML = apps
      .filter((a) => a.url)
      .map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a>`)
      .join("");
  }

  function markCurrentNav() {
    const here = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll('.nav > a[href], .footer-nav a[href]').forEach((a) => {
      if (a.getAttribute("href") === here) a.classList.add("is-current");
    });
  }

  function bindDropdownToggle() {
    const btn = document.getElementById("appsBtn");
    const drop = document.getElementById("appsDrop");
    if (!btn || !drop) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = drop.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", () => drop.classList.remove("open"));
  }

  async function bootChrome() {
    const yr = document.getElementById("yr");
    if (yr) yr.textContent = new Date().getFullYear();
    bindDropdownToggle();
    markCurrentNav();

    let apps = [];
    try {
      const config = await global.ZonicMeAppsStore.loadConfig("./config/apps.json");
      apps = config.apps || [];
      renderNavApps(apps);
      renderFooterSiblings(apps);
      return config;
    } catch (err) {
      console.error("[ZonicMe chrome] boot degraded, using fallback apps", err);
      apps = (global.ZonicMeAppsStore?.FALLBACK?.apps) || [];
      renderNavApps(apps);
      renderFooterSiblings(apps);
      return { apps };
    }
  }

  global.ZonicChrome = { bootChrome, esc, isHomePage, appsHref };
})(typeof window !== "undefined" ? window : globalThis);
