/* Zonic auto-refresh: when a new version is deployed, open tabs pick it up automatically. */
(function () {
  if (window.__zonicAutoRefresh) return;
  window.__zonicAutoRefresh = true;
  var INTERVAL = 120000, GUARD_KEY = "zonic_ar_last";
  function entryOf(doc) {
    var s = doc.querySelectorAll("script[src]"), i, src;
    for (i = 0; i < s.length; i++) {
      src = s[i].getAttribute("src") || "";
      if (/\/assets\/[^/]*\.js(\?|$)/.test(src) || /main-app[^/]*\.js/.test(src) || /_next\/static\/[^/]+\/_buildManifest/.test(src)) return src.split("?")[0];
    }
    return "";
  }
  var current = entryOf(document);
  if (!current) return;
  function editing() {
    var a = document.activeElement;
    return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a && a.isContentEditable);
  }
  function banner() {
    if (document.getElementById("zonic-ar-banner")) return;
    var b = document.createElement("div");
    b.id = "zonic-ar-banner";
    b.setAttribute("style", "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;padding:10px 16px;border-radius:999px;font:14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer");
    b.textContent = "A new version is available. Tap to refresh.";
    b.onclick = function () { location.reload(); };
    document.body.appendChild(b);
  }
  function apply() {
    var last = 0;
    try { last = +sessionStorage.getItem(GUARD_KEY) || 0; } catch (e) {}
    if (Date.now() - last < 60000) return banner();
    if (editing()) return banner();
    try { sessionStorage.setItem(GUARD_KEY, String(Date.now())); } catch (e) {}
    location.reload();
  }
  function check() {
    fetch("/?_v=" + Date.now(), { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (t) {
        if (!t) return;
        var latest = entryOf(new DOMParser().parseFromString(t, "text/html"));
        if (latest && latest !== current) apply();
      }).catch(function () {});
  }
  window.addEventListener('vite:preloadError', function () { apply(); });
  setInterval(check, INTERVAL);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
})();
