/** ZonicMe Creative Desk — admin review of what the creative-economy assistant drafts (creative-desk.html).
 *  The assistant can only add drafts. Review (approve, needs work, reject) is enforced in the database and
 *  is only open to a signed-in administrator. Nothing on this page publishes or contacts anyone. */
(function () {
  "use strict";
  const R = window.ZonicRewards;
  const { esc, num, $, $all, say } = R;
  const sb = () => window.ZonicSupabase;
  let rootEl = null, tab = "pending_review";
  const st = { items: [], open: null, filter: { kind: "", app: "", q: "" } };

  const KIND = { story: "Blog story", creative: "Emerging creative", opportunity: "Market opportunity", improvement: "App improvement" };
  const APPS = [["myyanga", "MyYanga"], ["myafriart", "MyAfriArt"], ["owanbe", "Owanbe"], ["adspot", "AdSpot"], ["rubba", "Rubba"], ["confirmahead", "ConfirmAhead"], ["sydef", "Sydef"], ["zonicme", "ZonicMe"]];
  const appName = (id) => (APPS.find((a) => a[0] === id) || [id, id || "All apps"])[1];
  const STATUS = { pending_review: "To review", approved: "Approved", needs_work: "Needs work", rejected: "Rejected" };
  const TABS = [["pending_review", "To review"], ["approved", "Approved"], ["needs_work", "Needs work"], ["rejected", "Rejected"], ["scorecard", "Scorecard"], ["notebook", "Focus and notebook"], ["runs", "Runs"]];
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;
  const table = (head, rows, empty) => rows.length
    ? `<div class="rw-scroll"><table class="rw-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="rw-empty">${empty}</p>`;
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");

  async function q(builder) { const { data, error } = await builder; if (error) throw error; return data || []; }
  const shown = () => { const t = st.filter.q.trim().toLowerCase(); return !t ? st.items : st.items.filter((i) => [i.title, i.summary, i.region].some((v) => String(v || "").toLowerCase().includes(t))); };

  // ---------------------------------------------------------------- review lists
  function itemRow(i) {
    return `<tr data-item="${i.id}" class="rw-click">
      <td><span class="rw-pill cd-kind">${esc(KIND[i.kind] || i.kind)}</span></td>
      <td><strong>${esc(i.title)}</strong><span class="rw-sub">${esc(String(i.summary || "").slice(0, 160))}${String(i.summary || "").length > 160 ? "…" : ""}</span></td>
      <td>${esc(appName(i.app))}<span class="rw-sub">${esc(i.region || "")}</span></td>
      <td>${i.confidence ? esc(String(i.confidence)) + " of 5" : "–"}</td>
      <td>${esc(R.dateOnly ? R.dateOnly(i.created_at) : String(i.created_at).slice(0, 10))}</td></tr>`;
  }
  function editorHtml(i) {
    const src = (Array.isArray(i.sources) ? i.sources : []).map((s) => { const u = safeUrl(s && s.url); return u ? `<li><a class="rw-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc((s && s.title) || u)}</a></li>` : ""; }).join("");
    return `<div class="rw-card" id="itemEditor"><h2>${esc(KIND[i.kind] || i.kind)} <span class="rw-pill ${i.status === "approved" ? "ok" : "warn"}">${esc(STATUS[i.status])}</span></h2>
      <p class="rw-hint">${esc(appName(i.app))}${i.region ? " · " + esc(i.region) : ""}${i.confidence ? " · the assistant's confidence: " + esc(String(i.confidence)) + " of 5" : ""}</p>
      ${i.why_it_matters ? `<p class="rw-lead"><strong>Why it matters.</strong> ${esc(i.why_it_matters)}</p>` : ""}
      <p class="rw-hint">Sources the assistant read. Open them before you approve.</p>
      ${src ? `<ul class="cd-src">${src}</ul>` : `<div class="rw-note"><strong>No sources were given.</strong> Treat this draft as unverified.</div>`}
      <form id="itemForm" class="rw-form" data-id="${i.id}">
        <label>Title<input id="ifTitle" value="${esc(i.title)}" required minlength="4" maxlength="200"></label>
        <label>Summary<textarea id="ifSummary" rows="4" required>${esc(i.summary || "")}</textarea></label>
        <label>Draft<textarea id="ifDraft" rows="14" class="cd-draft">${esc(i.draft || "")}</textarea></label>
        <label>Your note to the assistant (it reads these before its next run)<input id="ifNote" value="${esc(i.reviewer_note || "")}" maxlength="500" placeholder="For example: more East Africa, fewer listicles"></label>
        <div class="rw-actions">
          <button class="rw-btn ghost" data-do="save">Save changes</button>
          <button class="rw-btn" data-do="approved">Approve</button>
          <button class="rw-btn ghost" data-do="needs_work">Needs work</button>
          <button class="rw-btn warn" data-do="rejected">Reject</button>
          <button type="button" class="rw-btn ghost" data-act="copy">Copy draft</button>
        </div>
        <p class="rw-hint">Approving records your decision and counts towards the scorecard. It does not publish or send anything.</p>
        <p class="rw-msg" id="ifOut" role="status" aria-live="polite"></p>
      </form></div>`;
  }
  async function listHtml(status) {
    let b = sb().from("desk_items").select("*").eq("status", status).order("created_at", { ascending: false }).limit(300);
    if (st.filter.kind) b = b.eq("kind", st.filter.kind);
    if (st.filter.app) b = b.eq("app", st.filter.app);
    st.items = await q(b);
    const f = st.filter, rows = shown(), open = st.open && st.items.find((i) => i.id === st.open);
    return `<div class="rw-card"><h2>${esc(STATUS[status])}</h2>
      <div class="rw-form rw-inline">
        <label>Type<select id="cfKind"><option value="">All</option>${Object.keys(KIND).map((k) => opt(k, KIND[k], f.kind)).join("")}</select></label>
        <label>Application<select id="cfApp"><option value="">All</option>${APPS.map((a) => opt(a[0], a[1], f.app)).join("")}</select></label>
        <label>Search<input id="cfQ" value="${esc(f.q)}" placeholder="Title, summary or region"></label>
      </div>
      ${table(["Type", "Draft", "For", "Confidence", "Added"], rows.map(itemRow), status === "pending_review" ? "Nothing is waiting. New drafts arrive after the assistant's next run." : "Nothing here yet.")}
      <p class="rw-hint">${num(rows.length)} shown. Click a row to read it, open its sources and decide.</p></div>
      ${open ? editorHtml(open) : ""}`;
  }

  // ---------------------------------------------------------------- scorecard, notebook, runs
  async function scorecardHtml() {
    const [score, items, runs] = await Promise.all([
      q(sb().rpc("desk_scorecard")),
      q(sb().from("desk_items").select("run_id,status").limit(5000)),
      q(sb().from("desk_runs").select("id,started_at,trigger").order("started_at", { ascending: false }).limit(20)),
    ]);
    const tot = score.reduce((a, r) => ({ total: a.total + Number(r.total), approved: a.approved + Number(r.approved), needs: a.needs + Number(r.needs_work), rejected: a.rejected + Number(r.rejected), waiting: a.waiting + Number(r.waiting) }), { total: 0, approved: 0, needs: 0, rejected: 0, waiting: 0 });
    const decided = tot.approved + tot.needs + tot.rejected;
    const byRun = runs.map((r) => { const mine = items.filter((i) => i.run_id === r.id), d = mine.filter((i) => i.status !== "pending_review").length, a = mine.filter((i) => i.status === "approved").length;
      return `<tr><td>${esc(R.dateTime(r.started_at))}</td><td>${num(mine.length)}</td><td>${num(d)}</td><td>${num(a)}</td><td>${pct(a, d)}</td></tr>`; });
    return `<div class="rw-stats">
        <div class="rw-stat big"><div class="l">Approved, of those you decided</div><div class="v">${pct(tot.approved, decided)}</div><div class="s">${num(tot.approved)} of ${num(decided)} decided</div></div>
        <div class="rw-stat"><div class="l">Waiting for you</div><div class="v">${num(tot.waiting)}</div><div class="s">Not counted until decided</div></div>
        <div class="rw-stat"><div class="l">Needs work</div><div class="v">${num(tot.needs)}</div><div class="s">Close, but not usable as written</div></div>
        <div class="rw-stat"><div class="l">Rejected</div><div class="v">${num(tot.rejected)}</div><div class="s">Off target or wrong</div></div>
      </div>
      <div class="rw-card"><h2>By type</h2>${table(["Type", "Drafts", "Approved", "Needs work", "Rejected", "Approval rate", "Confidence when approved", "Confidence when rejected"],
        score.map((r) => { const d = Number(r.approved) + Number(r.needs_work) + Number(r.rejected); return `<tr><td>${esc(KIND[r.kind] || r.kind)}</td><td>${num(r.total)}</td><td>${num(r.approved)}</td><td>${num(r.needs_work)}</td><td>${num(r.rejected)}</td><td>${pct(Number(r.approved), d)}</td><td>${r.avg_confidence_approved == null ? "–" : esc(String(r.avg_confidence_approved))}</td><td>${r.avg_confidence_rejected == null ? "–" : esc(String(r.avg_confidence_rejected))}</td></tr>`; }),
        "No drafts yet.")}
        <p class="rw-hint">A well-calibrated assistant is more confident about what you approve than about what you reject. If the two confidence columns are close, its confidence scores are not telling you much.</p></div>
      <div class="rw-card"><h2>By run</h2>${table(["Run", "Drafts", "Decided", "Approved", "Approval rate"], byRun, "No runs yet.")}</div>`;
  }
  async function notebookHtml() {
    const n = (await q(sb().from("desk_notebook").select("*").eq("id", 1)))[0] || {};
    return `<div class="rw-card"><h2>Focus and notebook</h2>
      <p class="rw-lead">The assistant reads all three boxes before every run. You set the focus. It keeps the watchlist and lessons up to date after each run, and you can correct them.</p>
      <form id="nbForm" class="rw-form">
        <label>Focus: what to cover and where<textarea id="nbFocus" rows="6" required>${esc(n.focus || "")}</textarea></label>
        <label>Watchlist: people, brands, events and sources it is following<textarea id="nbWatch" rows="10">${esc(n.watchlist || "")}</textarea></label>
        <label>Lessons: what your decisions have taught it<textarea id="nbLessons" rows="8">${esc(n.lessons || "")}</textarea></label>
        <div class="rw-actions"><button class="rw-btn" id="nbBtn">Save</button></div><p class="rw-msg" id="nbOut" role="status" aria-live="polite"></p>
      </form>
      <p class="rw-hint">Last updated ${esc(n.updated_at ? R.dateTime(n.updated_at) : "never")}.</p></div>`;
  }
  async function runsHtml() {
    const rows = await q(sb().from("desk_runs").select("*").order("started_at", { ascending: false }).limit(60));
    const how = { scheduled: "On schedule", on_request: "On request", first_run: "First run" };
    return `<div class="rw-card"><h2>Runs</h2>${table(["Started", "How", "Drafts added", "What it covered"], rows.map((r) => `<tr><td>${esc(R.dateTime(r.started_at))}</td><td>${esc(how[r.trigger] || r.trigger)}</td><td>${num(r.items_added)}</td><td>${esc(r.summary || "")}</td></tr>`), "The assistant has not run yet.")}
      <p class="rw-hint">It runs every morning. To run it now, tell Claude "run the creative desk".</p></div>`;
  }

  // ---------------------------------------------------------------- drawing and events
  async function show(next) {
    tab = next || tab;
    rootEl.innerHTML = `<div class="rw-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" class="rw-tab${t[0] === tab ? " is-on" : ""}" aria-selected="${t[0] === tab}" data-tab="${t[0]}">${t[1]}</button>`).join("")}</div>
      <div id="cdBody"><div class="rw-card rw-sk" aria-hidden="true"><span class="sk sk-heading"></span><span class="sk sk-line"></span></div></div>`;
    try {
      const html = STATUS[tab] ? await listHtml(tab) : tab === "scorecard" ? await scorecardHtml() : tab === "notebook" ? await notebookHtml() : await runsHtml();
      $("#cdBody", rootEl).innerHTML = html;
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", "#" + tab);
    } catch (e) { $("#cdBody", rootEl).innerHTML = `<div class="rw-note"><strong>This screen could not load.</strong> ${esc(R.errText(e))}</div>`; }
  }

  async function onClick(ev) {
    const t = ev.target.closest("[data-tab],[data-act],tr[data-item]"); if (!t) return;
    if (t.dataset.tab) { st.open = null; return show(t.dataset.tab); }
    if (t.matches("tr[data-item]")) { st.open = t.dataset.item; await show(tab); const ed = $("#itemEditor", rootEl); if (ed) ed.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (t.dataset.act === "copy") {
      const out = $("#ifOut", rootEl), text = ($("#ifTitle", rootEl).value + "\n\n" + $("#ifDraft", rootEl).value).trim();
      try { await navigator.clipboard.writeText(text); say(out, "Copied.", "ok"); } catch (e) { say(out, "Your browser did not allow copying. Select the text and copy it by hand.", "bad"); }
    }
  }

  async function onSubmit(ev) {
    const form = ev.target; ev.preventDefault();
    const doWhat = (ev.submitter && ev.submitter.dataset.do) || "save";
    try {
      if (form.id === "itemForm") {
        const out = $("#ifOut", form), id = form.dataset.id;
        const patch = { title: $("#ifTitle", form).value.trim(), summary: $("#ifSummary", form).value.trim(), draft: $("#ifDraft", form).value.trim() || null, reviewer_note: $("#ifNote", form).value.trim() || null };
        if (doWhat !== "save") patch.status = doWhat;
        const { error } = await sb().from("desk_items").update(patch).eq("id", id);
        if (error) return say(out, error.message, "bad");
        const word = doWhat === "save" ? "Saved." : doWhat === "approved" ? "Approved." : doWhat === "needs_work" ? "Marked as needs work." : "Rejected.";
        if (doWhat !== "save") st.open = null;
        await show(tab); say($("#ifOut", rootEl) || $(".rw-hint", rootEl), word, "ok");
      } else if (form.id === "nbForm") {
        const focus = $("#nbFocus", form).value.trim();
        if (focus.length < 20) return say($("#nbOut", form), "Say a little more about what to focus on.", "bad");
        await q(sb().from("desk_notebook").update({ focus, watchlist: $("#nbWatch", form).value.trim(), lessons: $("#nbLessons", form).value.trim(), updated_at: new Date().toISOString() }).eq("id", 1).select("id"));
        say($("#nbOut", form), "Saved. The assistant will use this on its next run.", "ok");
      }
    } catch (e) { const m = $(".rw-msg", form); if (m) say(m, R.errText(e), "bad"); }
  }

  async function onChange(ev) {
    const id = ev.target && ev.target.id;
    if (id === "cfKind" || id === "cfApp") { st.filter.kind = $("#cfKind", rootEl).value; st.filter.app = $("#cfApp", rootEl).value; st.open = null; return show(tab); }
    if (id === "cfQ") { st.filter.q = ev.target.value; return show(tab); }
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
    if (!root.__cdBound) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("change", onChange); root.__cdBound = true; }
    const h = (window.location.hash || "").replace("#", "");
    await show(TABS.some((t) => t[0] === h) ? h : "pending_review");
  }

  R.boot({ page: "creative-desk", signedOut, signedIn });
})();
