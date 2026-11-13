/** ZonicMe Rewards — Admin Console (rewards-admin.html). The database checks every request; this file only draws the screens. */
(function () {
  "use strict";
  const R = window.ZonicRewards;
  const { esc, num, pts, $, $all, say } = R;
  let rootEl = null, ov = null, rulesData = null, brandsData = null, tab = "overview", foundAccount = null;

  const TABS = [["overview", "Overview"], ["guide", "Guide"], ["rules", "Rules"], ["approvals", "Approvals"], ["brands", "Brands"],
    ["accounts", "Accounts"], ["monitor", "Monitoring"], ["settings", "Settings"], ["apps", "Apps"], ["audit", "Audit log"]];

  async function signedOut(root) {
    root.innerHTML = `<div id="rwGate"></div>`;
    R.mountGate($("#rwGate", root), {
      intro: "This area is for ZonicMe administrators. Sign in with your admin account.",
      note: "Looking for your own points? They are in your wallet, under Rewards in the menu.",
    });
  }

  const appName = (id) => { const a = ((ov && ov.apps) || []).find((x) => x.app_id === id); return a ? a.name : (id || ""); };
  const superOnly = () => (ov && ov.is_super ? "" : `<div class="rw-note">You can look at everything here. Changes can only be made by the owner or a super admin.</div>`);
  const table = (head, rows, empty) => rows.length
    ? `<div class="rw-scroll"><table class="rw-table"><thead><tr>${head.map((h) => `<th${h[1] ? ' class="n"' : ""}>${h[0]}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="rw-empty">${empty}</p>`;

  // ------------------------------------------------------------------ overview
  function overviewHtml() {
    const t = ov.totals, s = ov.settings, d = ov.demo;
    const demoCount = Number(d.accounts) + Number(d.events) + Number(d.rules) + Number(d.brands) + Number(d.apps);
    const recent = (ov.recent || []).map((r) => `<tr><td>${esc(R.dateTime(r.created_at))}</td><td>${esc(r.account || "")}${R.demoPill(r.is_demo)}</td>
      <td>${esc(r.tx_type.replace("_", " "))}<span class="rw-sub">${esc([appName(r.source_app), r.rule, r.campaign, r.reason].filter(Boolean).join(" · "))}</span></td>
      <td class="n"><span class="${r.amount >= 0 ? "rw-plus" : "rw-minus"}">${r.amount >= 0 ? "+" : "−"}${num(Math.abs(r.amount))}</span></td></tr>`);
    return `
      ${ov.integrity.ok ? `<div class="rw-note calm"><strong>Ledger check passed.</strong> All ${num(ov.integrity.accounts_checked)} balances match their history exactly.</div>`
        : `<div class="rw-note"><strong>Ledger check needs attention.</strong> ${num(ov.integrity.mismatched)} balance(s) do not match their history. Please contact your developer before making adjustments.</div>`}
      ${Number(ov.unexplained_intake_24h) > 0 ? `<div class="rw-note"><strong>${num(ov.unexplained_intake_24h)} request(s) from unknown senders were refused in the last 24 hours.</strong> Nothing was awarded. See Monitoring.</div>` : ""}
      <div class="rw-stats">
        <div class="rw-stat big"><div class="l">Points held by people</div><div class="v">${num(Number(t.points_outstanding) + Number(t.gift_credit_outstanding))}</div>
          <div class="s">${t.liability_minor != null ? "Worth " + esc(R.money(t.liability_minor, s.value_currency)) + " at today's point value" : "No cash value set"}</div></div>
        <div class="rw-stat"><div class="l">Wallets</div><div class="v">${num(t.accounts)}</div><div class="s">${num(t.claimed)} opened by their owner · ${num(t.frozen)} on hold</div></div>
        <div class="rw-stat"><div class="l">Earned / redeemed</div><div class="v">${num(t.lifetime_earned)}</div><div class="s">${num(t.lifetime_redeemed)} redeemed · ${num(t.gifts)} gifts</div></div>
        <div class="rw-stat"><div class="l">Events received</div><div class="v">${num(t.events_24h)}</div><div class="s">last 24 hours · ${num(t.events_7d)} in 7 days</div></div>
      </div>
      <div class="rw-card"><h2>Where things stand</h2>
        <div class="rw-pills">
          <span class="rw-pill ${s.redemption_enabled ? "ok" : "warn"}">Redemption ${s.redemption_enabled ? "on" : "off"}</span>
          <span class="rw-pill ${s.point_value_minor ? "ok" : "warn"}">${s.point_value_minor ? "1 point = " + esc(R.money(s.point_value_minor, s.value_currency)) : "Point value not set"}</span>
          <span class="rw-pill ${s.gifting_enabled ? "ok" : "warn"}">Gifting ${s.gifting_enabled ? "on" : "off"}</span>
          <span class="rw-pill ${(ov.pending_campaigns || []).length ? "warn" : "ok"}">${num((ov.pending_campaigns || []).length)} campaign(s) waiting for approval</span>
        </div>
        <p class="rw-hint">New to this console? Open the <button type="button" class="rw-link" data-tab="guide">Guide</button> for what each screen is for.</p></div>
      <div class="rw-card"><h2>Latest activity</h2>
        ${table([["When"], ["Wallet"], ["What"], ["Points", 1]], recent, "No points have moved yet. Activity appears here as soon as an app sends its first reward event and a rule is switched on.")}</div>
      <div class="rw-card"><h2>Demo data</h2>
        ${demoCount ? `<p class="rw-lead">There is demo data in the system, clearly marked and kept apart from real data:
            ${num(d.apps)} demo app(s), ${num(d.rules)} rule(s), ${num(d.brands)} brand(s), ${num(d.accounts)} wallet(s), ${num(d.events)} event(s).</p>
          <div class="rw-actions"><button type="button" class="rw-btn warn" data-act="purge-demo">Clear demo data</button></div>
          <p class="rw-hint">Removes only items marked as demo. Real wallets, points and history are never touched.</p>`
          : `<p class="rw-empty">There is no demo data. Everything you see is real.</p>`}
        <p class="rw-msg" id="demoOut" role="status" aria-live="polite"></p></div>`;
  }

  // ------------------------------------------------------------------ rules
  function ruleRow(r, editable) {
    const where = r.scope === "campaign" ? "Campaign: " + (r.campaign || "") + (r.brand ? " (" + r.brand + ")" : "")
      : r.scope === "application" ? appName(r.app_id) : r.scope === "brand" ? "Brand: " + (r.brand || "") : "Every app";
    return `<div class="rw-rule"><div class="t"><strong>${esc(r.name)}</strong> ${r.active ? '<span class="rw-pill ok">On</span>' : '<span class="rw-pill">Off</span>'}${R.demoPill(r.is_demo)}
        <span class="rw-sub">${esc(where)} · ${esc(R.describeRule(r))}</span>
        <span class="rw-sub">Order ${num(r.priority)} · version ${num(r.version)} · given so far: ${num(r.awarded)}${r.last_awarded_at ? " · last " + esc(R.dateTime(r.last_awarded_at)) : ""}</span></div>
      <div class="rw-pills">
        <button type="button" class="rw-btn small ghost" data-act="toggle-rule" data-key="${esc(r.rule_key)}" data-on="${r.active ? "0" : "1"}">${r.active ? "Switch off" : "Switch on"}</button>
        ${editable ? `<button type="button" class="rw-btn small ghost" data-act="edit-rule" data-key="${esc(r.rule_key)}">Edit</button>` : ""}</div></div>`;
  }
  function rulesHtml() {
    const all = rulesData.rules || [];
    const platform = all.filter((r) => !r.campaign_id), camp = all.filter((r) => r.campaign_id);
    const appOpts = (rulesData.apps || []).map((a) => `<option value="${esc(a.app_id)}">${esc(a.name)}${a.is_demo ? " (demo)" : ""}</option>`).join("");
    return `${superOnly()}
      <div class="rw-card"><div class="rw-item-head"><h2>Platform rules</h2><button type="button" class="rw-btn small" data-act="new-rule">New rule</button></div>
        <p class="rw-lead">These apply across the apps, whatever the brand. A rule that is off awards nothing. Rules run in order, lowest number first.</p>
        <div id="ruleFormBox"></div><p class="rw-msg" id="ruleOut" role="status" aria-live="polite"></p>
        ${platform.length ? platform.map((r) => ruleRow(r, true)).join("")
          : `<p class="rw-empty">There are no platform rules yet, so events from the apps are recorded but earn nothing. Press “New rule” to add the first one.</p>`}</div>
      <div class="rw-card"><h2>Campaign rules</h2>
        <p class="rw-lead">Written by brands inside their campaigns. You can switch one off here if needed; brands edit them in the Brand console.</p>
        ${camp.length ? camp.map((r) => ruleRow(r, false)).join("") : `<p class="rw-empty">No brand has written a campaign rule yet.</p>`}</div>
      <div class="rw-card"><h2>Test an event</h2>
        <p class="rw-lead">See exactly what an example event would earn, rule by rule. Nothing is awarded by a test.</p>
        <form class="rw-form" id="adminDry" novalidate>
          <div class="rw-row3"><div><label for="adApp">App</label><select id="adApp">${appOpts}</select></div>
            <div><label for="adEvent">Event</label><select id="adEvent">${R.KNOWN_EVENTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>
            <div><label for="adAmount">Amount</label><input id="adAmount" type="text" inputmode="decimal" maxlength="14" placeholder="For example 15000"></div></div>
          <label class="rw-check"><input type="checkbox" id="adOff"> <span>Include rules that are switched off, to preview them before switching on</span></label>
          <div class="rw-actions"><button class="rw-btn ghost" type="submit" id="adBtn">Run test</button></div>
          <p class="rw-msg" id="adOut" role="status" aria-live="polite"></p><div id="adRes"></div></form></div>`;
  }
  function openRuleForm(rule) {
    const box = $("#ruleFormBox", rootEl);
    box.innerHTML = `<div class="rw-item"><h3>${rule ? "Edit rule" : "New platform rule"}</h3>
      <p class="rw-hint">Saving a change keeps the old version on record, so past awards always show the rule as it was.</p>
      ${R.ruleFormHtml({ admin: true, apps: rulesData.apps, brands: rulesData.brands, idPrefix: "arf" })}</div>`;
    const form = $("#arfForm", box);
    R.bindRuleForm(form);
    R.fillRuleForm(form, rule || null);
    $("[data-role='cancel']", form).addEventListener("click", () => { box.innerHTML = ""; });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const out = $("[data-role='msg']", form);
      let payload;
      try { payload = R.readRuleForm(form); } catch (e) { return say(out, R.errText(e), "bad"); }
      const r = await R.withBusy($("[data-role='save']", form), out, "Saving…", () => R.call("admin.rule.save", payload));
      if (r) { await show("rules"); say($("#ruleOut", rootEl), "Rule saved" + (r.active ? " and switched on." : ". It is off until you switch it on."), "ok"); }
    });
    form.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------------ approvals
  function approvalsHtml() {
    const list = ov.pending_campaigns || [];
    return `${superOnly()}<div class="rw-card"><h2>Campaigns waiting for approval</h2>
      <p class="rw-lead">A brand's campaign awards nothing until you approve it. Check the budget, the apps and the dates.</p>
      <p class="rw-msg" id="apprOut" role="status" aria-live="polite"></p>
      ${list.length ? list.map((c) => `<div class="rw-item"><div class="rw-item-head"><h3>${esc(c.name)}${R.demoPill(c.is_demo)}</h3><span class="rw-pill warn">${esc(c.brand)}</span></div>
          ${c.description ? `<p class="rw-meta">${esc(c.description)}</p>` : ""}
          <p class="rw-meta">Budget: ${pts(c.budget_points)} (${num(c.spent_points)} already given) · apps: ${esc((c.applications || []).map(appName).join(", "))} · ${num(c.rules)} rule(s)
            · ${c.starts_at ? "from " + esc(R.dateOnly(c.starts_at)) : "starts when approved"}${c.ends_at ? " until " + esc(R.dateOnly(c.ends_at)) : ""}</p>
          <div class="rw-form"><label for="note-${esc(c.id)}">Note to the brand (optional)</label><input id="note-${esc(c.id)}" type="text" maxlength="500"></div>
          <div class="rw-actions"><button type="button" class="rw-btn small" data-act="decide" data-d="approve" data-id="${esc(c.id)}">Approve</button>
            <button type="button" class="rw-btn small warn" data-act="decide" data-d="reject" data-id="${esc(c.id)}">Do not approve</button></div></div>`).join("")
        : `<p class="rw-empty">Nothing is waiting. When a brand sends a campaign for approval it appears here.</p>`}</div>`;
  }

  // ------------------------------------------------------------------ brands
  function brandsHtml() {
    const list = brandsData.brands || [];
    const appOpts = (ov.apps || []).map((a) => `<option value="${esc(a.app_id)}">${esc(a.name)}</option>`).join("");
    return `${superOnly()}
      <div class="rw-card"><h2>Add a brand</h2>
        <form class="rw-form" id="brandNew" novalidate><label for="bnName">Brand name</label><input id="bnName" type="text" maxlength="80">
          <div class="rw-actions"><button class="rw-btn" type="submit" id="bnBtn">Add brand</button></div><p class="rw-msg" id="bnOut" role="status" aria-live="polite"></p></form></div>
      <div class="rw-card"><h2>Brands</h2><p class="rw-msg" id="brandOut" role="status" aria-live="polite"></p>
      ${list.length ? list.map((b) => `<div class="rw-item"><div class="rw-item-head"><h3>${esc(b.name)}${R.demoPill(b.is_demo)}</h3>${R.statusPill(b.status)}</div>
          <p class="rw-meta">${num(b.campaigns)} campaign(s)</p>
          <h3>People who manage it</h3>
          ${(b.members || []).length ? b.members.map((m) => `<div class="rw-rule"><div class="t">${esc(m.email)} <span class="rw-pill">${esc(m.role)}</span></div>
              <button type="button" class="rw-btn small warn" data-act="member-remove" data-id="${esc(b.id)}" data-user="${esc(m.user_id)}">Remove</button></div>`).join("")
            : `<p class="rw-empty">Nobody manages this brand yet. Add the person's email below. They need a ZonicMe account with that email first.</p>`}
          <form class="rw-form" data-form="member" data-id="${esc(b.id)}" novalidate><div class="rw-row"><div><label>Email address<input name="email" type="email" inputmode="email" autocapitalize="none" maxlength="200"></label></div>
            <div><label>Role<select name="role"><option value="manager">Manager</option><option value="owner">Owner</option></select></label></div></div>
            <div class="rw-actions"><button class="rw-btn small" type="submit">Give access</button></div></form>
          <h3>How this brand is known inside each app</h3>
          <p class="rw-hint">Only needed for platform rules aimed at one brand. Enter the brand's ID exactly as the app sends it.</p>
          ${(b.links || []).map((k) => `<div class="rw-rule"><div class="t">${esc(appName(k.app_id))}: ${esc(k.external_brand_id)}</div>
              <button type="button" class="rw-btn small ghost" data-act="link-remove" data-id="${esc(b.id)}" data-app="${esc(k.app_id)}" data-ext="${esc(k.external_brand_id)}">Remove</button></div>`).join("")}
          <form class="rw-form" data-form="link" data-id="${esc(b.id)}" novalidate><div class="rw-row"><div><label>App<select name="app_id">${appOpts}</select></label></div>
            <div><label>Brand ID in that app<input name="ext" type="text" maxlength="120" autocapitalize="none"></label></div></div>
            <div class="rw-actions"><button class="rw-btn small ghost" type="submit">Add link</button>
              <button type="button" class="rw-btn small ${b.status === "active" ? "warn" : ""}" data-act="brand-status" data-id="${esc(b.id)}" data-to="${b.status === "active" ? "suspended" : "active"}">${b.status === "active" ? "Suspend brand" : "Make brand active again"}</button></div></form>
        </div>`).join("") : `<p class="rw-empty">No brands yet. Add one above, then give a person access so they can use the Brand console.</p>`}</div>`;
  }
  async function saveBrand(b, changes, btn) {
    const args = Object.assign({ id: b.id, name: b.name, status: b.status }, changes);
    const r = await R.withBusy(btn, $("#brandOut", rootEl), "Saving…", () => R.call("admin.brand.save", args));
    if (r) { await show("brands"); say($("#brandOut", rootEl), "Brand updated.", "ok"); }
  }

  // ------------------------------------------------------------------ accounts
  function accountHtml(a) {
    if (!a) return "";
    if (!a.found) return `<p class="rw-empty">No wallet exists for that email address yet. A wallet is created the first time an app reports activity for it, or when you add points to it below.</p>`;
    const acc = a.account;
    const rows = (a.ledger || []).map((l) => `<tr><td>${esc(R.dateTime(l.created_at))}</td><td>${esc(l.tx_type.replace("_", " "))}${l.bucket === "gift_credit" ? " (gift credit)" : ""}
        <span class="rw-sub">${esc([appName(l.source_app), l.rule, l.campaign, l.reason].filter(Boolean).join(" · "))}</span></td>
        <td class="n"><span class="${l.amount >= 0 ? "rw-plus" : "rw-minus"}">${l.amount >= 0 ? "+" : "−"}${num(Math.abs(l.amount))}</span></td><td class="n">${num(l.balance_after)}</td></tr>`);
    return `<div class="rw-item"><div class="rw-item-head"><h3>${esc(a.label)}${R.demoPill(acc.is_demo)}</h3>${R.statusPill(acc.status)}</div>
      <p class="rw-meta">Points: ${num(acc.points_balance)} · gift credit: ${num(acc.gift_credit_balance)} · earned so far: ${num(acc.lifetime_earned)} · redeemed: ${num(acc.lifetime_redeemed)}
        · ${a.claimed ? "opened by its owner" : "not opened by its owner yet"} · apps: ${esc((acc.linked_applications || []).map(appName).join(", ") || "none yet")}</p>
      <form class="rw-form" id="holdForm" novalidate><label for="holdReason">Reason (kept in the audit log)</label><input id="holdReason" type="text" maxlength="500">
        <div class="rw-actions"><button class="rw-btn small ${acc.status === "active" ? "warn" : ""}" type="submit" id="holdBtn" data-to="${acc.status === "active" ? "frozen" : "active"}">${acc.status === "active" ? "Put this wallet on hold" : "Release this wallet"}</button></div>
        <p class="rw-msg" id="holdOut" role="status" aria-live="polite"></p></form>
      <h3>Latest history</h3>${table([["When"], ["What"], ["Points", 1], ["Balance", 1]], rows, "This wallet has no history yet.")}</div>`;
  }
  function accountsHtml() {
    return `${superOnly()}
      <div class="rw-card"><h2>Find a wallet</h2>
        <form class="rw-form" id="findForm" novalidate><label for="findEmail">Person's email address</label>
          <input id="findEmail" type="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="200">
          <div class="rw-actions"><button class="rw-btn" type="submit" id="findBtn">Find</button></div><p class="rw-msg" id="findOut" role="status" aria-live="polite"></p></form>
        <div id="findRes">${accountHtml(foundAccount)}</div></div>
      <div class="rw-card"><h2>Adjust a balance</h2>
        <p class="rw-lead">Add or take away points by hand, for example to fix a mistake. Every adjustment is written to the wallet's history and to the audit log with your name and reason. It cannot be edited afterwards; to undo one, make the opposite adjustment.</p>
        <form class="rw-form" id="adjForm" novalidate>
          <label for="adjEmail">Person's email address</label><input id="adjEmail" type="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="200">
          <div class="rw-row"><div><label for="adjDelta">Points to add (use a minus sign to take away)</label><input id="adjDelta" type="text" inputmode="text" maxlength="10" placeholder="500 or -500"></div>
            <div><label for="adjBucket">Which balance</label><select id="adjBucket"><option value="points">Earned points</option><option value="gift_credit">Gift credit</option></select></div></div>
          <label for="adjReason">Reason</label><input id="adjReason" type="text" maxlength="500" placeholder="At least 5 characters">
          <div class="rw-actions"><button class="rw-btn" type="submit" id="adjBtn">Make adjustment</button></div>
          <p class="rw-msg" id="adjOut" role="status" aria-live="polite"></p></form></div>`;
  }

  // ------------------------------------------------------------------ monitoring
  function monitorHtml(v) {
    const hot = (v.hot_accounts || []).map((h) => `<tr><td>${esc(h.account)}</td><td>${esc(R.dateTime(h.hour))}</td><td class="n">${num(h.earns)}</td><td class="n">${num(h.points)}</td><td>${R.statusPill(h.status)}</td></tr>`);
    const top = (v.top_earners || []).map((h) => `<tr><td>${esc(h.account)}</td><td class="n">${num(h.earns)}</td><td class="n">${num(h.points)}</td></tr>`);
    const gift = (v.heavy_gifters || []).map((h) => `<tr><td>${esc(h.account)}</td><td class="n">${num(h.gifts)}</td><td class="n">${num(h.points)}</td><td class="n">${num(h.recipients)}</td></tr>`);
    const REJ = { identity_unverified: "the app could not confirm the person's email", account_not_active: "the wallet is on hold", demo_mismatch: "demo and real data were mixed", app_not_active: "the app is paused" };
    const rej = Object.keys(v.rejected_events || {}).map((k) => `<tr><td>${esc(REJ[k] || k)}</td><td class="n">${num(v.rejected_events[k])}</td></tr>`);
    const INT = { bad_signature: "wrong signature", unsigned: "no signature", stale_timestamp: "request too old", invalid_payload: "badly formed request", rejected: "event not accepted" };
    const intake = (v.intake_problems || []).map((i) => `<tr><td>${esc(i.app_id === "(unknown)" ? "Unknown sender" : appName(i.app_id))}</td><td>${esc(INT[String(i.outcome).replace(/^api_/, "")] || i.outcome)}</td><td class="n">${num(i.hits)}</td><td>${esc(R.dateTime(i.last_at))}</td></tr>`);
    return `<div class="rw-card rw-form"><label for="monHours">Look back over</label>
        <select id="monHours">${[[24, "the last 24 hours"], [72, "the last 3 days"], [168, "the last 7 days"]].map(([h, l]) => `<option value="${h}"${Number(v.hours) === h ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="rw-card"><h2>Unusually busy wallets</h2><p class="rw-lead">Wallets that earned ${num(v.threshold)} or more times within one hour. A real person rarely does that; it can mean an app is sending repeats or someone is gaming a rule. You can put a wallet on hold under Accounts.</p>
        ${table([["Wallet"], ["Hour"], ["Times", 1], ["Points", 1], ["Status"]], hot, "Nothing unusual. No wallet earned that often in the period.")}</div>
      <div class="rw-two"><div class="rw-card"><h2>Top earners</h2>${table([["Wallet"], ["Times", 1], ["Points", 1]], top, "Nobody has earned points in this period.")}</div>
        <div class="rw-card"><h2>Frequent gifters</h2>${table([["Wallet"], ["Gifts", 1], ["Points", 1], ["People", 1]], gift, "Nobody sent five or more gifts in this period.")}</div></div>
      <div class="rw-two"><div class="rw-card"><h2>Events that earned nothing</h2>${table([["Why"], ["Events", 1]], rej, "No events were turned away in this period.")}</div>
        <div class="rw-card"><h2>Requests refused at the door</h2><p class="rw-hint">Requests to the event intake that were not accepted. A few are normal; a burst can mean someone is probing it. Nothing is ever awarded from a refused request.</p>
          ${table([["From"], ["Problem"], ["Count", 1], ["Last seen"]], intake, "No requests were refused in this period.")}</div></div>`;
  }

  // ------------------------------------------------------------------ settings / apps / audit
  function settingsHtml() {
    const s = ov.settings, dis = ov.is_super ? "" : " disabled";
    return `${superOnly()}<div class="rw-card"><h2>Platform settings</h2>
      <form class="rw-form" id="setForm" novalidate>
        <h3>Value and redemption</h3>
        <div class="rw-row"><div><label for="stValue">What one point is worth, in the smallest unit (kobo)</label><input id="stValue" type="text" inputmode="numeric" maxlength="9" value="${esc(s.point_value_minor == null ? "" : s.point_value_minor)}" placeholder="Not set"${dis}></div>
          <div><label for="stCur">Currency</label><input id="stCur" type="text" maxlength="3" autocapitalize="characters" value="${esc(s.value_currency)}"${dis}></div></div>
        <p class="rw-hint">Example: enter 100 to make one point worth ₦1.00. Leave it empty and points have no cash value.</p>
        <label class="rw-check"><input type="checkbox" id="stRedeem"${s.redemption_enabled ? " checked" : ""}${dis}> <span><strong>Let people redeem points.</strong> Needs a point value first. Redeeming creates a code an app can check; no money is moved by ZonicMe.</span></label>
        <label for="stMin">Smallest redemption (points)</label><input id="stMin" type="text" inputmode="numeric" maxlength="9" value="${esc(s.min_redeem_points)}"${dis}>
        <h3>Gifting</h3>
        <label class="rw-check"><input type="checkbox" id="stGift"${s.gifting_enabled ? " checked" : ""}${dis}> <span>Let people send points to each other</span></label>
        <label for="stGiftLimit">Most points one person can gift in a day</label><input id="stGiftLimit" type="text" inputmode="numeric" maxlength="9" value="${esc(s.gift_daily_limit_points)}"${dis}>
        <h3>Safety</h3>
        <label class="rw-check"><input type="checkbox" id="stVerified"${s.require_verified_identity ? " checked" : ""}${dis}> <span>Only award when the app confirms the person's email address is verified (recommended)</span></label>
        <div class="rw-row"><div><label for="stCap">Most points one wallet can earn in a day</label><input id="stCap" type="text" inputmode="numeric" maxlength="9" value="${esc(s.account_daily_earn_cap == null ? "" : s.account_daily_earn_cap)}" placeholder="No ceiling"${dis}></div>
          <div><label for="stVel">Flag a wallet that earns this many times in an hour</label><input id="stVel" type="text" inputmode="numeric" maxlength="6" value="${esc(s.velocity_earns_per_hour)}"${dis}></div></div>
        <div class="rw-actions"><button class="rw-btn" type="submit" id="setBtn"${dis}>Save settings</button></div>
        <p class="rw-msg" id="setOut" role="status" aria-live="polite"></p></form></div>`;
  }
  function appsHtml() {
    const rows = (ov.apps || []).map((a) => {
      const k = a.key, bad = Object.keys(a.intake_24h || {}).filter((o) => o !== "accepted" && o !== "duplicate").reduce((n, o) => n + Number(a.intake_24h[o]), 0);
      return `<div class="rw-item"><div class="rw-item-head"><h3>${esc(a.name)}${R.demoPill(a.is_demo)}</h3>${R.statusPill(a.status)}</div>
        <p class="rw-meta">Connection: ${k ? (k.status === "active" ? `set up (check code ${esc(k.fingerprint || "")})${k.last_used_at ? ", last used " + esc(R.dateTime(k.last_used_at)) : ", not used yet"}` : "being set up") : "not connected yet, so this app cannot send events"}</p>
        <p class="rw-meta">Events: ${num(a.events_total)} in total, ${num(a.events_24h)} in the last 24 hours${a.last_event_at ? ", latest " + esc(R.dateTime(a.last_event_at)) : ""} · points given: ${num(a.earned)} · redeemed here: ${num(a.redeemed)}${bad ? " · " + num(bad) + " request(s) refused today" : ""}</p>
        <div class="rw-pills" style="margin-top:10px">
          ${a.status !== "active" ? `<button type="button" class="rw-btn small" data-act="app-status" data-id="${esc(a.app_id)}" data-to="active">Start accepting events</button>` : `<button type="button" class="rw-btn small ghost" data-act="app-status" data-id="${esc(a.app_id)}" data-to="paused">Pause</button>`}
          ${k ? `<button type="button" class="rw-btn small warn" data-act="key-off" data-id="${esc(a.app_id)}">Disconnect</button>` : ""}</div></div>`;
    }).join("");
    return `${superOnly()}<div class="rw-card"><h2>Apps that send reward events</h2>
      <p class="rw-lead">Each app proves who it is with its own private key, which is set up by your developer and is never shown anywhere. “Pause” stops an app's events earning points without disconnecting it. “Disconnect” switches its key off at once; your developer must set up a new one before it can send again.</p>
      <p class="rw-msg" id="appOut" role="status" aria-live="polite"></p>${rows}</div>
      <div class="rw-card"><h2>Add a future app</h2>
        <form class="rw-form" id="appNew" novalidate><div class="rw-row"><div><label for="anId">Short ID (lower-case, no spaces)</label><input id="anId" type="text" maxlength="40" autocapitalize="none" spellcheck="false" placeholder="for example owanbe"></div>
          <div><label for="anName">Name</label><input id="anName" type="text" maxlength="60"></div></div>
          <div class="rw-actions"><button class="rw-btn ghost" type="submit" id="anBtn">Add as planned</button></div><p class="rw-msg" id="anOut" role="status" aria-live="polite"></p></form></div>`;
  }
  function auditHtml(a) {
    const rows = (a.items || []).map((i) => {
      const d = i.detail || {}, bits = [];
      ["name", "account", "brand", "delta", "reason", "status", "points", "recipient", "note"].forEach((k) => { if (d[k] != null && typeof d[k] !== "object") bits.push(k + ": " + d[k]); });
      return `<tr><td>${esc(R.dateTime(i.created_at))}</td><td>${esc(i.actor_label || "system")}</td><td>${esc(String(i.action).replace(/[._]/g, " "))}<span class="rw-sub">${esc(bits.join(" · "))}</span></td></tr>`;
    });
    return `<div class="rw-card"><h2>Audit log</h2><p class="rw-lead">Every change made through these consoles, newest first: who did it, when and what. Entries cannot be edited or removed by anyone.</p>
      ${table([["When"], ["Who"], ["What"]], rows, "Nothing has been changed yet.")}</div>`;
  }

  const GUIDE = `<div class="rw-card rw-guide"><h2>How ZonicMe Rewards works, in plain words</h2>
    <p>ZonicMe keeps one points wallet for each person, matched by their email address, across all the apps. The apps never hand out points themselves. They only tell ZonicMe what happened (“this person paid for an order of ₦15,000”), and the rules you set here decide what that earns.</p>
    <h3>What is switched on today</h3>
    <ul><li><strong>Redemption is off and points have no cash value</strong> until you set both under Settings. Until then people can collect and gift points but not spend them.</li>
      <li><strong>Starter rules are saved but switched off.</strong> Nothing is awarded until you switch a rule on under Rules.</li>
      <li>Points can only be created by an event from an app, a brand gift from an approved campaign budget, or an adjustment you make by hand. Nothing in a web browser can create points.</li></ul>
    <h3>The three screens</h3>
    <ul><li><strong>My wallet</strong> (Rewards in the site menu) is what every member sees: their balance, history, offers, gifting and, once you open it, redeeming.</li>
      <li><strong>Brand console</strong> is for brand partners you give access to. They plan campaigns with a points budget, write rules, test them, send gifts and see results. They see only their own brand.</li>
      <li><strong>Admin console</strong> (this page) is for you and your admins.</li></ul>
    <h3>What each tab here is for</h3>
    <ul><li><strong>Overview</strong>: totals, the ledger check, latest activity and any demo data.</li>
      <li><strong>Rules</strong>: the platform-wide rules. Switch them on or off, edit them, and use “Test an event” to see what an example purchase would earn before anything goes live.</li>
      <li><strong>Approvals</strong>: brand campaigns wait here. A campaign awards nothing until you approve it.</li>
      <li><strong>Brands</strong>: add a brand and choose who may manage it.</li>
      <li><strong>Accounts</strong>: look up a person's wallet, put it on hold, or add or take away points with a reason.</li>
      <li><strong>Monitoring</strong>: wallets earning suspiciously fast, heavy gifting, and requests that were refused.</li>
      <li><strong>Settings</strong>: point value, redemption, gifting limits and safety limits.</li>
      <li><strong>Apps</strong>: which apps are connected and sending events, with pause and disconnect.</li>
      <li><strong>Audit log</strong>: a permanent record of every change made here.</li></ul>
    <h3>A sensible way to start</h3>
    <ol><li>Open <strong>Rules</strong>, run “Test an event” with “Include rules that are switched off” ticked, and check the starter rules give what you expect.</li>
      <li>Switch on the rules you are happy with. From then on real purchases and reviews earn points.</li>
      <li>Watch <strong>Overview</strong> and <strong>Monitoring</strong> for a few days.</li>
      <li>When you are ready for people to spend points, set the point value under <strong>Settings</strong>, then switch redemption on.</li></ol>
    <h3>Things worth knowing</h3>
    <ul><li>The history of every wallet is permanent. Nobody, including an admin, can edit or remove an entry; mistakes are fixed with a new adjustment.</li>
      <li>A campaign can never give out more than its budget, and nobody can gift or redeem more than they hold.</li>
      <li>The same event sent twice by an app only counts once.</li>
      <li>Only the owner and super admins can change anything here. Other admins can look.</li></ul></div>`;

  // ------------------------------------------------------------------ drawing and events
  function tabsHtml() {
    const n = (ov.pending_campaigns || []).length;
    return `<div class="rw-section-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === tab}" class="${id === tab ? "is-on" : ""}" data-tab="${id}">${label}${id === "approvals" && n ? `<span class="rw-count">${n}</span>` : ""}</button>`).join("")}</div><div id="adminBody"></div>`;
  }
  async function show(which) {
    tab = which || tab;
    ov = await R.call("admin.overview");
    rootEl.innerHTML = tabsHtml();
    const body = $("#adminBody", rootEl);
    if (tab === "overview") body.innerHTML = overviewHtml();
    else if (tab === "guide") body.innerHTML = GUIDE;
    else if (tab === "rules") { rulesData = await R.call("admin.rules"); body.innerHTML = rulesHtml(); }
    else if (tab === "approvals") body.innerHTML = approvalsHtml();
    else if (tab === "brands") { brandsData = await R.call("admin.brands"); body.innerHTML = brandsHtml(); }
    else if (tab === "accounts") body.innerHTML = accountsHtml();
    else if (tab === "monitor") body.innerHTML = monitorHtml(await R.call("admin.velocity", { hours: 24 }));
    else if (tab === "settings") body.innerHTML = settingsHtml();
    else if (tab === "apps") body.innerHTML = appsHtml();
    else if (tab === "audit") body.innerHTML = auditHtml(await R.call("admin.audit", { limit: 100 }));
  }
  async function safeShow(which) {
    try { await show(which); }
    catch (e) { const b = $("#adminBody", rootEl) || rootEl; b.innerHTML = `<div class="rw-note"><strong>This could not be loaded.</strong> ${esc(R.errText(e))}</div>`; }
  }

  async function onClick(ev) {
    const tb = ev.target.closest("[data-tab]");
    if (tb && rootEl.contains(tb)) return safeShow(tb.getAttribute("data-tab"));
    const t = ev.target.closest("[data-act]");
    if (!t || !rootEl.contains(t)) return;
    const act = t.getAttribute("data-act"), id = t.getAttribute("data-id");
    if (act === "new-rule") return openRuleForm(null);
    if (act === "edit-rule") return openRuleForm((rulesData.rules || []).find((r) => r.rule_key === t.getAttribute("data-key")));
    if (act === "toggle-rule") {
      const r = await R.withBusy(t, $("#ruleOut", rootEl), "Working…", () => R.call("admin.rule.active", { rule_key: t.getAttribute("data-key"), active: t.getAttribute("data-on") === "1" }));
      if (r) { await show("rules"); say($("#ruleOut", rootEl), r.active ? "Rule switched on." : "Rule switched off.", "ok"); }
    } else if (act === "decide") {
      const d = t.getAttribute("data-d"), note = ($("#note-" + id, rootEl) || {}).value || "";
      const r = await R.withBusy(t, $("#apprOut", rootEl), "Working…", () => R.call("admin.campaign.decide", { campaign_id: id, decision: d, note }));
      if (r) { await show("approvals"); say($("#apprOut", rootEl), d === "approve" ? "Approved. The campaign is now running." : "Not approved. The brand has been told why.", "ok"); }
    } else if (act === "purge-demo") {
      if (!window.confirm("Clear all demo data? Real wallets, points and history are not touched.")) return;
      const r = await R.withBusy(t, $("#demoOut", rootEl), "Clearing…", () => R.call("admin.purge_demo"));
      if (r) { await show("overview"); say($("#demoOut", rootEl), "Demo data cleared.", "ok"); }
    } else if (act === "member-remove") {
      if (!window.confirm("Remove this person's access to the brand?")) return;
      const r = await R.withBusy(t, $("#brandOut", rootEl), "Working…", () => R.call("admin.brand.member", { brand_id: id, user_id: t.getAttribute("data-user"), remove: true }));
      if (r) { await show("brands"); say($("#brandOut", rootEl), "Access removed.", "ok"); }
    } else if (act === "link-remove" || act === "brand-status") {
      const b = (brandsData.brands || []).find((x) => x.id === id);
      if (!b) return;
      if (act === "brand-status") return saveBrand(b, { status: t.getAttribute("data-to") }, t);
      return saveBrand(b, { links: (b.links || []).filter((k) => !(k.app_id === t.getAttribute("data-app") && k.external_brand_id === t.getAttribute("data-ext"))) }, t);
    } else if (act === "app-status") {
      const r = await R.withBusy(t, $("#appOut", rootEl), "Working…", () => R.call("admin.app.save", { app_id: id, status: t.getAttribute("data-to") }));
      if (r) { await show("apps"); say($("#appOut", rootEl), "App updated.", "ok"); }
    } else if (act === "key-off") {
      if (!window.confirm("Disconnect this app? Its events will be refused until your developer sets up a new key.")) return;
      const r = await R.withBusy(t, $("#appOut", rootEl), "Working…", () => R.call("admin.key.disable", { app_id: id }));
      if (r) { await show("apps"); say($("#appOut", rootEl), "App disconnected.", "ok"); }
    }
  }

  function intOrNull(v) { const t = String(v || "").trim().replace(/,/g, ""); return t === "" ? null : t; }

  async function onSubmit(ev) {
    const form = ev.target, fid = form.id || form.getAttribute("data-form");
    if (["adminDry", "brandNew", "member", "link", "findForm", "holdForm", "adjForm", "setForm", "appNew"].indexOf(fid) < 0) return;
    ev.preventDefault();
    if (fid === "adminDry") {
      const out = $("#adOut", form), amount = $("#adAmount", form).value.trim().replace(/,/g, "");
      if (amount && !/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(amount)) return say(out, "Enter the amount as a number, for example 15000.", "bad");
      $("#adRes", form).innerHTML = "";
      const appId = $("#adApp", form).value, app = (rulesData.apps || []).find((a) => a.app_id === appId);
      const off = $("#adOff", form).checked ? (rulesData.rules || []).filter((r) => !r.active && !r.campaign_id).map((r) => r.rule_key) : [];
      const r = await R.withBusy($("#adBtn", form), out, "Testing…", () => R.call("admin.dry_run",
        { app_id: appId, event_type: $("#adEvent", form).value, amount, assume_rules: off, is_demo: !!(app && app.is_demo) }));
      if (r) {
        $("#adRes", form).innerHTML = r.status === "accepted" ? R.dryRunHtml(r.points_awarded, r.gift_credit_awarded, r.trace)
          : `<p class="rw-empty">This event would not be accepted at the moment, so it would earn nothing.</p>`;
      }
    } else if (fid === "brandNew") {
      const name = $("#bnName", form).value.trim();
      if (name.length < 2) return say($("#bnOut", form), "Give the brand a name.", "bad");
      const r = await R.withBusy($("#bnBtn", form), $("#bnOut", form), "Adding…", () => R.call("admin.brand.save", { name }));
      if (r) { await show("brands"); say($("#brandOut", rootEl), "Brand added. Now give someone access to manage it.", "ok"); }
    } else if (fid === "member") {
      const email = form.elements.email.value.trim();
      if (!email || email.indexOf("@") < 1) return say($("#brandOut", rootEl), "Enter the person's email address.", "bad");
      const r = await R.withBusy($("button[type='submit']", form), $("#brandOut", rootEl), "Working…", () => R.call("admin.brand.member", { brand_id: form.getAttribute("data-id"), email, role: form.elements.role.value }));
      if (r) { await show("brands"); say($("#brandOut", rootEl), "Access given.", "ok"); }
    } else if (fid === "link") {
      const b = (brandsData.brands || []).find((x) => x.id === form.getAttribute("data-id")), ext = form.elements.ext.value.trim();
      if (!b) return;
      if (!ext) return say($("#brandOut", rootEl), "Enter the brand's ID in that app.", "bad");
      await saveBrand(b, { links: (b.links || []).concat([{ app_id: form.elements.app_id.value, external_brand_id: ext }]) }, $("button[type='submit']", form));
    } else if (fid === "findForm") {
      const email = $("#findEmail", form).value.trim();
      if (!email || email.indexOf("@") < 1) return say($("#findOut", form), "Enter the person's email address.", "bad");
      const r = await R.withBusy($("#findBtn", form), $("#findOut", form), "Looking…", () => R.call("admin.account.find", { email }));
      if (r) { foundAccount = r; $("#findRes", rootEl).innerHTML = accountHtml(r); }
    } else if (fid === "holdForm") {
      if (!foundAccount || !foundAccount.found) return;
      const reason = $("#holdReason", form).value.trim(), btn = $("#holdBtn", form);
      if (reason.length < 5) return say($("#holdOut", form), "Give a reason of at least 5 characters. It is kept in the audit log.", "bad");
      const r = await R.withBusy(btn, $("#holdOut", form), "Working…", () => R.call("admin.account.status", { account_id: foundAccount.account.id, status: btn.getAttribute("data-to"), reason }));
      if (r) { foundAccount = await R.call("admin.account.find", { account_id: foundAccount.account.id }); $("#findRes", rootEl).innerHTML = accountHtml(foundAccount); }
    } else if (fid === "adjForm") {
      const out = $("#adjOut", form), email = $("#adjEmail", form).value.trim(), delta = $("#adjDelta", form).value.trim().replace(/,/g, "").replace(/^\+/, "").replace(/^−/, "-"), reason = $("#adjReason", form).value.trim();
      if (!email || email.indexOf("@") < 1) return say(out, "Enter the person's email address.", "bad");
      if (!/^-?[0-9]{1,9}$/.test(delta) || Number(delta) === 0) return say(out, "Enter the adjustment as a whole number of points, for example 500 or -500.", "bad");
      if (reason.length < 5) return say(out, "Give a reason of at least 5 characters. It is kept in the audit log.", "bad");
      if (!window.confirm((Number(delta) > 0 ? "Add " : "Take away ") + num(Math.abs(Number(delta))) + " points " + (Number(delta) > 0 ? "to " : "from ") + email + "?")) return;
      const r = await R.withBusy($("#adjBtn", form), out, "Working…", () => R.call("admin.adjust", { email, delta, bucket: $("#adjBucket", form).value, reason }));
      if (r) { say(out, "Done. " + (r.label || email) + " now has " + pts(r.account.points_balance) + " and " + num(r.account.gift_credit_balance) + " gift credit.", "ok"); form.reset(); }
    } else if (fid === "setForm") {
      const out = $("#setOut", form);
      const args = { point_value_minor: intOrNull($("#stValue", form).value), value_currency: $("#stCur", form).value.trim().toUpperCase(),
        redemption_enabled: $("#stRedeem", form).checked, min_redeem_points: intOrNull($("#stMin", form).value), gifting_enabled: $("#stGift", form).checked,
        gift_daily_limit_points: intOrNull($("#stGiftLimit", form).value), require_verified_identity: $("#stVerified", form).checked,
        account_daily_earn_cap: intOrNull($("#stCap", form).value), velocity_earns_per_hour: intOrNull($("#stVel", form).value) };
      if (args.redemption_enabled && !ov.settings.redemption_enabled && !window.confirm("Switch redemption on? People will be able to turn points into redemption codes straight away.")) return;
      const r = await R.withBusy($("#setBtn", form), out, "Saving…", () => R.call("admin.settings.save", args));
      if (r) { await show("settings"); say($("#setOut", rootEl), "Settings saved.", "ok"); }
    } else if (fid === "appNew") {
      const r = await R.withBusy($("#anBtn", form), $("#anOut", form), "Adding…", () => R.call("admin.app.save", { app_id: $("#anId", form).value.trim().toLowerCase(), name: $("#anName", form).value.trim(), status: "planned" }));
      if (r) { await show("apps"); say($("#appOut", rootEl), "App added as planned. Your developer connects it before it can send events.", "ok"); }
    }
  }

  async function onChange(ev) {
    if (ev.target && ev.target.id === "monHours") {
      try { $("#adminBody", rootEl).innerHTML = monitorHtml(await R.call("admin.velocity", { hours: Number(ev.target.value) })); }
      catch (e) { $("#adminBody", rootEl).insertAdjacentHTML("afterbegin", `<div class="rw-note">${esc(R.errText(e))}</div>`); }
    }
  }

  async function signedIn(root) {
    rootEl = root;
    const w = await R.call("wallet");
    R.setAccess({ is_admin: w.is_admin, brand_count: w.brand_count });
    if (!w.is_admin) {
      root.innerHTML = `<div class="rw-card"><h2>This area is for ZonicMe administrators</h2>
        <p class="rw-lead">The account you are signed in with does not have admin access. If you should have it, ask the owner to grant it from the ZonicMe admin page.</p>
        <p class="rw-lead">Your own points are in <a class="rw-link" href="wallet.html">your wallet</a>.</p></div>`;
      return;
    }
    if (!root.__rwBound) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("change", onChange); root.__rwBound = true; }
    const h = (window.location.hash || "").replace("#", "");
    await show(TABS.some((t) => t[0] === h) ? h : "overview");
  }

  R.boot({ page: "admin", signedOut, signedIn });
})();
