/**
 * ZonicMe home page: the app gallery (a carousel you can also swipe or scroll),
 * the "every app at a glance" list, and the app sheet that opens from either.
 * Everything is drawn from config/apps.json, so adding an app there adds it here.
 */
(function () {
  window.ZONIC_APP_ID = "zonicme-hub";
  const esc = ZonicChrome.esc;
  const Store = window.ZonicMeAppsStore;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  let APPS = [];
  let gallery = null;

  function track(name, attrs) {
    try { window.ZonicTrack && window.ZonicTrack.span(name, attrs || {}); } catch (_) {}
  }

  function benefitLine(app) {
    return (app.benefit || app.summary || "Part of the ZonicMe family.").trim();
  }

  // ---------- Gallery ----------
  function cardHtml(app, i) {
    const p = Store.present(app);
    const style = `--tone:${esc(p.tone)};--on:${esc(p.on)};--btn:${esc(p.btn)};--btn-on:${esc(p.btnOn)}`;
    const img = p.image
      ? `<img src="${esc(p.image)}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" onerror="this.remove()">`
      : "";
    return `
    <article class="gal-card" id="app-${esc(app.id)}" data-app-id="${esc(app.id)}" style="${style}" aria-roledescription="slide" aria-label="${esc(app.name)}, ${i + 1} of ${APPS.length}">
      <div class="gal-copy">
        <p class="gal-kind">${esc(p.kind)}</p>
        <h3>${esc(app.name)}</h3>
        <p class="gal-line">${esc(benefitLine(app))}</p>
        <div class="gal-links">
          ${app.url ? `<a class="cta" href="${esc(app.url)}" target="_blank" rel="noopener" data-open="${esc(app.id)}">Open ${esc(app.name)}</a>` : ""}
          <button type="button" class="gal-more" data-sheet="${esc(app.id)}">Learn more<span class="visually-hidden"> about ${esc(app.name)}</span></button>
        </div>
      </div>
      <div class="gal-art">${img}</div>
    </article>`;
  }

  function initGallery() {
    const root = document.getElementById("applications");
    const trackEl = document.getElementById("galTrack");
    const dotsEl = document.getElementById("galDots");
    const playBtn = document.getElementById("galPlay");
    trackEl.removeAttribute("aria-busy");
    trackEl.innerHTML = APPS.map(cardHtml).join("");
    dotsEl.innerHTML = APPS.map(
      (a, i) => `<button type="button" class="gal-dot" data-i="${i}" aria-label="Show ${esc(a.name)}"><i></i></button>`
    ).join("");
    const cards = [...trackEl.querySelectorAll(".gal-card")];
    const dots = [...dotsEl.querySelectorAll(".gal-dot")];
    const n = cards.length;
    const DUR = 6500;
    let active = -1;
    let playing = !reduced && n > 1;
    let held = false;
    let onScreen = true;
    let timer = null;
    let raf = 0;

    const leftFor = (i) => cards[i].offsetLeft - (trackEl.clientWidth - cards[i].offsetWidth) / 2;

    function schedule() {
      window.clearTimeout(timer);
      if (!playing || held || !onScreen || document.hidden || n < 2) return;
      timer = window.setTimeout(() => go(active + 1, true), DUR);
    }

    function setActive(i) {
      if (i !== active) {
        active = i;
        cards.forEach((c, k) => c.classList.toggle("is-active", k === i));
      }
      // Re-add the class so the progress bar on the active dot restarts with the timer.
      dots.forEach((d) => { d.classList.remove("is-on"); d.removeAttribute("aria-current"); });
      void dotsEl.offsetWidth;
      dots[i].classList.add("is-on");
      dots[i].setAttribute("aria-current", "true");
      schedule();
    }

    function go(i, auto) {
      const wrapping = i >= n || i < 0;
      i = (i + n) % n;
      if (wrapping && auto && !reduced) {
        // Going from the last card back to the first: fade rather than rewind past every card.
        root.classList.add("is-wrapping");
        window.setTimeout(() => {
          trackEl.scrollTo({ left: leftFor(i), behavior: "auto" });
          setActive(i);
          root.classList.remove("is-wrapping");
        }, 230);
        return;
      }
      trackEl.scrollTo({ left: leftFor(i), behavior: reduced ? "auto" : "smooth" });
      setActive(i);
    }

    function nearest() {
      const mid = trackEl.scrollLeft + trackEl.clientWidth / 2;
      let best = 0;
      let bestD = Infinity;
      cards.forEach((c, k) => {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = k; }
      });
      return best;
    }

    trackEl.addEventListener("scroll", () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const k = nearest();
        if (k !== active) setActive(k);
      });
    }, { passive: true });

    function hold(on) {
      held = on;
      root.classList.toggle("is-held", on);
      if (on) window.clearTimeout(timer);
      else setActive(Math.max(active, 0));
    }
    // Hold only while the pointer or keyboard focus is on the cards, so the controls below stay usable.
    trackEl.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hold(true); });
    trackEl.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hold(false); });
    trackEl.addEventListener("focusin", (e) => {
      // Keyboard focus holds the gallery still; a mouse click that leaves focus behind does not.
      let kb = true;
      try { kb = e.target.matches(":focus-visible"); } catch (_) {}
      if (kb) hold(true);
    });
    trackEl.addEventListener("focusout", (e) => { if (held && !trackEl.contains(e.relatedTarget) && !trackEl.matches(":hover")) hold(false); });
    trackEl.addEventListener("touchstart", () => hold(true), { passive: true });
    trackEl.addEventListener("touchend", () => window.setTimeout(() => hold(false), 2500), { passive: true });

    function setPlaying(on) {
      playing = on;
      root.classList.toggle("is-paused", !on);
      playBtn.setAttribute("aria-label", on ? "Pause the gallery" : "Play the gallery");
      playBtn.setAttribute("aria-pressed", on ? "false" : "true");
      setActive(Math.max(active, 0));
    }
    playBtn.addEventListener("click", () => setPlaying(!playing));
    if (n < 2) playBtn.classList.add("hidden");

    dots.forEach((d) => d.addEventListener("click", () => go(Number(d.dataset.i), false)));
    document.getElementById("galPrev").addEventListener("click", () => go(active - 1, false));
    document.getElementById("galNext").addEventListener("click", () => go(active + 1, false));
    trackEl.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(active + 1, false); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(active - 1, false); }
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        onScreen = entries[0].isIntersecting;
        schedule();
      }, { threshold: 0.15 }).observe(root);
    }
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("resize", () => {
      if (active >= 0) trackEl.scrollTo({ left: leftFor(active), behavior: "auto" });
    });

    root.classList.toggle("is-paused", !playing);
    playBtn.setAttribute("aria-label", playing ? "Pause the gallery" : "Play the gallery");
    trackEl.scrollTo({ left: leftFor(0), behavior: "auto" });
    setActive(0);

    return {
      // After a sheet closes, some browsers never report the pointer leaving the cards. Re-check instead of staying held.
      release() { hold(trackEl.matches(":hover") && window.matchMedia("(hover: hover)").matches); },
      show(id) {
        const i = APPS.findIndex((a) => a.id === id);
        if (i < 0) return;
        root.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        go(i, false);
      },
    };
  }

  // ---------- Lineup ----------
  function renderLineup() {
    const el = document.getElementById("lineup");
    el.innerHTML = APPS.map((app) => {
      const p = Store.present(app);
      return `
      <div class="lu-row" role="listitem">
        <div class="lu-name"><i class="lu-dot" style="--tone:${esc(p.tone)}" aria-hidden="true"></i><span>${esc(app.name)}</span></div>
        <p class="lu-line">${esc(benefitLine(app))}</p>
        <div class="lu-links">
          <button type="button" class="more" data-sheet="${esc(app.id)}">Learn more<span class="visually-hidden"> about ${esc(app.name)}</span></button>
          ${app.url ? `<a class="more" href="${esc(app.url)}" target="_blank" rel="noopener" data-open="${esc(app.id)}">Open<span class="visually-hidden"> ${esc(app.name)}</span></a>` : ""}
        </div>
      </div>`;
    }).join("");
    const n = APPS.length;
    const word = COUNT_WORDS[n] || String(n);
    document.getElementById("lineupTitle").textContent = `${word} app${n === 1 ? "" : "s"}. One family.`;
    document.querySelectorAll("[data-app-count]").forEach((x) => { x.textContent = String(n); });
    document.querySelectorAll("[data-app-count-word]").forEach((x) => { x.textContent = word; });
  }

  // ---------- App sheet ----------
  let lastFocus = null;
  function openSheet(id) {
    const app = APPS.find((a) => a.id === id);
    const dlg = document.getElementById("appSheet");
    if (!app) return;
    if (!dlg || typeof dlg.showModal !== "function") {
      if (app.url) window.open(app.url, "_blank", "noopener");
      return;
    }
    const p = Store.present(app);
    const features = Array.isArray(app.features) ? app.features.filter(Boolean) : [];
    document.getElementById("sheetBody").innerHTML = `
      <p class="sheet-kind" style="--tone:${esc(p.on === "#ffffff" ? p.tone : "#1d1d1f")}">${esc(p.kind)}</p>
      <h2 id="sheetTitle">${esc(app.name)}</h2>
      <p class="sheet-copy">${esc(app.detail || app.summary || benefitLine(app))}</p>
      ${app.benefit || app.brandBenefit ? `<div class="sheet-two">
        ${app.benefit ? `<div><h3>For you</h3><p>${esc(app.benefit)}</p></div>` : ""}
        ${app.brandBenefit ? `<div><h3>For brands</h3><p>${esc(app.brandBenefit)}</p></div>` : ""}
      </div>` : ""}
      ${features.length ? `<div class="sheet-feat"><h3>What you can do</h3><ul>${features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
      <div class="sheet-cta">
        ${app.url ? `<a class="cta" href="${esc(app.url)}" target="_blank" rel="noopener" data-open="${esc(app.id)}">Open ${esc(app.name)}</a>` : `<span class="pill warn">Website coming soon</span>`}
      </div>`;
    lastFocus = document.activeElement;
    dlg.showModal();
    document.getElementById("sheetBody").scrollTop = 0;
    track("hub_app_details", { app: app.id });
  }

  function bindSheet() {
    const dlg = document.getElementById("appSheet");
    if (!dlg) return;
    document.getElementById("sheetClose").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => {
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      if (gallery) gallery.release();
    });
  }

  document.addEventListener("click", (e) => {
    const sheetBtn = e.target.closest && e.target.closest("[data-sheet]");
    if (sheetBtn) { openSheet(sheetBtn.getAttribute("data-sheet")); return; }
    const openLink = e.target.closest && e.target.closest("[data-open]");
    if (openLink) track("hub_app_open", { app: openLink.getAttribute("data-open") });
  });

  window.addEventListener("zonic:select-app", (e) => { if (gallery) gallery.show(e.detail.id); });

  function draw(config) {
    APPS = (config.apps || []).filter((a) => a && a.id && a.name);
    const fallbackById = Object.fromEntries((Store.FALLBACK?.apps || []).map((a) => [a.id, a]));
    APPS.forEach((a) => {
      if (!Array.isArray(a.features) || !a.features.length) a.features = fallbackById[a.id]?.features || [];
    });
    if (config.mission) document.getElementById("missionText").textContent = config.mission;
    if (!APPS.length) {
      document.getElementById("galTrack").innerHTML = "";
      document.getElementById("applications").classList.add("hidden");
      document.getElementById("lineup").innerHTML = `<p class="lu-line" style="padding:22px 0">We could not load the app list just now. Please refresh the page.</p>`;
      return;
    }
    gallery = initGallery();
    renderLineup();
  }

  async function boot() {
    bindSheet();
    const config = await ZonicChrome.bootChrome();
    draw(config && Array.isArray(config.apps) && config.apps.length ? config : await Store.loadConfig("./config/apps.json"));
    const hash = (location.hash || "").replace(/^#app-/, "");
    if (location.hash.indexOf("#app-") === 0 && gallery) gallery.show(hash);
    if (window.ZonicTrack) {
      await window.ZonicTrack.flush();
      track("hub_boot", { apps: APPS.length });
    }
  }

  boot().catch((err) => {
    console.error("[ZonicMe home]", err);
    if (!APPS.length) draw({ apps: Store.FALLBACK?.apps || [] });
  });
})();
