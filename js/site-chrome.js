/**
 * ZonicMe shared site chrome: the top navigation (with the Apps menu and the
 * phone menu), the footer app links, the current-page highlight and the year.
 * Loaded on every page so there is one place that knows how these pieces work.
 */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isHomePage() {
    const last = location.pathname.split("/").pop();
    return last === "" || last === "index.html";
  }

  function appsHref() {
    return isHomePage() ? "#applications" : "./#applications";
  }

  function closeMenus() {
    const drop = document.getElementById("appsDrop");
    const btn = document.getElementById("appsBtn");
    const toggle = document.getElementById("gnToggle");
    if (drop) drop.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("nav-open");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    }
  }

  function renderNavApps(apps) {
    const menu = document.getElementById("appsMenu");
    if (!menu) return;
    const present = global.ZonicMeAppsStore && global.ZonicMeAppsStore.present;
    menu.innerHTML =
      `<p class="dm-head">The ZonicMe apps</p>` +
      apps
        .map((a) => {
          const kind = present ? present(a).kind : "";
          return `<a role="menuitem" href="${appsHref()}" data-app="${esc(a.id)}"><span class="dm-name">${esc(a.name)}</span>${
            kind ? `<span class="dm-kind">${esc(kind)}</span>` : ""
          }</a>`;
        })
        .join("") +
      `<a role="menuitem" class="dm-all more" href="${appsHref()}">See all apps</a>`;

    menu.querySelectorAll("a").forEach((el) => {
      el.addEventListener("click", (e) => {
        const id = el.getAttribute("data-app");
        closeMenus();
        if (!isHomePage() || !id) return; // elsewhere, the plain link to the home page is right
        e.preventDefault();
        global.dispatchEvent(new CustomEvent("zonic:select-app", { detail: { id } }));
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
    // Links may be written as "about.html" or as "/about": compare them by page name.
    const navKey = (h) => String(h || "").replace(/^\.?\//, "").replace(/\.html$/, "") || "index";
    const here = navKey(location.pathname.split("/").pop());
    document.querySelectorAll(".gn-links > a[href], .gf-col a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (/^[a-z]+:/i.test(href) || href.indexOf("#") >= 0) return;
      if (navKey(href) === here) {
        a.classList.add("is-current");
        a.setAttribute("aria-current", "page");
      }
    });
  }

  function bindMenus() {
    const btn = document.getElementById("appsBtn");
    const drop = document.getElementById("appsDrop");
    const toggle = document.getElementById("gnToggle");
    if (btn && drop) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = drop.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      drop.addEventListener("click", (e) => e.stopPropagation());
    }
    if (toggle) {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = !document.documentElement.classList.contains("nav-open");
        closeMenus();
        if (open) {
          document.documentElement.classList.add("nav-open");
          toggle.setAttribute("aria-expanded", "true");
          toggle.setAttribute("aria-label", "Close menu");
        }
      });
    }
    document.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("#gnLinks")) {
        if (e.target.closest("a")) closeMenus();
        return;
      }
      closeMenus();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenus();
    });
    // Leaving phone width with the menu open must not leave the page locked behind it.
    global.addEventListener("resize", () => {
      if (global.innerWidth > 833) document.documentElement.classList.remove("nav-open");
    });
  }

  async function bootChrome() {
    const yr = document.getElementById("yr");
    if (yr) yr.textContent = new Date().getFullYear();
    bindMenus();
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

  global.ZonicChrome = { bootChrome, esc, isHomePage, appsHref, closeMenus };
})(typeof window !== "undefined" ? window : globalThis);
