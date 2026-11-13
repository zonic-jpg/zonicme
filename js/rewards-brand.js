/** ZonicMe Rewards — Brand Console (brand-rewards.html). A brand only ever sees its own campaigns; the database decides that. */
(function () {
  "use strict";
  const R = window.ZonicRewards;
  const { esc, num, pts, $, $all, say } = R;
  let brands = [], brandId = null, ov = null, rootEl = null;

  async function signedOut(root) {
    root.innerHTML = `
      <div class="rw-steps">
        <div class="rw-step"><h3>Plan a campaign</h3><p>Choose the ZonicMe apps it runs in, set a points budget and the dates. A campaign can never give out more than its budget.</p></div>
        <div class="rw-step"><h3>Write the rules</h3><p>Say what earns a reward, for example points for every purchase above an amount. Test a rule before it goes live.</p></div>
        <div class="rw-step"><h3>See the results</h3><p>Follow points given by app, people reached and what is still held. You can also send a one-off gift to a customer.</p></div>
      </div>
      <div class="rw-two"><div id="rwGate"></div>
        <div class="rw-card"><h2>For ZonicMe brand partners</h2>
          <p class="rw-lead">Sign in with the ZonicMe account that was given access to your brand.</p>
          <p class="rw-lead">Not a partner yet? Write to partners@zonicme.com.ng and we will set your brand up.</p></div></div>`;
    R.mountGate($("#rwGate", root), { intro: "Sign in to manage your brand's reward campaigns." });
  }

  const appName = (id) => { const a = ((ov && ov.apps) || []).find((x) => x.app_id === id); return a ? a.name : id; };

  function campaignHtml(c) {
    const pct = c.budget_points > 0 ? Math.min(100, Math.round((c.spent_points / c.budget_points) * 100)) : 0;
    const b = [];
    if (c.status !== "ended") b.push(`<button type="button" class="rw-btn small ghost" data-act="edit-campaign" data-id="${esc(c.id)}">Edit</button>`);
    if (c.status === "draft" || c.status === "rejected") b.push(`<button type="button" class="rw-btn small" data-act="status" data-to="pending" data-id="${esc(c.id)}">Send for approval</button>`);
    if (c.status === "pending") b.push(`<button type="button" class="rw-btn small ghost" data-act="status" data-to="draft" data-id="${esc(c.id)}">Withdraw</button>`);
    if (c.status === "active") b.push(`<button type="button" class="rw-btn small ghost" data-act="status" data-to="paused" data-id="${esc(c.id)}">Pause</button>`);
    if (c.status === "paused" && c.approved_at) b.push(`<button type="button" class="rw-btn small" data-act="status" data-to="active" data-id="${esc(c.id)}">Resume</button>`);
    if (c.status !== "ended") b.push(`<button type="button" class="rw-btn small ghost" data-act="add-rule" data-id="${esc(c.id)}">Add a rule</button>`);
    if (c.status !== "ended") b.push(`<button type="button" class="rw-btn small warn" data-act="status" data-to="ended" data-id="${esc(c.id)}">End campaign</button>`);
    const rules = (c.rules || []).map((r) => `<div class="rw-rule"><div class="t"><strong>${esc(r.name)}</strong>
        ${r.active ? '<span class="rw-pill ok">On</span>' : '<span class="rw-pill">Off</span>'}
        <span class="rw-sub">${esc(R.describeRule(r))} · given so far: ${num(r.awarded)}</span></div>
        ${c.status === "ended" ? "" : `<div class="rw-pills">
          <button type="button" class="rw-btn small ghost" data-act="toggle-rule" data-key="${esc(r.rule_key)}" data-on="${r.active ? "0" : "1"}">${r.active ? "Switch off" : "Switch on"}</button>
          <button type="button" class="rw-btn small ghost" data-act="edit-rule" data-key="${esc(r.rule_key)}" data-id="${esc(c.id)}">Edit</button></div>`}</div>`).join("");
    const when = (c.starts_at ? "from " + R.dateOnly(c.starts_at) : "starts when approved") + (c.ends_at ? " until " + R.dateOnly(c.ends_at) : ", no end date");
    return `<div class="rw-item" id="camp-${esc(c.id)}">
      <div class="rw-item-head"><h3>${esc(c.name)}${R.demoPill(c.is_demo)}</h3>${R.statusPill(c.status)}</div>
      ${c.description ? `<p class="rw-meta">${esc(c.description)}</p>` : ""}
      <p class="rw-meta">Apps: ${esc((c.applications || []).map(appName).join(", "))} · ${esc(when)} · people reached: ${num(c.earners)}</p>
      ${c.decision_note ? `<p class="rw-meta"><strong>Note from ZonicMe:</strong> ${esc(c.decision_note)}</p>` : ""}
      ${c.status === "pending" ? `<p class="rw-meta">ZonicMe is reviewing this campaign. Nothing is awarded until it is approved.</p>` : ""}
      <div class="rw-bar" role="img" aria-label="${pct}% of the budget used"><span style="width:${pct}%"></span></div>
      <p class="rw-meta">${num(c.spent_points)} of ${num(c.budget_points)} points used (${pct}%)</p>
      <div class="rw-pills" style="margin-top:10px">${b.join("")}</div>
      <h3>Rules</h3>
      ${rules || `<p class="rw-empty">This campaign has no rules yet, so it will not award anything. Add a rule to say what earns a reward.</p>`}
    </div>`;
  }

  function paint() {
    const root = rootEl, s = ov.stats, b = ov.brand;
    const picker = brands.length > 1
      ? `<div class="rw-card rw-form"><label for="brandPick">Brand</label><select id="brandPick">${brands.map((x) => `<option value="${esc(x.id)}"${x.id === brandId ? " selected" : ""}>${esc(x.name)}${x.is_demo ? " (demo)" : ""}</option>`).join("")}</select></div>` : "";
    const running = (ov.campaigns || []).filter((c) => c.status === "active");
    const live = (ov.campaigns || []).filter((c) => c.status !== "ended");
    const byApp = (s.by_app || []).length
      ? `<div class="rw-scroll"><table class="rw-table"><thead><tr><th>App</th><th class="n">Points given</th><th class="n">Events</th><th class="n">People</th></tr></thead><tbody>
          ${s.by_app.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${num(r.earned)}</td><td class="n">${num(r.events)}</td><td class="n">${num(r.earners)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="rw-empty">No points have been given by your campaigns yet. Results appear here once a campaign is running and customers start earning.</p>`;
    const gifts = (ov.recent_gifts || []).length
      ? `<div class="rw-scroll"><table class="rw-table"><thead><tr><th>When</th><th>To</th><th>Campaign</th><th class="n">Points</th></tr></thead><tbody>
          ${ov.recent_gifts.map((g) => `<tr><td>${esc(R.dateTime(g.created_at))}</td><td>${esc(g.recipient || "")}${g.message ? `<span class="rw-sub">“${esc(g.message)}”</span>` : ""}</td><td>${esc(g.campaign || "")}</td><td class="n">${num(g.points)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="rw-empty">No gifts sent yet.</p>`;
    const campOpts = (list) => list.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    root.innerHTML = `${picker}
      ${b.status !== "active" ? `<div class="rw-note"><strong>This brand is suspended.</strong> Its campaigns cannot be changed. Please contact partners@zonicme.com.ng.</div>` : ""}
      <div class="rw-stats">
        <div class="rw-stat big"><div class="l">Budget left</div><div class="v">${num(s.budget_total - s.budget_spent)}</div><div class="s">of ${num(s.budget_total)} points across all campaigns</div></div>
        <div class="rw-stat"><div class="l">Points given</div><div class="v">${num(s.issued_total)}</div><div class="s">${num(s.earned_total)} earned · ${num(s.gifted_total)} gifted</div></div>
        <div class="rw-stat"><div class="l">People reached</div><div class="v">${num(s.people_reached)}</div><div class="s">wallets that received your points</div></div>
        <div class="rw-stat"><div class="l">Still held</div><div class="v">${num(s.outstanding_estimate)}</div><div class="s">estimate of your points not yet redeemed</div></div>
      </div>
      <div class="rw-card">
        <div class="rw-item-head"><h2>Campaigns — ${esc(b.name)}${R.demoPill(b.is_demo)}</h2>
          <button type="button" class="rw-btn small" data-act="new-campaign">New campaign</button></div>
        <p class="rw-lead">A campaign needs ZonicMe's approval before it starts awarding. Raising the budget or adding apps later sends it back for approval.</p>
        <div id="campFormBox"></div>
        <div id="ruleFormBox"></div>
        <p class="rw-msg" id="campOut" role="status" aria-live="polite"></p>
        ${(ov.campaigns || []).length ? ov.campaigns.map(campaignHtml).join("")
          : `<p class="rw-empty">You have no campaigns yet. Press “New campaign” to plan your first one: pick the apps, set a points budget, then add a rule that says what earns a reward.</p>`}
      </div>
      <div class="rw-two">
        <div class="rw-card"><h2>Test a campaign</h2>
          <p class="rw-lead">See what a customer would earn from an example event. Nothing is awarded by a test.</p>
          ${live.length ? `<form class="rw-form" id="dryForm" novalidate>
            <label for="dryCamp">Campaign</label><select id="dryCamp">${campOpts(live)}</select>
            <div class="rw-row"><div><label for="dryApp">App</label><select id="dryApp"></select></div>
              <div><label for="dryAmount">Amount spent</label><input id="dryAmount" type="text" inputmode="decimal" maxlength="14" placeholder="For example 15000"></div></div>
            <label for="dryEvent">Event</label><select id="dryEvent">${R.KNOWN_EVENTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select>
            <div class="rw-actions"><button class="rw-btn ghost" type="submit" id="dryBtn">Run test</button></div>
            <p class="rw-msg" id="dryOut" role="status" aria-live="polite"></p><div id="dryRes"></div></form>`
            : `<p class="rw-empty">Create a campaign first, then you can test it here.</p>`}
        </div>
        <div class="rw-card"><h2>Send a one-off gift</h2>
          <p class="rw-lead">Give points straight to one customer. The points come out of a running campaign's budget and cannot be taken back.</p>
          ${running.length ? `<form class="rw-form" id="bGiftForm" novalidate>
            <label for="bGiftCamp">Paid for by</label><select id="bGiftCamp">${campOpts(running)}</select>
            <label for="bGiftEmail">Customer's email address</label><input id="bGiftEmail" type="email" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="200">
            <label for="bGiftPoints">How many points</label><input id="bGiftPoints" type="text" inputmode="numeric" maxlength="9">
            <label for="bGiftMsg">Message (optional)</label><input id="bGiftMsg" type="text" maxlength="280">
            <div class="rw-actions"><button class="rw-btn" type="submit" id="bGiftBtn">Send gift</button></div>
            <p class="rw-msg" id="bGiftOut" role="status" aria-live="polite"></p></form>`
            : `<p class="rw-empty">Gifts are paid for by a running campaign. Once one of your campaigns is approved and running, you can send gifts from here.</p>`}
        </div>
      </div>
      <div class="rw-two">
        <div class="rw-card"><h2>Results by app</h2>${byApp}</div>
        <div class="rw-card"><h2>Recent gifts</h2>${gifts}</div>
      </div>`;
  }

  function campaignFormHtml(c) {
    const apps = (ov.apps || []).map((a) => `<label class="rw-check"><input type="checkbox" name="apps" value="${esc(a.app_id)}"${c && (c.applications || []).indexOf(a.app_id) >= 0 ? " checked" : ""}> <span>${esc(a.name)}</span></label>`).join("");
    return `<form class="rw-form rw-item" id="campForm" novalidate>
      <h3>${c ? "Edit campaign" : "New campaign"}</h3>
      <input type="hidden" name="id" value="${esc(c ? c.id : "")}">
      <label for="cName">Campaign name</label><input id="cName" name="name" type="text" maxlength="100" value="${esc(c ? c.name : "")}">
      <label for="cDesc">What customers should know</label><input id="cDesc" name="description" type="text" maxlength="500" value="${esc(c ? c.description : "")}">
      <span class="rw-label">Apps it runs in</span>
      <div class="rw-checks">${apps || '<span class="rw-hint">No apps are taking reward events yet.</span>'}</div>
      <div class="rw-row3">
        <div><label for="cBudget">Budget (points)</label><input id="cBudget" name="budget" type="text" inputmode="numeric" maxlength="13" value="${esc(c ? c.budget_points : "")}"></div>
        <div><label for="cStart">Starts</label><input id="cStart" name="starts_at" type="datetime-local" value="${esc(c ? R.toLocalInput(c.starts_at) : "")}"></div>
        <div><label for="cEnd">Ends</label><input id="cEnd" name="ends_at" type="datetime-local" value="${esc(c ? R.toLocalInput(c.ends_at) : "")}"></div>
      </div>
      <p class="rw-hint">Leave the dates empty to start as soon as it is approved and run until you end it.${c && c.spent_points > 0 ? " " + num(c.spent_points) + " points have already been given, so the budget cannot go below that." : ""}</p>
      <div class="rw-actions">
        <button type="submit" class="rw-btn" data-submit="0">${c && c.status !== "draft" && c.status !== "rejected" ? "Save changes" : "Save as draft"}</button>
        ${!c || c.status === "draft" || c.status === "rejected" ? '<button type="submit" class="rw-btn ghost" data-submit="1">Save and send for approval</button>' : ""}
        <button type="button" class="rw-btn ghost" data-act="close-forms">Cancel</button>
      </div>
      <p class="rw-msg" id="campFormOut" role="status" aria-live="polite"></p></form>`;
  }

  function openCampaignForm(c) {
    $("#ruleFormBox", rootEl).innerHTML = "";
    const box = $("#campFormBox", rootEl);
    box.innerHTML = campaignFormHtml(c);
    const form = $("#campForm", box);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const out = $("#campFormOut", box), btn = ev.submitter || $("[data-submit='0']", form);
      const f = form.elements;
      const apps = $all("input[name='apps']:checked", form).map((x) => x.value);
      const budget = String(f.budget.value).trim().replace(/,/g, "");
      if (f.name.value.trim().length < 2) return say(out, "Give the campaign a name.", "bad");
      if (!apps.length) return say(out, "Choose at least one app for this campaign.", "bad");
      if (!/^[0-9]{1,13}$/.test(budget) || Number(budget) < 1) return say(out, "Enter the budget as a whole number of points.", "bad");
      const args = { name: f.name.value.trim(), description: f.description.value.trim(), applications: apps, budget_points: Number(budget),
        starts_at: R.fromLocalInput(f.starts_at.value), ends_at: R.fromLocalInput(f.ends_at.value), submit: btn.getAttribute("data-submit") === "1" };
      if (f.id.value) args.id = f.id.value; else args.brand_id = brandId;
      const r = await R.withBusy(btn, out, "Saving…", () => R.call("brand.campaign.save", args));
      if (r) { await load(); say($("#campOut", rootEl), r.status === "pending" ? "Saved and sent to ZonicMe for approval." : "Campaign saved.", "ok"); }
    });
    form.scrollIntoView({ block: "nearest" });
    form.elements.name.focus();
  }

  function openRuleForm(campaignId, rule) {
    $("#campFormBox", rootEl).innerHTML = "";
    const box = $("#ruleFormBox", rootEl);
    const camp = (ov.campaigns || []).find((c) => c.id === campaignId);
    box.innerHTML = `<div class="rw-item"><h3>${rule ? "Edit rule" : "New rule"} — ${esc(camp ? camp.name : "")}</h3>
      <p class="rw-hint">Saving a change keeps the old version on record, so past awards always show the rule as it was.</p>
      ${R.ruleFormHtml({ admin: false, idPrefix: "brf" })}</div>`;
    const form = $("#brfForm", box);
    R.bindRuleForm(form);
    R.fillRuleForm(form, rule || null, { campaign_id: campaignId });
    $("[data-role='cancel']", form).addEventListener("click", () => { box.innerHTML = ""; });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const out = $("[data-role='msg']", form), btn = $("[data-role='save']", form);
      let payload;
      try { payload = R.readRuleForm(form); } catch (e) { return say(out, R.errText(e), "bad"); }
      const r = await R.withBusy(btn, out, "Saving…", () => R.call("brand.rule.save", payload));
      if (r) { await load(); say($("#campOut", rootEl), "Rule saved" + (r.active ? " and switched on." : ". It is switched off until you switch it on."), "ok"); }
    });
    form.scrollIntoView({ block: "nearest" });
  }

  async function onClick(ev) {
    const t = ev.target.closest("[data-act]");
    if (!t || !rootEl.contains(t)) return;
    const act = t.getAttribute("data-act"), id = t.getAttribute("data-id"), out = $("#campOut", rootEl);
    if (act === "new-campaign") return openCampaignForm(null);
    if (act === "close-forms") { $("#campFormBox", rootEl).innerHTML = ""; $("#ruleFormBox", rootEl).innerHTML = ""; return; }
    if (act === "edit-campaign") return openCampaignForm((ov.campaigns || []).find((c) => c.id === id));
    if (act === "add-rule") return openRuleForm(id, null);
    if (act === "edit-rule") {
      const camp = (ov.campaigns || []).find((c) => c.id === id);
      return openRuleForm(id, camp && (camp.rules || []).find((r) => r.rule_key === t.getAttribute("data-key")));
    }
    if (act === "status") {
      const to = t.getAttribute("data-to");
      if (to === "ended" && !window.confirm("End this campaign? It stops awarding at once and cannot be started again.")) return;
      const r = await R.withBusy(t, out, "Working…", () => R.call("brand.campaign.status", { campaign_id: id, status: to }));
      if (r) { await load(); say($("#campOut", rootEl), "Campaign updated.", "ok"); }
      return;
    }
    if (act === "toggle-rule") {
      const r = await R.withBusy(t, out, "Working…", () => R.call("brand.rule.active", { rule_key: t.getAttribute("data-key"), active: t.getAttribute("data-on") === "1" }));
      if (r) { await load(); say($("#campOut", rootEl), r.active ? "Rule switched on." : "Rule switched off.", "ok"); }
    }
  }

  async function onSubmit(ev) {
    const form = ev.target;
    if (form.id === "dryForm") {
      ev.preventDefault();
      const out = $("#dryOut", form), amount = $("#dryAmount", form).value.trim().replace(/,/g, "");
      if (amount && !/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(amount)) return say(out, "Enter the amount as a number, for example 15000.", "bad");
      $("#dryRes", form).innerHTML = "";
      const r = await R.withBusy($("#dryBtn", form), out, "Testing…", () => R.call("brand.dry_run",
        { campaign_id: $("#dryCamp", form).value, app_id: $("#dryApp", form).value, amount, event_type: $("#dryEvent", form).value }));
      if (r) {
        $("#dryRes", form).innerHTML = R.dryRunHtml(r.points_awarded, r.gift_credit_awarded, r.steps)
          + (r.in_app_list ? "" : `<p class="rw-hint">This app is not in the campaign's list of apps, so its events do not count for this campaign.</p>`);
      }
    } else if (form.id === "bGiftForm") {
      ev.preventDefault();
      const out = $("#bGiftOut", form), email = $("#bGiftEmail", form).value.trim(), raw = $("#bGiftPoints", form).value.trim().replace(/,/g, "");
      if (!email || email.indexOf("@") < 1) return say(out, "Enter the customer's email address.", "bad");
      if (!/^[0-9]{1,9}$/.test(raw) || Number(raw) < 1) return say(out, "Enter a whole number of points to send.", "bad");
      const r = await R.withBusy($("#bGiftBtn", form), out, "Sending…", () => R.call("brand.gift",
        { campaign_id: $("#bGiftCamp", form).value, email, points: Number(raw), message: $("#bGiftMsg", form).value.trim() }));
      if (r) { const done = "Sent " + pts(r.points) + " to " + (r.recipient || "the customer") + "."; await load(); say($("#bGiftOut", rootEl), done, "ok"); }
    }
  }

  /** The test form only offers the apps the chosen campaign runs in. */
  function syncDryApps() {
    const pick = $("#dryCamp", rootEl), sel = $("#dryApp", rootEl);
    if (!pick || !sel) return;
    const camp = (ov.campaigns || []).find((c) => c.id === pick.value);
    sel.innerHTML = ((camp && camp.applications) || []).map((id) => `<option value="${esc(id)}">${esc(appName(id))}</option>`).join("");
  }

  async function load() {
    ov = await R.call("brand.overview", { brand_id: brandId });
    paint();
    syncDryApps();
    const dc = $("#dryCamp", rootEl);
    if (dc) dc.addEventListener("change", syncDryApps);
    const pick = $("#brandPick", rootEl);
    if (pick) pick.addEventListener("change", async () => {
      brandId = pick.value;
      try { await load(); } catch (e) { rootEl.insertAdjacentHTML("afterbegin", `<div class="rw-note">${esc(R.errText(e))}</div>`); }
    });
  }

  async function signedIn(root) {
    rootEl = root;
    const list = await R.call("brand.list");
    brands = list.brands || [];
    R.setAccess({ is_admin: list.is_admin, brand_count: brands.length });
    if (!brands.length) {
      root.innerHTML = `<div class="rw-card"><h2>No brand is linked to this account yet</h2>
        <p class="rw-lead">${list.is_admin ? "No brands have been set up. Create the first one in the Admin console, under Brands."
          : "Brand access is given by ZonicMe. If you run a brand and would like to reward customers across the ZonicMe apps, write to partners@zonicme.com.ng from the email address you signed in with."}</p>
        <p class="rw-lead">Looking for your own points? They are in <a class="rw-link" href="wallet.html">your wallet</a>.</p></div>`;
      return;
    }
    if (!brandId || !brands.some((b) => b.id === brandId)) brandId = brands[0].id;
    if (!root.__rwBound) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.__rwBound = true; }
    await load();
  }

  R.boot({ page: "brand", signedOut, signedIn });
})();
