/** ZonicMe Outreach — admin console (outreach.html).
 *  The database enforces the approval gate on every write; this file only draws the screens.
 *  Nothing here can approve, queue or send on its own: each of those is a button an administrator presses. */
(function () {
  "use strict";
  const R = window.ZonicRewards;
  const { esc, num, $, $all, say } = R;
  const sb = () => window.ZonicSupabase;
  let rootEl = null, tab = "overview";
  const st = { contexts: [], campaigns: [], targets: [], leads: [], settings: null, filter: { app: "", campaign: "", approval: "pending_review", q: "" }, open: null, sel: new Set() };

  const APPS = [["adspot", "AdSpot"], ["rubba", "Rubba"], ["myyanga", "MyYanga"], ["myafriart", "MyAfriArt"], ["owanbe", "Owanbe"], ["sydef", "Sydef"], ["confirmahead", "ConfirmAhead"]];
  const appName = (id) => (APPS.find((a) => a[0] === id) || [id, id])[1];
  const TABS = [["overview", "Overview"], ["campaigns", "Campaigns"], ["review", "Review queue"], ["contexts", "Who we look for"], ["dnc", "Do not contact"], ["activity", "Activity"], ["settings", "Settings"]];
  const APPROVAL = { pending_review: "Waiting for review", approved: "Approved", rejected: "Rejected" };
  const SENDING = { unsent: "Not sent", queued: "Queued", sending: "Sending", sent: "Sent", replied: "Replied", bounced: "Bounced", failed: "Failed", suppressed: "Do not contact" };
  const ctxById = (id) => st.contexts.find((c) => c.id === id);
  const campById = (id) => st.campaigns.find((c) => c.id === id);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;
  const table = (head, rows, empty) => rows.length
    ? `<div class="rw-scroll"><table class="rw-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="rw-empty">${empty}</p>`;

  async function q(builder) { const { data, error } = await builder; if (error) throw error; return data || []; }
  async function loadBase() {
    const [contexts, campaigns, targets, settings] = await Promise.all([
      q(sb().from("outreach_contexts").select("*").order("app").order("label")),
      q(sb().from("outreach_campaigns").select("*").order("created_at", { ascending: false })),
      q(sb().from("outreach_campaign_targets").select("*")),
      q(sb().from("outreach_settings").select("*").eq("id", 1)),
    ]);
    Object.assign(st, { contexts, campaigns, targets, settings: settings[0] || null });
  }
  async function loadLeads() {
    let b = sb().from("outreach_leads").select("*").order("created_at", { ascending: false }).limit(1000);
    if (st.filter.app) b = b.eq("app", st.filter.app);
    if (st.filter.campaign) b = b.eq("campaign_id", st.filter.campaign);
    if (st.filter.approval) b = b.eq("approval_status", st.filter.approval);
    st.leads = await q(b);
  }
  const shownLeads = () => { const t = st.filter.q.trim().toLowerCase(); return !t ? st.leads : st.leads.filter((l) => [l.org_name, l.contact_email, l.owner_name, l.country].some((v) => String(v || "").toLowerCase().includes(t))); };

  // ---------------------------------------------------------------- overview
  async function overviewHtml() {
    const all = await q(sb().from("outreach_leads").select("app,approval_status,outreach_status").limit(10000));
    const count = (f) => all.filter(f).length, s = st.settings || {};
    const perApp = APPS.map(([id, name]) => { const a = all.filter((l) => l.app === id); return a.length ? `<tr><td>${esc(name)}</td><td>${num(a.length)}</td><td>${num(a.filter((l) => l.approval_status === "pending_review").length)}</td><td>${num(a.filter((l) => l.approval_status === "approved").length)}</td><td>${num(a.filter((l) => ["sent", "replied", "bounced"].includes(l.outreach_status)).length)}</td><td>${num(a.filter((l) => l.outreach_status === "replied").length)}</td></tr>` : ""; }).filter(Boolean);
    return `
      <div class="rw-note${s.sending_paused ? "" : " calm"}"><strong>Sending is ${s.sending_paused ? "switched off" : "switched on"}.</strong> ${esc(s.sending_paused ? (s.pause_reason || "Nothing will be emailed until it is switched on in Settings.") : "Only emails you have approved and queued are sent, up to each campaign's daily limit.")}</div>
      <div class="rw-stats">
        <div class="rw-stat big"><div class="l">Waiting for your review</div><div class="v">${num(count((l) => l.approval_status === "pending_review"))}</div><div class="s">Nothing is sent without your approval</div></div>
        <div class="rw-stat"><div class="l">Approved</div><div class="v">${num(count((l) => l.approval_status === "approved"))}</div><div class="s">${num(count((l) => l.outreach_status === "queued"))} queued to send</div></div>
        <div class="rw-stat"><div class="l">Sent</div><div class="v">${num(count((l) => ["sent", "replied", "bounced"].includes(l.outreach_status)))}</div><div class="s">${num(count((l) => l.outreach_status === "bounced"))} bounced</div></div>
        <div class="rw-stat"><div class="l">Replies</div><div class="v">${num(count((l) => l.outreach_status === "replied"))}</div><div class="s">Follow these up yourself</div></div>
      </div>
      <div class="rw-card"><h2>By application</h2>${table(["Application", "Leads", "To review", "Approved", "Sent", "Replies"], perApp, "No leads yet. Create a campaign, then add leads to it.")}</div>
      <div class="rw-card"><h2>How it works</h2><p class="rw-lead">1. In <button type="button" class="rw-link" data-tab="campaigns">Campaigns</button>, choose an application, tick who to look for and set how many per country.
        2. Leads and their draft emails arrive in the <button type="button" class="rw-link" data-tab="review">Review queue</button>. 3. You edit, approve or reject each one. 4. Only approved emails with a checked address can be queued, and only queued emails are sent.</p></div>`;
  }

  // ---------------------------------------------------------------- campaigns
  function parseQuotas(text) {   // "Nigeria 100, Cameroon 20" -> [{country, quota}]
    return String(text || "").split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => { const m = p.match(/^(.*?)[\s:=-]*(\d{1,4})$/); return m && m[1].trim() ? { country: m[1].trim().replace(/\s+/g, " "), quota: Number(m[2]) } : null; }).filter(Boolean);
  }
  async function campaignsHtml() {
    const found = await q(sb().from("outreach_leads").select("campaign_id,context_id,country").not("campaign_id", "is", null).limit(10000));
    const newApp = (rootEl.__newApp = rootEl.__newApp || APPS[0][0]);
    const ctxs = st.contexts.filter((c) => c.app === newApp && c.active);
    const cards = st.campaigns.map((c) => {
      const rows = st.targets.filter((t) => t.campaign_id === c.id && t.quota > 0).map((t) => { const have = found.filter((l) => l.campaign_id === c.id && l.context_id === t.context_id && String(l.country || "").toLowerCase() === t.country.toLowerCase()).length; return `<tr><td>${esc((ctxById(t.context_id) || {}).label || "")}</td><td>${esc(t.country)}</td><td>${num(have)} of ${num(t.quota)}</td></tr>`; });
      return `<div class="rw-card"><h2>${esc(c.name)} <span class="rw-pill ${c.status === "active" ? "ok" : "warn"}">${esc(c.status)}</span></h2>
        <p class="rw-hint">${esc(appName(c.app))} · up to ${num(c.daily_send_cap)} emails a day</p>
        ${table(["Who", "Country", "Found"], rows, "No targets set for this campaign.")}
        <div class="rw-actions">${c.status === "active" ? `<button type="button" class="rw-btn ghost" data-act="camp-status" data-id="${c.id}" data-to="paused">Pause</button>` : `<button type="button" class="rw-btn" data-act="camp-status" data-id="${c.id}" data-to="active">Make active</button>`}
          <button type="button" class="rw-btn ghost" data-act="camp-review" data-id="${c.id}">Open its leads</button></div></div>`;
    });
    return `<div class="rw-card"><h2>New campaign</h2>
      <form id="campNew" class="rw-form">
        <label>Name<input id="cnName" required minlength="2" maxlength="120" placeholder="MyAfriArt artists, West Africa"></label>
        <label>Application<select id="cnApp">${APPS.map((a) => opt(a[0], a[1], newApp)).join("")}</select></label>
        <label>Most emails to send in a day<input id="cnCap" type="number" min="1" max="200" value="30"></label>
        <fieldset><legend>Who to look for, and how many per country</legend>
          ${ctxs.map((c) => `<label class="rw-check"><input type="checkbox" data-ctx="${c.id}"> ${esc(c.label)} <span class="rw-sub">${esc(c.purpose)}</span></label>
            <input data-quota="${c.id}" placeholder="Nigeria 100, Cameroon 20, Ghana 30" aria-label="Countries and numbers for ${esc(c.label)}">`).join("") || `<p class="rw-empty">No contexts for this application yet. Add one under "Who we look for".</p>`}
        </fieldset>
        <div class="rw-actions"><button class="rw-btn" id="cnBtn">Create campaign</button></div><p class="rw-msg" id="cnOut" role="status" aria-live="polite"></p>
      </form></div>
      ${cards.join("") || `<p class="rw-empty">No campaigns yet.</p>`}<p class="rw-msg" id="campOut" role="status" aria-live="polite"></p>`;
  }

  // ---------------------------------------------------------------- review queue
  function leadRow(l) {
    const c = ctxById(l.context_id);
    return `<tr data-lead="${l.id}" class="rw-click"><td><input type="checkbox" data-sel="${l.id}"${st.sel.has(l.id) ? " checked" : ""} aria-label="Select ${esc(l.org_name)}"></td>
      <td><strong>${esc(l.org_name)}</strong><span class="rw-sub">${esc([l.owner_name, l.country].filter(Boolean).join(" · "))}</span></td>
      <td>${esc(l.contact_email || "no address")}${l.contact_email ? ` <span class="rw-pill ${l.email_verified ? "ok" : "warn"}">${l.email_verified ? "checked" : "not checked"}</span>` : ""}</td>
      <td>${esc(appName(l.app))}<span class="rw-sub">${esc(c ? c.label : "")}</span></td>
      <td>${esc(l.draft_subject || "No draft yet")}</td>
      <td><span class="rw-pill ${l.approval_status === "approved" ? "ok" : "warn"}">${esc(APPROVAL[l.approval_status])}</span><span class="rw-sub">${esc(SENDING[l.outreach_status])}</span></td></tr>`;
  }
  function editorHtml(l) {
    const locked = ["sending", "sent", "replied", "bounced"].includes(l.outreach_status);
    return `<div class="rw-card" id="leadEditor"><h2>${esc(l.org_name)}</h2>
      <p class="rw-hint">${esc(appName(l.app))} · ${esc((ctxById(l.context_id) || {}).label || "")} · ${esc(APPROVAL[l.approval_status])} · ${esc(SENDING[l.outreach_status])}${l.source_url ? ` · <a class="rw-link" href="${esc(l.source_url)}" target="_blank" rel="noopener noreferrer">where it was found</a>` : ""}</p>
      ${l.evidence ? `<p class="rw-lead">${esc(l.evidence)}</p>` : ""}
      ${locked ? `<div class="rw-note calm">This email has gone out, so it can no longer be changed.</div>` : ""}
      <form id="leadForm" class="rw-form" data-id="${l.id}">
        <label>Organisation<input id="lfOrg" value="${esc(l.org_name)}" required${locked ? " disabled" : ""}></label>
        <label>Contact name<input id="lfOwner" value="${esc(l.owner_name || "")}"${locked ? " disabled" : ""}></label>
        <label>Email address<input id="lfEmail" type="email" value="${esc(l.contact_email || "")}"${locked ? " disabled" : ""}></label>
        <label class="rw-check"><input type="checkbox" id="lfVerified"${l.email_verified ? " checked" : ""}${locked ? " disabled" : ""}> I have checked this address is right${l.verification_note ? ` <span class="rw-sub">${esc(l.verification_note)}</span>` : ""}</label>
        <label>Subject<input id="lfSubject" value="${esc(l.draft_subject || "")}" maxlength="200"${locked ? " disabled" : ""}></label>
        <label>Message<textarea id="lfBody" rows="12"${locked ? " disabled" : ""}>${esc(l.draft_body || "")}</textarea></label>
        ${locked ? "" : `<div class="rw-actions">
          <button class="rw-btn ghost" data-do="save">Save changes</button>
          <button class="rw-btn" data-do="approve">Save and approve</button>
          <button class="rw-btn warn" data-do="reject">Reject</button>
          ${l.approval_status === "approved" && l.outreach_status === "unsent" ? `<button class="rw-btn" data-do="queue">Queue to send</button>` : ""}
          ${l.outreach_status === "queued" ? `<button class="rw-btn ghost" data-do="unqueue">Take out of the queue</button>` : ""}</div>
          <p class="rw-hint">Changing the address, subject or message after approval sends the lead back for review.</p>`}
        <p class="rw-msg" id="lfOut" role="status" aria-live="polite"></p>
      </form></div>`;
  }
  async function reviewHtml() {
    await loadLeads();
    const f = st.filter, rows = shownLeads(), open = st.open && st.leads.find((l) => l.id === st.open);
    const dupes = open && open.contact_email ? await q(sb().from("outreach_leads").select("app,approval_status,outreach_status").eq("contact_email", open.contact_email).neq("id", open.id)) : [];
    return `<div class="rw-card"><h2>Review queue</h2>
      <div class="rw-form rw-inline">
        <label>Application<select id="rfApp"><option value="">All</option>${APPS.map((a) => opt(a[0], a[1], f.app)).join("")}</select></label>
        <label>Campaign<select id="rfCamp"><option value="">All</option>${st.campaigns.map((c) => opt(c.id, c.name, f.campaign)).join("")}</select></label>
        <label>Show<select id="rfApproval"><option value="">Everything</option>${Object.keys(APPROVAL).map((k) => opt(k, APPROVAL[k], f.approval)).join("")}</select></label>
        <label>Search<input id="rfQ" value="${esc(f.q)}" placeholder="Name, email or country"></label>
      </div>
      <div class="rw-actions">
        <button type="button" class="rw-btn" data-act="bulk" data-to="approved">Approve selected</button>
        <button type="button" class="rw-btn warn" data-act="bulk" data-to="rejected">Reject selected</button>
        <button type="button" class="rw-btn ghost" data-act="bulk-queue">Queue selected to send</button>
        <button type="button" class="rw-btn ghost" data-act="export">Download as spreadsheet (CSV)</button>
      </div><p class="rw-msg" id="rvOut" role="status" aria-live="polite"></p>
      ${table([`<input type="checkbox" id="selAll" aria-label="Select all shown">`, "Organisation", "Email", "For", "Subject", "Status"], rows.map(leadRow), "Nothing here. Change the filters above, or add leads below.")}
      <p class="rw-hint">${num(rows.length)} shown${st.leads.length >= 1000 ? " (first 1,000; narrow the filters to see the rest)" : ""}. Click a row to read and edit its email.</p></div>
      ${open ? (dupes.length ? `<div class="rw-note"><strong>This address is also a lead for ${esc([...new Set(dupes.map((d) => appName(d.app)))].join(", "))}.</strong> Check you are not writing to the same person twice.</div>` : "") + editorHtml(open) : ""}
      <div class="rw-card"><h2>Add leads from a spreadsheet</h2>
        <p class="rw-lead">Upload a CSV with a header row. Recognised columns: <code>org_name</code> (required), <code>contact_email</code>, <code>owner_name</code>, <code>country</code>, <code>website_url</code>, <code>draft_subject</code>, <code>draft_body</code>. Every lead arrives waiting for review.</p>
        <form id="importForm" class="rw-form rw-inline">
          <label>Campaign<select id="imCamp" required>${st.campaigns.map((c) => opt(c.id, c.name, f.campaign)).join("")}</select></label>
          <label>Who they are<select id="imCtx" required>${st.contexts.map((c) => opt(c.id, appName(c.app) + " · " + c.label, "")).join("")}</select></label>
          <label>File<input id="imFile" type="file" accept=".csv,text/csv" required></label>
          <button class="rw-btn" id="imBtn">Add leads</button>
        </form><p class="rw-msg" id="imOut" role="status" aria-live="polite"></p></div>`;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = "", inQ = false;
    const s = String(text).replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) { const ch = s[i];
      if (inQ) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((c) => c.trim())) rows.push(row); row = []; }
      else cur += ch; }
    row.push(cur); if (row.some((c) => c.trim())) rows.push(row);
    return rows;
  }
  const csvCell = (v) => { let t = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function exportCsv() {
    const cols = ["app", "country", "org_name", "owner_name", "contact_email", "email_verified", "website_url", "draft_subject", "draft_body", "approval_status", "outreach_status", "source_url", "created_at"];
    const lines = [cols.join(",")].concat(shownLeads().map((l) => cols.map((c) => csvCell(l[c])).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "zonicme-outreach-leads.csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------------------------------------------------------------- contexts, do-not-contact, activity, settings
  function contextsHtml() {
    return APPS.map(([id, name]) => { const cs = st.contexts.filter((c) => c.app === id);
      return `<div class="rw-card"><h2>${esc(name)}</h2>${cs.map((c) => `<form class="rw-form" data-ctxform="${c.id}">
        <label>Name<input data-f="label" value="${esc(c.label)}" required></label>
        <label>Who to find, and where to look<textarea data-f="discovery_brief" rows="3">${esc(c.discovery_brief)}</textarea></label>
        <label>What the email offers<textarea data-f="pitch_brief" rows="3">${esc(c.pitch_brief)}</textarea></label>
        <label class="rw-check"><input type="checkbox" data-f="active"${c.active ? " checked" : ""}> In use</label>
        <div class="rw-actions"><button class="rw-btn ghost">Save</button></div><p class="rw-msg" role="status" aria-live="polite"></p></form>`).join("<hr>") || `<p class="rw-empty">None yet.</p>`}</div>`; }).join("") +
      `<div class="rw-card"><h2>Add another</h2><form id="ctxNew" class="rw-form">
        <label>Application<select id="cxApp">${APPS.map((a) => opt(a[0], a[1], "")).join("")}</select></label>
        <label>Name<input id="cxLabel" required placeholder="Cultural agencies sponsoring fashion events"></label>
        <label>Purpose<select id="cxPurpose">${["listing", "advertising", "collaboration", "sponsorship", "partnership"].map((p) => opt(p, p, "collaboration")).join("")}</select></label>
        <label>Who to find, and where to look<textarea id="cxDisc" rows="3" required></textarea></label>
        <label>What the email offers<textarea id="cxPitch" rows="3" required></textarea></label>
        <div class="rw-actions"><button class="rw-btn" id="cxBtn">Add</button></div><p class="rw-msg" id="cxOut" role="status" aria-live="polite"></p></form></div>`;
  }
  async function dncHtml() {
    const rows = await q(sb().from("outreach_suppressions").select("*").order("created_at", { ascending: false }).limit(500));
    return `<div class="rw-card"><h2>Do not contact</h2><p class="rw-lead">Addresses and whole domains listed here can never be queued or sent to, in any application.</p>
      <form id="dncForm" class="rw-form rw-inline"><label>Email address or domain<input id="dnValue" required placeholder="name@example.com or example.com"></label>
        <label>Reason<input id="dnReason" value="asked not to be contacted"></label><button class="rw-btn" id="dnBtn">Add</button></form><p class="rw-msg" id="dnOut" role="status" aria-live="polite"></p>
      ${table(["Address or domain", "Reason", "Added"], rows.map((r) => `<tr><td>${esc(r.email || r.domain)}</td><td>${esc(r.reason)}</td><td>${esc(R.dateTime(r.created_at))}</td></tr>`), "Nobody is on the list yet.")}</div>`;
  }
  async function activityHtml() {
    const rows = await q(sb().from("outreach_events").select("*").order("created_at", { ascending: false }).limit(200));
    const ids = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))], names = {};
    if (ids.length) (await q(sb().from("outreach_leads").select("id,org_name").in("id", ids))).forEach((l) => { names[l.id] = l.org_name; });
    const who = (a) => a.startsWith("admin:") ? "An administrator" : a === "sender" ? "Sending service" : "Research agent";
    return `<div class="rw-card"><h2>Activity</h2>${table(["When", "Who", "What", "Lead"], rows.map((r) => `<tr><td>${esc(R.dateTime(r.created_at))}</td><td>${esc(who(r.actor))}</td><td>${esc(r.action.replace(/_/g, " "))}</td><td>${esc(names[r.lead_id] || "")}</td></tr>`), "Nothing has happened yet.")}</div>`;
  }
  function settingsHtml() {
    const s = st.settings || {};
    return `<div class="rw-card"><h2>Sending</h2><form id="setForm" class="rw-form">
      <label class="rw-check"><input type="checkbox" id="osOn"${s.sending_paused ? "" : " checked"}> Sending switched on</label>
      <label>Sender name<input id="osName" value="${esc(s.from_name || "")}" placeholder="ZonicMe Partnerships"></label>
      <label>Sender address<input id="osFrom" type="email" value="${esc(s.from_email || "")}" placeholder="partnerships@your-domain"></label>
      <label>Replies go to<input id="osReply" type="email" value="${esc(s.reply_to || "")}"></label>
      <label>Pause automatically when bounces pass (percent)<input id="osBounce" type="number" min="1" max="20" step="0.5" value="${esc(String(Math.round(Number(s.bounce_pause_threshold || 0.03) * 1000) / 10))}"></label>
      <div class="rw-actions"><button class="rw-btn" id="osBtn">Save</button></div><p class="rw-msg" id="osOut" role="status" aria-live="polite"></p></form>
      <p class="rw-hint">Emails are only sent from an address on a domain that has been set up for sending. Until one is entered here, nothing is sent even if sending is switched on.</p></div>`;
  }

  // ---------------------------------------------------------------- drawing
  async function show(next) {
    tab = next || tab;
    rootEl.innerHTML = `<div class="rw-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" class="rw-tab${t[0] === tab ? " is-on" : ""}" aria-selected="${t[0] === tab}" data-tab="${t[0]}">${t[1]}</button>`).join("")}</div>
      <div id="orBody"><div class="rw-card rw-sk" aria-hidden="true"><span class="sk sk-heading"></span><span class="sk sk-line"></span></div></div>`;
    try {
      await loadBase();
      const html = tab === "overview" ? await overviewHtml() : tab === "campaigns" ? await campaignsHtml() : tab === "review" ? await reviewHtml()
        : tab === "contexts" ? contextsHtml() : tab === "dnc" ? await dncHtml() : tab === "activity" ? await activityHtml() : settingsHtml();
      $("#orBody", rootEl).innerHTML = html;
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", "#" + tab);
    } catch (e) { $("#orBody", rootEl).innerHTML = `<div class="rw-note"><strong>This screen could not load.</strong> ${esc(R.errText(e))}</div>`; }
  }

  async function onClick(ev) {
    const t = ev.target.closest("[data-tab],[data-act],[data-sel],#selAll,tr[data-lead]"); if (!t) return;
    if (t.dataset.tab) return show(t.dataset.tab);
    if (t.id === "selAll") { shownLeads().forEach((l) => (t.checked ? st.sel.add(l.id) : st.sel.delete(l.id))); $all("[data-sel]", rootEl).forEach((c) => { c.checked = t.checked; }); return; }
    if (t.dataset.sel) { t.checked ? st.sel.add(t.dataset.sel) : st.sel.delete(t.dataset.sel); return; }
    if (t.matches("tr[data-lead]")) { st.open = t.dataset.lead; await show("review"); const ed = $("#leadEditor", rootEl); if (ed) ed.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const act = t.dataset.act, out = $("#rvOut", rootEl) || $("#campOut", rootEl);
    try {
      if (act === "camp-status") { await q(sb().from("outreach_campaigns").update({ status: t.dataset.to, updated_at: new Date().toISOString() }).eq("id", t.dataset.id).select("id")); await show("campaigns"); }
      else if (act === "camp-review") { st.filter.campaign = t.dataset.id; st.filter.app = ""; st.filter.approval = ""; await show("review"); }
      else if (act === "export") exportCsv();
      else if (act === "bulk" || act === "bulk-queue") {
        const ids = shownLeads().filter((l) => st.sel.has(l.id)).map((l) => l.id);
        if (!ids.length) return say(out, "Tick the leads you want first.", "bad");
        const label = act === "bulk-queue" ? "Queue" : t.dataset.to === "approved" ? "Approve" : "Reject";
        if (!window.confirm(`${label} ${ids.length} lead${ids.length === 1 ? "" : "s"}?`)) return;
        let ok = 0; const failed = [];
        for (const id of ids) {   // one at a time, so one lead that is not ready never blocks the rest
          const patch = act === "bulk-queue" ? { outreach_status: "queued" } : { approval_status: t.dataset.to };
          const { error } = await sb().from("outreach_leads").update(patch).eq("id", id);
          if (error) failed.push(error.message); else ok++;
        }
        st.sel.clear(); await show("review");
        say($("#rvOut", rootEl), `${ok} done.` + (failed.length ? ` ${failed.length} could not be changed: ${failed[0]}` : ""), failed.length ? "bad" : "ok");
      }
    } catch (e) { say(out, R.errText(e), "bad"); }
  }

  async function onSubmit(ev) {
    const form = ev.target; ev.preventDefault();
    const doWhat = (ev.submitter && ev.submitter.dataset.do) || "";
    try {
      if (form.id === "leadForm") {
        const out = $("#lfOut", form), id = form.dataset.id;
        const content = { org_name: $("#lfOrg", form).value.trim(), owner_name: $("#lfOwner", form).value.trim() || null, contact_email: $("#lfEmail", form).value.trim() || null,
          email_verified: $("#lfVerified", form).checked, draft_subject: $("#lfSubject", form).value.trim() || null, draft_body: $("#lfBody", form).value.trim() || null };
        const steps = doWhat === "approve" ? [content, { approval_status: "approved" }] : doWhat === "reject" ? [{ approval_status: "rejected" }]
          : doWhat === "queue" ? [{ outreach_status: "queued" }] : doWhat === "unqueue" ? [{ outreach_status: "unsent" }] : [content];
        for (const patch of steps) { const { error } = await sb().from("outreach_leads").update(patch).eq("id", id); if (error) return say(out, error.message, "bad"); }
        await show("review"); say($("#lfOut", rootEl) || $("#rvOut", rootEl), doWhat === "approve" ? "Approved." : doWhat === "reject" ? "Rejected." : doWhat === "queue" ? "Queued to send." : doWhat === "unqueue" ? "Taken out of the queue." : "Saved.", "ok");
      } else if (form.id === "campNew") {
        const out = $("#cnOut", form), app = $("#cnApp", form).value, targets = [];
        $all("[data-ctx]", form).filter((c) => c.checked).forEach((c) => parseQuotas($(`[data-quota="${c.dataset.ctx}"]`, form).value).forEach((p) => targets.push({ context_id: c.dataset.ctx, country: p.country, quota: p.quota })));
        if (!targets.length) return say(out, 'Tick at least one group and type its countries and numbers, for example "Nigeria 100, Ghana 30".', "bad");
        const { data: u } = await sb().auth.getUser();
        const made = await q(sb().from("outreach_campaigns").insert({ name: $("#cnName", form).value.trim(), app, daily_send_cap: Number($("#cnCap", form).value) || 30, created_by: u && u.user ? u.user.id : null }).select("id"));
        await q(sb().from("outreach_campaign_targets").insert(targets.map((t) => Object.assign({ campaign_id: made[0].id }, t))).select("id"));
        await show("campaigns"); say($("#campOut", rootEl), "Campaign created as a draft. Make it active when you are ready.", "ok");
      } else if (form.id === "importForm") {
        const out = $("#imOut", rootEl), file = $("#imFile", form).files[0], camp = campById($("#imCamp", form).value), ctx = ctxById($("#imCtx", form).value);
        if (!file || !camp || !ctx) return say(out, "Choose a campaign, who they are, and a file.", "bad");
        if (ctx.app !== camp.app) return say(out, `That group belongs to ${appName(ctx.app)} but the campaign is for ${appName(camp.app)}.`, "bad");
        const rows = parseCsv(await file.text()); if (rows.length < 2) return say(out, "That file has no rows under its header.", "bad");
        const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")), ix = (n) => head.indexOf(n);
        if (ix("org_name") < 0) return say(out, "The file needs a column called org_name.", "bad");
        const pick = (r, n) => (ix(n) >= 0 ? String(r[ix(n)] || "").trim() : "") || null;
        const leads = rows.slice(1).map((r) => ({ campaign_id: camp.id, context_id: ctx.id, app: camp.app, origin: "import", org_name: pick(r, "org_name"), contact_email: pick(r, "contact_email"), owner_name: pick(r, "owner_name"),
          country: pick(r, "country"), website_url: pick(r, "website_url"), draft_subject: pick(r, "draft_subject"), draft_body: pick(r, "draft_body") })).filter((l) => l.org_name);
        let added = 0, skipped = 0;
        for (let i = 0; i < leads.length; i += 50) {   // rows already held for this app are skipped, not overwritten
          const chunk = leads.slice(i, i + 50), { data, error } = await sb().from("outreach_leads").insert(chunk).select("id");
          if (error) { for (const one of chunk) { const r1 = await sb().from("outreach_leads").insert(one).select("id"); r1.error ? skipped++ : added++; } }
          else { added += (data || []).length; skipped += chunk.length - (data || []).length; }
        }
        st.filter.campaign = camp.id; st.filter.app = ""; st.filter.approval = "pending_review"; await show("review");
        say($("#imOut", rootEl), `${added} lead${added === 1 ? "" : "s"} added, waiting for review.` + (skipped ? ` ${skipped} skipped because that address is already held for ${appName(camp.app)}.` : ""), "ok");
      } else if (form.dataset.ctxform) {
        const patch = { updated_at: new Date().toISOString() }; $all("[data-f]", form).forEach((el) => { patch[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value.trim(); });
        await q(sb().from("outreach_contexts").update(patch).eq("id", form.dataset.ctxform).select("id")); say($(".rw-msg", form), "Saved.", "ok");
      } else if (form.id === "ctxNew") {
        const label = $("#cxLabel", form).value.trim(), key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
        await q(sb().from("outreach_contexts").insert({ app: $("#cxApp", form).value, key, label, target_type: "organisation", purpose: $("#cxPurpose", form).value, discovery_brief: $("#cxDisc", form).value.trim(), pitch_brief: $("#cxPitch", form).value.trim() }).select("id"));
        await show("contexts");
      } else if (form.id === "dncForm") {
        const v = $("#dnValue", form).value.trim().toLowerCase(), isEmail = v.includes("@");
        await q(sb().from("outreach_suppressions").insert(Object.assign({ reason: $("#dnReason", form).value.trim() || "opted out" }, isEmail ? { email: v } : { domain: v.replace(/^https?:\/\//, "").replace(/\/.*$/, "") })).select("id"));
        await show("dnc");
      } else if (form.id === "setForm") {
        const on = $("#osOn", form).checked, from = $("#osFrom", form).value.trim() || null;
        if (on && !from) return say($("#osOut", form), "Enter the sender address before switching sending on.", "bad");
        if (on && st.settings && st.settings.sending_paused && !window.confirm("Switch sending on? Approved, queued emails will start going out.")) return;
        await q(sb().from("outreach_settings").update({ sending_paused: !on, pause_reason: on ? null : "Switched off by an administrator.", from_name: $("#osName", form).value.trim() || null, from_email: from,
          reply_to: $("#osReply", form).value.trim() || null, bounce_pause_threshold: Math.min(0.2, Math.max(0.01, Number($("#osBounce", form).value) / 100 || 0.03)), updated_at: new Date().toISOString() }).eq("id", 1).select("id"));
        await show("settings"); say($("#osOut", rootEl), "Saved.", "ok");
      }
    } catch (e) { const m = $(".rw-msg", form) || $("#rvOut", rootEl); if (m) say(m, /duplicate key/i.test(String(e.message)) ? "That one is already on the list." : R.errText(e), "bad"); }
  }

  async function onChange(ev) {
    const id = ev.target && ev.target.id;
    if (id === "cnApp") { rootEl.__newApp = ev.target.value; return show("campaigns"); }
    if (id === "rfApp" || id === "rfCamp" || id === "rfApproval") { st.filter.app = $("#rfApp", rootEl).value; st.filter.campaign = $("#rfCamp", rootEl).value; st.filter.approval = $("#rfApproval", rootEl).value; st.open = null; return show("review"); }
    if (id === "rfQ") { st.filter.q = ev.target.value; return show("review"); }
  }

  async function signedOut(root) {
    root.innerHTML = `<div id="rwGate"></div>`;
    R.mountGate($("#rwGate", root), { intro: "This area is for ZonicMe administrators. Sign in with your admin account.", note: "" });
  }
  async function signedIn(root) {
    rootEl = root;
    const { data: isAdmin, error } = await sb().rpc("outreach_is_admin");
    if (error || !isAdmin) {
      root.innerHTML = `<div class="rw-card"><h2>This area is for ZonicMe administrators</h2><p class="rw-lead">The account you are signed in with does not have admin access. If you should have it, ask the owner to grant it from the ZonicMe admin page.</p></div>`;
      return;
    }
    if (!root.__orBound) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("change", onChange); root.__orBound = true; }
    const h = (window.location.hash || "").replace("#", "");
    await show(TABS.some((t) => t[0] === h) ? h : "overview");
  }

  R.boot({ page: "outreach", signedOut, signedIn });
})();
