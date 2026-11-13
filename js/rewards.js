/**
 * ZonicMe Rewards — shared helpers for wallet.html, brand-rewards.html and rewards-admin.html.
 *
 * Every rule (who may see what, balances, limits, budgets) is enforced in the database.
 * This file only draws screens and passes requests to one database entry point (rewards_call).
 * Nothing here can award, move or change points on its own, and no secret lives in this file.
 */
(function (global) {
  "use strict";

  const GENERIC = "Something went wrong. Please try again in a moment.";
  const OFFLINE = "The rewards service cannot be reached right now. Please check your connection and try again.";
  const SIGN_IN = "Please sign in to continue.";
  const KNOWN_EVENTS = [
    ["order_paid", "MyYangaX: an order is paid"],
    ["artwork_purchase_paid", "MyAfriArt: an artwork purchase is paid"],
    ["auction_settlement_paid", "MyAfriArt: an auction win is paid"],
    ["review_completed", "AdSpot: an ad review is completed"],
  ];

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function num(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    try { return v.toLocaleString("en-NG"); } catch (_) { return String(v); }
  }
  function pts(n) {
    const v = Number(n) || 0;
    return num(v) + (Math.abs(v) === 1 ? " point" : " points");
  }
  function dateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (_) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }
  function dateOnly(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }); }
    catch (_) { return d.toISOString().slice(0, 10); }
  }
  /** amount in the smallest currency unit (for example kobo) -> "₦1,250.00" */
  function money(minor, currency) {
    const v = Number(minor) / 100;
    if (!Number.isFinite(v)) return "";
    try { return new Intl.NumberFormat("en-NG", { style: "currency", currency: currency || "NGN" }).format(v); }
    catch (_) { return v.toFixed(2) + " " + (currency || ""); }
  }
  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  // ---------------------------------------------------------------- talking to the database
  function client() { return global.ZonicSupabase || null; }

  function friendly(error) {
    const code = error && error.code;
    const msg = String((error && error.message) || "");
    if (code === "P0001" && msg) {
      // written for people by the rewards functions; still passed through the site's guard
      const pm = global.ZonicPublicMessage;
      return pm ? (pm.publicMessage(msg, { force: true }) || GENERIC) : msg;
    }
    if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) return OFFLINE;
    if (code === "42501" || code === "PGRST301" || code === "PGRST302" || /jwt|not authenticated/i.test(msg)) return SIGN_IN;
    return GENERIC;
  }

  async function call(action, args) {
    const c = client();
    if (!c) throw new Error(OFFLINE);
    let res;
    try {
      res = await c.rpc("rewards_call", { p_action: action, p_args: args || {} });
    } catch (_) {
      throw new Error(OFFLINE);
    }
    if (res.error) throw new Error(friendly(res.error));
    return res.data;
  }

  function say(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "rw-msg" + (kind ? " " + kind : "");
  }
  function errText(e) {
    const t = String((e && e.message) || "").trim();
    return t || GENERIC;
  }
  /** Runs fn while the button is disabled; shows the outcome in msgEl. */
  async function withBusy(btn, msgEl, busyLabel, fn) {
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; if (busyLabel) btn.textContent = busyLabel; }
    say(msgEl, "");
    try {
      const out = await fn();
      return out;
    } catch (e) {
      say(msgEl, errText(e), "bad");
      return undefined;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ---------------------------------------------------------------- page shell
  const state = { page: "", session: null, access: { is_admin: false, brand_count: 0 }, opts: null };

  function tabsHtml() {
    const a = state.access;
    const items = [["wallet", "wallet.html", "My wallet"]];
    if (a.is_admin || a.brand_count > 0 || state.page === "brand") items.push(["brand", "brand-rewards.html", "Brand console"]);
    if (a.is_admin || state.page === "admin") items.push(["admin", "rewards-admin.html", "Admin console"]);
    if (items.length < 2) return "";
    return `<nav class="rw-tabs" aria-label="Rewards sections">${items.map(([id, href, label]) =>
      `<a class="rw-tab${id === state.page ? " is-on" : ""}" href="${href}"${id === state.page ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
  }
  function whoHtml() {
    const s = state.session;
    if (!s) return "";
    return `<div class="rw-who"><span>Signed in as <strong>${esc(s.email)}</strong></span><button type="button" class="rw-link" id="rwSignOut">Sign out</button></div>`;
  }
  function paintShell() {
    const top = $("#rwTop");
    if (!top) return;
    top.innerHTML = tabsHtml() + whoHtml();
    const so = $("#rwSignOut", top);
    if (so) so.addEventListener("click", async () => {
      so.disabled = true;
      try { if (client()) await client().auth.signOut(); } catch (_) { /* signed out locally either way */ }
      await start();
    });
  }
  function setAccess(a) {
    state.access = { is_admin: !!(a && a.is_admin), brand_count: Number((a && a.brand_count) || 0) };
    paintShell();
  }

  async function readSession() {
    if (!client() || !global.ZonicMeAuth) return null;
    try {
      const { data } = await client().auth.getSession();
      const u = data && data.session ? data.session.user : null;
      if (!u) return null;
      return { email: String(u.email || "").toLowerCase(), userId: u.id, confirmed: !!(u.email_confirmed_at || u.confirmed_at) };
    } catch (_) {
      return null;
    }
  }

  async function start() {
    const o = state.opts;
    const root = $("#rwRoot");
    if (!root) return;
    if (!client()) {
      state.session = null;
      paintShell();
      root.innerHTML = `<div class="rw-note"><strong>Rewards could not load.</strong> ${esc(OFFLINE)} <button type="button" class="rw-link" id="rwRetry">Try again</button></div>`;
      const r = $("#rwRetry", root);
      if (r) r.addEventListener("click", () => global.location.reload());
      return;
    }
    state.session = await readSession();
    state.access = { is_admin: false, brand_count: 0 };
    paintShell();
    try {
      if (state.session) await o.signedIn(root, state.session);
      else await o.signedOut(root);
    } catch (e) {
      root.innerHTML = `<div class="rw-note"><strong>This page could not finish loading.</strong> ${esc(errText(e))} <button type="button" class="rw-link" id="rwRetry">Try again</button></div>`;
      const r = $("#rwRetry", root);
      if (r) r.addEventListener("click", () => start());
    }
  }

  async function boot(opts) {
    state.opts = opts;
    state.page = opts.page;
    try { if (global.ZonicChrome) await global.ZonicChrome.bootChrome(); } catch (_) { /* header still works */ }
    // the three rewards screens all sit under "Rewards" in the menu
    $all(".nav > a[href]").forEach((a) => { if (/(^|\/)wallet(\.html)?$/.test(a.getAttribute("href") || "")) a.classList.add("is-current"); });
    try { if (global.ZonicMeAuth && client()) await global.ZonicMeAuth.init(); } catch (_) { /* treated as signed out */ }
    await start();
    try {
      if (global.ZonicTrack) { await global.ZonicTrack.flush(); global.ZonicTrack.span("rewards_" + opts.page + "_view"); }
    } catch (_) { /* analytics never blocks the page */ }
  }

  // ---------------------------------------------------------------- sign-in / create account
  function mountGate(el, opts) {
    opts = opts || {};
    el.innerHTML = `
      <div class="rw-card rw-gate rw-form">
        <h2 id="rwGateTitle">Sign in</h2>
        <p class="rw-lead" id="rwGateIntro">${esc(opts.intro || "Sign in with your ZonicMe account.")}</p>
        <form id="rwGateForm" novalidate>
          <div id="rwNameWrap" class="hidden">
            <label for="rwName">Your name</label>
            <input id="rwName" type="text" autocomplete="name" maxlength="80">
          </div>
          <label for="rwEmail">Email address</label>
          <input id="rwEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="200" placeholder="you@example.com">
          <div id="rwPassWrap">
            <label for="rwPass">Password</label>
            <input id="rwPass" type="password" autocomplete="current-password" maxlength="200">
          </div>
          <div class="rw-actions"><button class="rw-btn" type="submit" id="rwGateBtn">Sign in</button></div>
        </form>
        <p class="rw-msg" id="rwGateMsg" role="status" aria-live="polite"></p>
        <p class="rw-hint">
          <button type="button" class="rw-link" id="rwGateMode">Create an account</button>
          &nbsp;·&nbsp;
          <button type="button" class="rw-link" id="rwGateForgot">Forgot password?</button>
        </p>
        ${opts.note ? `<p class="rw-hint">${esc(opts.note)}</p>` : ""}
      </div>`;
    let mode = "signin";
    const msg = $("#rwGateMsg", el), btn = $("#rwGateBtn", el);
    function setMode(m) {
      mode = m;
      $("#rwGateTitle", el).textContent = m === "signup" ? "Create your account" : m === "forgot" ? "Reset your password" : "Sign in";
      $("#rwNameWrap", el).classList.toggle("hidden", m !== "signup");
      $("#rwPassWrap", el).classList.toggle("hidden", m === "forgot");
      $("#rwPass", el).setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
      btn.textContent = m === "signup" ? "Create account" : m === "forgot" ? "Email me a reset link" : "Sign in";
      $("#rwGateMode", el).textContent = m === "signin" ? "Create an account" : "I already have an account";
      $("#rwGateForgot", el).classList.toggle("hidden", m === "forgot");
      say(msg, "");
    }
    $("#rwGateMode", el).addEventListener("click", () => setMode(mode === "signin" ? "signup" : "signin"));
    $("#rwGateForgot", el).addEventListener("click", () => setMode("forgot"));
    $("#rwGateForm", el).addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = $("#rwEmail", el).value.trim().toLowerCase();
      const pass = $("#rwPass", el).value;
      const pm = global.ZonicPublicMessage;
      const clean = (t) => (pm ? pm.publicMessage(t) : String(t || "")) || GENERIC;
      if (!email || email.indexOf("@") < 1) return say(msg, "Enter your email address.", "bad");
      if (!global.ZonicMeAuth || !client()) return say(msg, OFFLINE, "bad");
      await withBusy(btn, msg, "Please wait…", async () => {
        if (mode === "forgot") {
          const r = await global.ZonicMeAuth.resetLocalPassword(email);
          if (!r.ok) throw new Error(clean(r.error));
          say(msg, "If that email has an account, a reset link is on its way. Set your new password, then come back here and sign in.", "ok");
          return;
        }
        if (mode === "signup") {
          if (pass.length < 8) throw new Error("Use a password of at least 8 characters.");
          const name = $("#rwName", el).value.trim();
          const { data, error } = await client().auth.signUp({
            email, password: pass,
            options: { data: { name: name || email }, emailRedirectTo: global.location.origin + global.location.pathname },
          });
          if (error) throw new Error(clean(error.message));
          if (!data || !data.session) {
            say(msg, "Almost there. We sent a confirmation link to " + email + ". Open it, then come back here and sign in.", "ok");
            return;
          }
          try { if (global.ZonicAdminApproval) await global.ZonicAdminApproval.registerSignup("member"); } catch (_) { /* never blocks */ }
          await start();
          return;
        }
        if (!pass) throw new Error("Enter your password.");
        const r = await global.ZonicMeAuth.loginEmailPassword(email, pass);
        if (!r.ok) throw new Error(clean(r.error));
        await start();
      });
    });
  }

  // ---------------------------------------------------------------- rules: describe, form, read
  const PERIOD_WORD = { day: "a day", week: "a week", month: "a month", total: "in total" };
  const WHY = {
    conditions_not_met: "the event did not match this rule's conditions",
    zero_award: "the amount was too small to earn a whole point",
    nothing_to_multiply: "no points had been earned yet for it to multiply",
    badge_already_held: "this person already has the badge",
    account_daily_cap: "this person has reached the daily earning ceiling",
    budget_exhausted: "the campaign budget is used up",
  };
  function whyText(code) {
    const c = String(code || "");
    if (c.indexOf("cap_reached") === 0) return "a limit on this rule has been reached";
    return WHY[c] || "it did not apply to this event";
  }
  function eventLabel(t) {
    const hit = KNOWN_EVENTS.find((e) => e[0] === t);
    return hit ? hit[1] : (t ? "Event “" + t + "”" : "Any event");
  }

  function simpleOf(rule) {
    const cfg = rule.config || {}, keys = Object.keys(cfg);
    const out = { ok: true, kind: null, value: "", max: "", badge: "", label: "", minAmount: "", capCount: "", capCountPeriod: "day", capPoints: "", capPointsPeriod: "day" };
    const only = (allowed) => keys.every((k) => allowed.indexOf(k) >= 0);
    if ((rule.action === "award_points" || rule.action === "award_gift_credit") && only(["points", "bps", "max_points"]) && (("points" in cfg) !== ("bps" in cfg))) {
      out.kind = (rule.action === "award_points" ? "points" : "credit") + ("points" in cfg ? "_fixed" : "_pct");
      out.value = "points" in cfg ? String(cfg.points) : String(Number(cfg.bps) / 100);
      out.max = cfg.max_points != null ? String(cfg.max_points) : "";
    } else if (rule.action === "badge" && only(["badge", "label"])) {
      out.kind = "badge"; out.badge = cfg.badge || ""; out.label = cfg.label || "";
    } else if (rule.action === "multiplier" && keys.length === 1 && "factor_bps" in cfg) {
      out.kind = "multiplier"; out.value = String(Number(cfg.factor_bps) / 10000);
    } else out.ok = false;

    const c = rule.conditions || {};
    const one = (x) => x && x.field === "amount" && (x.op === "gte") && x.value != null && Object.keys(x).length === 3;
    if (Object.keys(c).length === 0) out.minAmount = "";
    else if (one(c)) out.minAmount = String(c.value);
    else if (Array.isArray(c.all) && c.all.length === 1 && Object.keys(c).length === 1 && one(c.all[0])) out.minAmount = String(c.all[0].value);
    else out.ok = false;

    const caps = Array.isArray(rule.caps) ? rule.caps : [];
    let nCount = 0, nPoints = 0;
    caps.forEach((k) => {
      if (!k || k.per !== "user") { out.ok = false; return; }
      if ("count" in k) { nCount++; out.capCount = String(k.count); out.capCountPeriod = k.period; }
      else if ("points" in k) { nPoints++; out.capPoints = String(k.points); out.capPointsPeriod = k.period; }
    });
    if (nCount > 1 || nPoints > 1) out.ok = false;
    return out;
  }

  /** One plain sentence describing what a rule does. */
  function describeRule(rule) {
    const s = simpleOf(rule), parts = [];
    if (!s.ok) parts.push("Custom settings");
    else {
      const what = s.kind && s.kind.indexOf("credit") === 0 ? "gift credit" : "points";
      if (s.kind === "badge") parts.push("Gives the badge “" + (s.label || s.badge) + "”");
      else if (s.kind === "multiplier") parts.push("Multiplies points already earned from the event by " + s.value);
      else if (/_fixed$/.test(s.kind)) parts.push("Awards " + num(s.value) + " " + what);
      else parts.push("Awards " + s.value + "% of the amount as " + what + (s.max ? " (at most " + num(s.max) + " per event)" : ""));
      if (s.minAmount) parts.push("when the amount is at least " + num(s.minAmount));
      if (s.capCount) parts.push("each person up to " + num(s.capCount) + (Number(s.capCount) === 1 ? " time " : " times ") + PERIOD_WORD[s.capCountPeriod]);
      if (s.capPoints) parts.push("each person up to " + num(s.capPoints) + " points " + PERIOD_WORD[s.capPointsPeriod]);
    }
    parts.unshift(eventLabel(rule.event_type));
    if (rule.expiry_days) parts.push("points expire after " + num(rule.expiry_days) + " days");
    return parts.join(" · ");
  }

  function periodOptions(sel) {
    return [["day", "per day"], ["week", "per week"], ["month", "per month"], ["total", "ever"]]
      .map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");
  }

  /** opts: { admin, apps:[{app_id,name}], brands:[{id,name}], idPrefix } */
  function ruleFormHtml(opts) {
    const p = opts.idPrefix || "rf";
    const admin = !!opts.admin;
    const apps = (opts.apps || []).map((a) => `<option value="${esc(a.app_id)}">${esc(a.name)}</option>`).join("");
    const brands = (opts.brands || []).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    return `
      <form class="rw-form" id="${p}Form" novalidate>
        <input type="hidden" name="rule_key"><input type="hidden" name="campaign_id">
        <label for="${p}Name">Rule name</label>
        <input id="${p}Name" name="name" type="text" maxlength="120" placeholder="For example: 1 point for every ₦100 spent">
        <label for="${p}Desc">Short description people will see</label>
        <input id="${p}Desc" name="description" type="text" maxlength="500" placeholder="Optional">
        ${admin ? `
        <div class="rw-row3">
          <div><label for="${p}Scope">Where it applies</label>
            <select id="${p}Scope" name="scope">
              <option value="global">Every app</option><option value="application">One app</option><option value="brand">One brand</option>
            </select></div>
          <div data-show-scope="application"><label for="${p}App">App</label><select id="${p}App" name="app_id">${apps}</select></div>
          <div data-show-scope="brand"><label for="${p}Brand">Brand</label><select id="${p}Brand" name="brand_id">${brands || '<option value="">No brands yet</option>'}</select></div>
        </div>` : ""}
        <label for="${p}Event">Which event earns the reward</label>
        <select id="${p}Event" name="event_type">
          <option value="">Any event the app sends</option>
          ${KNOWN_EVENTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
          ${admin ? '<option value="__other">A different event (enter its code)</option>' : ""}
        </select>
        <div data-event-other class="hidden">
          <label for="${p}EventOther">Event code, exactly as the app sends it</label>
          <input id="${p}EventOther" name="event_custom" type="text" maxlength="64" autocapitalize="none" spellcheck="false" placeholder="for example booking_confirmed">
        </div>

        <div data-simple>
          <div class="rw-row3">
            <div><label for="${p}Kind">What it gives</label>
              <select id="${p}Kind" name="kind">
                <option value="points_fixed">A fixed number of points</option>
                <option value="points_pct">Points as a percentage of the amount</option>
                <option value="credit_fixed">A fixed amount of gift credit</option>
                <option value="credit_pct">Gift credit as a percentage of the amount</option>
                ${admin ? '<option value="badge">A badge</option><option value="multiplier">A multiplier on points from the same event</option>' : ""}
              </select></div>
            <div data-kind="points_fixed credit_fixed points_pct credit_pct multiplier"><label for="${p}Value" id="${p}ValueLabel">How many points</label>
              <input id="${p}Value" name="value" type="text" inputmode="decimal" maxlength="12"></div>
            <div data-kind="points_pct credit_pct"><label for="${p}Max">Most points per event</label>
              <input id="${p}Max" name="max" type="text" inputmode="numeric" maxlength="10" placeholder="No ceiling"></div>
            <div data-kind="badge"><label for="${p}Badge">Badge code</label>
              <input id="${p}Badge" name="badge" type="text" maxlength="60" autocapitalize="none" placeholder="first-order"></div>
            <div data-kind="badge"><label for="${p}BadgeLabel">Badge name people see</label>
              <input id="${p}BadgeLabel" name="badge_label" type="text" maxlength="80" placeholder="First order"></div>
          </div>
          <label for="${p}Min">Only when the amount is at least</label>
          <input id="${p}Min" name="min_amount" type="text" inputmode="decimal" maxlength="14" placeholder="Leave empty for any amount">
          <div class="rw-row">
            <div><label for="${p}CapCount">Each person can earn it at most (times)</label>
              <div class="rw-row"><input id="${p}CapCount" name="cap_count" type="text" inputmode="numeric" maxlength="8" placeholder="No limit" aria-label="Number of times">
              <select name="cap_count_period" aria-label="Period for the number of times">${periodOptions("day")}</select></div></div>
            <div><label for="${p}CapPoints">Each person can earn at most (points)</label>
              <div class="rw-row"><input id="${p}CapPoints" name="cap_points" type="text" inputmode="numeric" maxlength="10" placeholder="No limit" aria-label="Number of points">
              <select name="cap_points_period" aria-label="Period for the number of points">${periodOptions("day")}</select></div></div>
          </div>
        </div>

        <div class="rw-row3">
          <div><label for="${p}Expiry">Points expire after (days)</label>
            <input id="${p}Expiry" name="expiry_days" type="text" inputmode="numeric" maxlength="4" placeholder="Never"></div>
          <div><label for="${p}Starts">Starts</label><input id="${p}Starts" name="starts_at" type="datetime-local"></div>
          <div><label for="${p}Ends">Ends</label><input id="${p}Ends" name="ends_at" type="datetime-local"></div>
        </div>
        <div class="rw-row">
          <div><label for="${p}Priority">Order (lower runs first)</label>
            <input id="${p}Priority" name="priority" type="text" inputmode="numeric" maxlength="5" value="100"></div>
          <div style="align-self:end">
            <label class="rw-check"><input type="checkbox" name="stop_after"> <span>When this rule awards, stop checking the rules after it</span></label>
          </div>
        </div>
        <label class="rw-check"><input type="checkbox" name="active"> <span><strong>Switch this rule on</strong> as soon as it is saved</span></label>

        <details class="rw-adv">
          <summary>Advanced settings</summary>
          <label class="rw-check"><input type="checkbox" name="use_adv"> <span>Use the settings below instead of the simple fields above</span></label>
          <label for="${p}AdvAction">Action</label>
          <select id="${p}AdvAction" name="adv_action">
            <option value="award_points">award_points</option><option value="award_gift_credit">award_gift_credit</option>
            <option value="cashback">cashback</option>${admin ? '<option value="badge">badge</option><option value="multiplier">multiplier</option>' : ""}
          </select>
          <label for="${p}AdvConfig">Award settings</label><textarea id="${p}AdvConfig" name="adv_config" spellcheck="false" autocapitalize="none">{}</textarea>
          <label for="${p}AdvCond">Conditions</label><textarea id="${p}AdvCond" name="adv_conditions" spellcheck="false" autocapitalize="none">{}</textarea>
          <label for="${p}AdvCaps">Limits</label><textarea id="${p}AdvCaps" name="adv_caps" spellcheck="false" autocapitalize="none">[]</textarea>
          <p class="rw-hint">For tiers, several conditions or limits per app. The settings are checked when you save, and nothing is saved if they are not valid.</p>
        </details>

        <div class="rw-actions">
          <button type="submit" class="rw-btn" data-role="save">Save rule</button>
          <button type="button" class="rw-btn ghost" data-role="cancel">Cancel</button>
        </div>
        <p class="rw-msg" data-role="msg" role="status" aria-live="polite"></p>
      </form>`;
  }

  function syncRuleForm(form) {
    const f = form.elements;
    const kind = f.kind.value;
    $all("[data-kind]", form).forEach((el) => el.classList.toggle("hidden", el.getAttribute("data-kind").split(" ").indexOf(kind) < 0));
    const label = $("#" + f.value.id + "Label", form);
    $("[data-event-other]", form).classList.toggle("hidden", f.event_type.value !== "__other");
    if (label) label.textContent = kind === "multiplier" ? "Multiply by (for example 2)" : /_pct$/.test(kind) ? "Percentage of the amount" : "How many points";
    if (f.scope) $all("[data-show-scope]", form).forEach((el) => el.classList.toggle("hidden", el.getAttribute("data-show-scope") !== f.scope.value));
    $("[data-simple]", form).classList.toggle("hidden", f.use_adv.checked);
  }

  function fillRuleForm(form, rule, extra) {
    const f = form.elements;
    form.reset();
    rule = rule || {};
    f.rule_key.value = rule.rule_key || "";
    f.campaign_id.value = (extra && extra.campaign_id) || rule.campaign_id || "";
    f.name.value = rule.name || "";
    f.description.value = rule.description || "";
    if (f.scope) {
      f.scope.value = rule.scope && rule.scope !== "campaign" ? rule.scope : "global";
      if (rule.app_id) f.app_id.value = rule.app_id;
      if (rule.brand_id) f.brand_id.value = rule.brand_id;
      f.scope.disabled = !!rule.rule_key && rule.scope === "campaign";
    }
    const ev = rule.event_type || "";
    f.event_custom.value = "";
    if (ev && !KNOWN_EVENTS.some((e) => e[0] === ev)) {
      if (!$("option[value='__other']", f.event_type)) {
        const o = document.createElement("option"); o.value = "__other"; o.textContent = "A different event (enter its code)"; f.event_type.appendChild(o);
      }
      f.event_type.value = "__other"; f.event_custom.value = ev;
    } else f.event_type.value = ev;
    const s = rule.rule_key ? simpleOf(rule) : { ok: true, kind: "points_fixed", value: "", max: "", badge: "", label: "", minAmount: "", capCount: "", capCountPeriod: "day", capPoints: "", capPointsPeriod: "day" };
    if (s.ok && s.kind && !$("option[value='" + s.kind + "']", f.kind)) s.ok = false;
    if (s.ok) {
      f.kind.value = s.kind; f.value.value = s.value; f.max.value = s.max; f.badge.value = s.badge; f.badge_label.value = s.label;
      f.min_amount.value = s.minAmount; f.cap_count.value = s.capCount; f.cap_count_period.value = s.capCountPeriod;
      f.cap_points.value = s.capPoints; f.cap_points_period.value = s.capPointsPeriod;
    }
    f.use_adv.checked = !s.ok;
    form.querySelector("details.rw-adv").open = !s.ok;
    if (rule.action && $("option[value='" + rule.action + "']", f.adv_action)) f.adv_action.value = rule.action;
    f.adv_config.value = JSON.stringify(rule.config || {}, null, 1);
    f.adv_conditions.value = JSON.stringify(rule.conditions || {}, null, 1);
    f.adv_caps.value = JSON.stringify(rule.caps || [], null, 1);
    f.expiry_days.value = rule.expiry_days != null ? String(rule.expiry_days) : "";
    f.starts_at.value = toLocalInput(rule.starts_at);
    f.ends_at.value = toLocalInput(rule.ends_at);
    f.priority.value = rule.priority != null ? String(rule.priority) : "100";
    f.stop_after.checked = !!rule.stop_after;
    f.active.checked = !!rule.active;
    syncRuleForm(form);
  }

  function wholeNumber(v, what, allowEmpty) {
    const t = String(v || "").trim().replace(/,/g, "");
    if (!t) { if (allowEmpty) return null; throw new Error("Enter " + what + "."); }
    if (!/^[0-9]{1,12}$/.test(t) || Number(t) < 1) throw new Error(what.charAt(0).toUpperCase() + what.slice(1) + " must be a whole number above zero.");
    return Number(t);
  }
  function parseJson(text, what, wantArray) {
    let v;
    try { v = JSON.parse(String(text || "").trim() || (wantArray ? "[]" : "{}")); }
    catch (_) { throw new Error("The advanced " + what + " are not written correctly. Check the brackets and quotes."); }
    if (wantArray ? !Array.isArray(v) : (typeof v !== "object" || v === null || Array.isArray(v))) {
      throw new Error("The advanced " + what + " are not written correctly.");
    }
    return v;
  }

  /** Reads the form into the payload the database expects. Throws a plain-language Error when something is missing. */
  function readRuleForm(form) {
    const f = form.elements;
    const p = {
      name: f.name.value.trim(), description: f.description.value.trim(), event_type: f.event_type.value || "",
      stop_after: f.stop_after.checked, active: f.active.checked,
      starts_at: fromLocalInput(f.starts_at.value), ends_at: fromLocalInput(f.ends_at.value),
    };
    if (f.rule_key.value) p.rule_key = f.rule_key.value;
    if (f.campaign_id.value) p.campaign_id = f.campaign_id.value;
    if (p.name.length < 2) throw new Error("Give the rule a name.");
    if (p.event_type === "__other") {
      p.event_type = f.event_custom.value.trim().toLowerCase();
      if (!/^[a-z0-9_.:-]{2,64}$/.test(p.event_type)) throw new Error("Enter the event code using lower-case letters, numbers, dots, dashes or underscores.");
    }
    if (f.scope && !f.campaign_id.value) {
      p.scope = f.scope.value;
      if (p.scope === "application") p.app_id = f.app_id.value;
      if (p.scope === "brand") p.brand_id = f.brand_id.value;
    }
    p.expiry_days = wholeNumber(f.expiry_days.value, "the number of days", true);
    const pr = String(f.priority.value || "").trim();
    if (pr && !/^[0-9]{1,5}$/.test(pr)) throw new Error("The order must be a whole number between 0 and 10000.");
    if (pr) p.priority = Number(pr);

    if (f.use_adv.checked) {
      p.action = f.adv_action.value;
      p.config = parseJson(f.adv_config.value, "award settings", false);
      p.conditions = parseJson(f.adv_conditions.value, "conditions", false);
      p.caps = parseJson(f.adv_caps.value, "limits", true);
      return p;
    }
    const kind = f.kind.value;
    if (kind === "badge") {
      p.action = "badge";
      const code = f.badge.value.trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,60}$/.test(code)) throw new Error("Give the badge a short code using lower-case letters, numbers, dashes or underscores.");
      p.config = { badge: code }; if (f.badge_label.value.trim()) p.config.label = f.badge_label.value.trim();
    } else if (kind === "multiplier") {
      p.action = "multiplier";
      const m = Number(String(f.value.value).trim());
      if (!Number.isFinite(m) || m <= 1 || m > 10) throw new Error("A multiplier must be more than 1 and at most 10, for example 2.");
      p.config = { factor_bps: Math.round(m * 10000) };
    } else {
      p.action = kind.indexOf("credit") === 0 ? "award_gift_credit" : "award_points";
      if (/_fixed$/.test(kind)) p.config = { points: wholeNumber(f.value.value, "how many points") };
      else {
        const pc = Number(String(f.value.value).trim().replace(/%$/, ""));
        if (!Number.isFinite(pc) || pc <= 0 || pc > 1000) throw new Error("Enter the percentage as a number, for example 1 or 2.5.");
        p.config = { bps: Math.round(pc * 100) };
        if (p.config.bps < 1) throw new Error("The smallest percentage is 0.01.");
        const mx = wholeNumber(f.max.value, "the most points per event", true);
        if (mx) p.config.max_points = mx;
      }
    }
    const min = String(f.min_amount.value || "").trim().replace(/,/g, "");
    if (min) {
      if (!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(min)) throw new Error("Enter the smallest amount as a number, for example 5000.");
      p.conditions = { all: [{ field: "amount", op: "gte", value: Number(min) }] };
    } else p.conditions = {};
    p.caps = [];
    const cc = wholeNumber(f.cap_count.value, "the number of times", true);
    if (cc) p.caps.push({ per: "user", period: f.cap_count_period.value, count: cc });
    const cp = wholeNumber(f.cap_points.value, "the number of points", true);
    if (cp) p.caps.push({ per: "user", period: f.cap_points_period.value, points: cp });
    return p;
  }

  function bindRuleForm(form) {
    ["change", "input"].forEach((evt) => form.addEventListener(evt, (e) => {
      if (e.target && ["kind", "scope", "use_adv", "event_type"].indexOf(e.target.name) >= 0) syncRuleForm(form);
    }));
    syncRuleForm(form);
  }

  /** Draws the outcome of a "what would happen" test. steps = rows of the evaluation trace. */
  function dryRunHtml(points, credit, steps) {
    const rows = (steps || []).map((s) => {
      const out = s.outcome === "awarded" ? `<span class="rw-plus">+${num(s.points)} ${s.bucket === "gift_credit" ? "gift credit" : "points"}</span>`
        : s.outcome === "badge" ? `<span class="rw-plus">badge given</span>`
        : `<span class="rw-sub">No award: ${esc(whyText(s.why))}</span>`;
      return `<tr><td>${esc(s.rule)}${s.campaign ? `<span class="rw-sub">${esc(s.campaign)}</span>` : ""}</td><td>${out}</td></tr>`;
    }).join("");
    return `<div class="rw-note calm"><strong>This is only a test. Nothing was awarded.</strong> The event would earn
      <strong>${pts(points)}</strong>${Number(credit) > 0 ? ` and <strong>${num(credit)} gift credit</strong>` : ""}.</div>
      ${rows ? `<div class="rw-scroll"><table class="rw-table"><thead><tr><th>Rule</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="rw-empty">No rule looked at this event. Check that a rule is switched on for this app and event.</p>`}`;
  }

  function statusPill(status) {
    const map = {
      active: ["ok", "Running"], draft: ["", "Draft"], pending: ["warn", "Waiting for approval"], paused: ["warn", "Paused"],
      ended: ["", "Ended"], rejected: ["bad", "Not approved"], suspended: ["bad", "Suspended"], frozen: ["bad", "On hold"],
      planned: ["", "Planned"], revoked: ["bad", "Switched off"], closed: ["", "Closed"],
    };
    const m = map[status] || ["", status || ""];
    return `<span class="rw-pill ${m[0]}">${esc(m[1])}</span>`;
  }
  const demoPill = (is) => (is ? ' <span class="rw-pill demo">Demo</span>' : "");

  global.ZonicRewards = {
    esc, num, pts, dateTime, dateOnly, money, toLocalInput, fromLocalInput, $, $all,
    call, say, errText, withBusy, boot, start, setAccess, mountGate,
    describeRule, eventLabel, whyText, ruleFormHtml, fillRuleForm, readRuleForm, bindRuleForm, dryRunHtml,
    statusPill, demoPill, KNOWN_EVENTS, wholeNumber,
    get session() { return state.session; },
  };
})(typeof window !== "undefined" ? window : globalThis);
