/* Small form helpers shared by every ZonicMe app.
   1. Show/hide control on every password box that does not already have its own.
   2. Date boxes refuse impossible years (some browsers accept a six-digit year unless a limit is set). */
(function () {
  if (typeof window === "undefined" || typeof document === "undefined" || window.__zonicPwEye) return;
  window.__zonicPwEye = true;
  var SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var EYE = SVG + '<path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = SVG + '<path d="M3 3l18 18"/><path d="M10.6 4.6c.5-.1.9-.1 1.4-.1 6.5 0 10.500 7.500 10.500 7.500a17.300 17.300 0 0 1-3.300 4.200"/><path d="M6.400 6.400C3.300 8.500 1.500 12 1.500 12s4 7.500 10.500 7.500c1.700 0 3.200-.4 4.500-1.100"/><path d="M9.900 9.900a3 3 0 0 0 4.200 4.200"/></svg>';
  var pairs = [];

  function hasOwnToggle(input) {
    var scope = input.parentElement;
    if (!scope) return true;
    var btns = scope.querySelectorAll('button,[role="button"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.getAttribute("data-zonic-eye")) continue;
      var label = (b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + (b.textContent || "");
      if (/\b(show|hide|reveal)\b/i.test(label)) return true;
      try { if (window.getComputedStyle(b).position === "absolute") return true; } catch (e) {}
    }
    return false;
  }

  function place(input, btn) {
    if (!input.isConnected || !input.offsetParent) { btn.style.display = "none"; return; }
    btn.style.display = "flex";
    btn.style.top = Math.round(input.offsetTop + (input.offsetHeight - 36) / 2) + "px";
    btn.style.left = Math.round(input.offsetLeft + input.offsetWidth - 42) + "px";
  }

  function attach(input) {
    if (input.getAttribute("data-zonic-eye") || hasOwnToggle(input)) { input.setAttribute("data-zonic-eye", input.getAttribute("data-zonic-eye") || "own"); return; }
    var parent = input.parentElement;
    input.setAttribute("data-zonic-eye", "1");
    try { if (window.getComputedStyle(parent).position === "static") parent.style.position = "relative"; } catch (e) {}
    input.style.paddingRight = "46px";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-zonic-eye", "1");
    btn.setAttribute("aria-label", "Show password");
    btn.setAttribute("aria-pressed", "false");
    btn.title = "Show password";
    btn.innerHTML = EYE;
    btn.style.cssText = "position:absolute;width:36px;height:36px;display:flex;align-items:center;justify-content:center;padding:0;margin:0;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.62;cursor:pointer;z-index:2;min-height:0;min-width:0;box-shadow:none;";
    btn.addEventListener("mouseenter", function () { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", function () { btn.style.opacity = ".62"; });
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.title = show ? "Hide password" : "Show password";
      try { input.focus({ preventScroll: true }); } catch (err) {}
    });
    parent.appendChild(btn);
    place(input, btn);
    if (typeof ResizeObserver === "function") {
      try { new ResizeObserver(function () { place(input, btn); }).observe(input); } catch (e) {}
    }
    // A form that submits or resets should hide the password again.
    if (input.form) input.form.addEventListener("submit", function () { if (input.type === "text") btn.click(); });
    pairs.push([input, btn]);
  }

  function guardDates() {
    var list = document.querySelectorAll('input[type="date"]:not([data-zonic-date]),input[type="datetime-local"]:not([data-zonic-date])');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      el.setAttribute("data-zonic-date", "1");
      var withTime = el.type === "datetime-local";
      if (!el.getAttribute("max")) el.setAttribute("max", withTime ? "2099-12-31T23:59" : "2099-12-31");
      if (!el.getAttribute("min")) el.setAttribute("min", withTime ? "1900-01-01T00:00" : "1900-01-01");
    }
  }

  function scan() {
    guardDates();
    var list = document.querySelectorAll('input[type="password"]:not([data-zonic-eye])');
    for (var i = 0; i < list.length; i++) attach(list[i]);
    for (var j = pairs.length - 1; j >= 0; j--) {
      if (!pairs[j][0].isConnected) { if (pairs[j][1].parentNode) pairs[j][1].parentNode.removeChild(pairs[j][1]); pairs.splice(j, 1); }
      else place(pairs[j][0], pairs[j][1]);
    }
  }

  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    window.setTimeout(function () { queued = false; scan(); }, 60);
  }
  function start() {
    var st = document.createElement("style");
    st.textContent = "input[data-zonic-eye]::-ms-reveal{display:none}";
    document.head.appendChild(st);
    scan();
    try { new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    window.addEventListener("resize", queue);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
