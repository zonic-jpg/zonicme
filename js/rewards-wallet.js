/** ZonicMe Rewards — User Wallet (wallet.html). Draws what the database returns; changes nothing by itself. */
(function () {
  "use strict";
  const R = window.ZonicRewards;
  const { esc, num, pts, $, say } = R;
  let wallet = null;
  let nextBefore = null;

  const STEPS = `
    <div class="rw-steps">
      <div class="rw-step"><h3>Earn in the apps</h3><p>When you complete a purchase or an activity in a ZonicMe app, the app tells ZonicMe and your points are added. MyYangaX, MyAfriArt and AdSpot are taking part first.</p></div>
      <div class="rw-step"><h3>One balance</h3><p>Everything you earn lands in one wallet, matched by your email address. Use the same email here that you use in the apps.</p></div>
      <div class="rw-step"><h3>Gift and redeem</h3><p>Send points to a friend by email, and redeem them once redemption opens. Every movement is listed in your history.</p></div>
    </div>`;

  async function signedOut(root) {
    root.innerHTML = STEPS + `<div class="rw-two"><div id="rwGate"></div>
      <div class="rw-card">
        <h2>Your wallet is waiting</h2>
        <p class="rw-lead">Sign in to see your balance, your full history and the offers running now.</p>
        <p class="rw-lead">New here? Create a free ZonicMe account with the email address you use in the apps. Points you have already earned under that email will be there when you sign in.</p>
        <p class="rw-lead">Points are only added by the apps themselves after a completed purchase or activity. They cannot be bought or added by hand.</p>
      </div></div>`;
    R.mountGate($("#rwGate", root), {
      intro: "Sign in with your ZonicMe account to open your wallet.",
      note: "Use the same email address you use in MyYangaX, MyAfriArt or AdSpot.",
    });
  }

  function valueLine(total, s) {
    if (!s || !s.point_value_minor) return "Points do not have a cash value yet";
    return "Worth about " + R.money(Number(total) * Number(s.point_value_minor), s.value_currency);
  }

  function offersHtml(w) {
    const items = [];
    (w.always_on || []).forEach((r) => {
      const app = (w.apps || []).find((a) => a.app_id === r.app_id);
      items.push(`<div class="rw-item"><div class="rw-item-head"><h3>${esc(r.name)}</h3><span class="rw-pill ok">${esc(app ? app.name : "Every app")}</span></div>
        ${r.description ? `<p class="rw-meta">${esc(r.description)}</p>` : ""}${r.ends_at ? `<p class="rw-meta">Until ${esc(R.dateOnly(r.ends_at))}</p>` : ""}</div>`);
    });
    (w.campaigns || []).forEach((c) => {
      const names = (c.applications || []).map((id) => { const a = (w.apps || []).find((x) => x.app_id === id); return a ? a.name : id; });
      items.push(`<div class="rw-item"><div class="rw-item-head"><h3>${esc(c.name)}</h3><span class="rw-pill warn">${esc(c.brand || "Brand offer")}</span></div>
        ${c.description ? `<p class="rw-meta">${esc(c.description)}</p>` : ""}
        ${(c.offers || []).map((o) => `<p class="rw-meta"><strong>${esc(o.name)}</strong>${o.description ? " — " + esc(o.description) : ""}</p>`).join("")}
        <p class="rw-meta">In: ${esc(names.join(", ") || "selected apps")}${c.ends_at ? " · until " + esc(R.dateOnly(c.ends_at)) : ""}</p></div>`);
    });
    if (!items.length) {
      return `<p class="rw-empty">No reward offers are running right now. When ZonicMe or a brand starts one, it will show up here, and you will not need to do anything to join.</p>`;
    }
    return items.join("");
  }

  function linkedHtml(w) {
    const linked = (w.account.linked_applications || []);
    const live = (w.apps || []).filter((a) => a.status === "active");
    if (!linked.length) {
      const names = live.map((a) => a.name).join(", ");
      return `<p class="rw-empty">No app has reported activity for <strong>${esc(R.session ? R.session.email : "your email")}</strong> yet.
        Use this same email address in ${esc(names || "the ZonicMe apps")} and your points will appear here on their own.</p>`;
    }
    return `<div class="rw-pills">${(w.apps || []).filter((a) => linked.indexOf(a.app_id) >= 0)
      .map((a) => `<span class="rw-pill ok">${esc(a.name)}</span>`).join("")}</div>
      <p class="rw-hint">These apps have added points to your wallet.</p>`;
  }

  function giftHtml(w) {
    const s = w.settings || {};
    if (!s.gifting_enabled) return `<p class="rw-empty">Gifting is switched off for now. Your points are safe.</p>`;
    if (w.account.status !== "active") return `<p class="rw-empty">Gifting is not available while your wallet is on hold.</p>`;
    if (Number(w.account.points_balance) < 1) {
      return `<p class="rw-empty">You can send a gift once you have earned points of your own. Gift credit you received from someone else cannot be passed on.</p>`;
    }
    const left = Math.max(Number(s.gift_daily_limit_points) - Number(w.gifted_today || 0), 0);
    return `<form class="rw-form" id="giftForm" novalidate>
        <label for="giftEmail">Their email address</label>
        <input id="giftEmail" type="email" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="200" placeholder="friend@example.com">
        <label for="giftPoints">How many points</label>
        <input id="giftPoints" type="text" inputmode="numeric" maxlength="9" placeholder="For example 100">
        <label for="giftMsg">Message (optional)</label>
        <input id="giftMsg" type="text" maxlength="280" placeholder="A short note">
        <p class="rw-hint">You have ${pts(w.account.points_balance)} you can gift. Daily limit: ${num(s.gift_daily_limit_points)} points, ${num(left)} left today. A gift cannot be undone.</p>
        <div class="rw-actions"><button class="rw-btn" type="submit" id="giftBtn">Send gift</button></div>
        <p class="rw-msg" id="giftOut" role="status" aria-live="polite"></p>
      </form>`;
  }

  function redeemHtml(w) {
    const s = w.settings || {};
    if (!s.redemption_enabled) {
      return `<p class="rw-empty">Redeeming is not open yet. Your points are safe and keep adding up, and this page will show a redeem form as soon as ZonicMe switches it on.</p>`;
    }
    if (w.account.status !== "active") return `<p class="rw-empty">Redeeming is not available while your wallet is on hold.</p>`;
    const live = (w.apps || []).filter((a) => a.status === "active");
    return `<form class="rw-form" id="redeemForm" novalidate>
        <label for="redeemPoints">How many points</label>
        <input id="redeemPoints" type="text" inputmode="numeric" maxlength="9" placeholder="At least ${esc(num(s.min_redeem_points))}">
        <label for="redeemApp">Where you will use it</label>
        <select id="redeemApp"><option value="">Any ZonicMe app</option>${live.map((a) => `<option value="${esc(a.app_id)}">${esc(a.name)}</option>`).join("")}</select>
        <p class="rw-hint">One point is worth ${esc(R.money(s.point_value_minor, s.value_currency))}. The smallest amount you can redeem is ${pts(s.min_redeem_points)}.
          You will get a code to use in the app. Gift credit is used first.</p>
        <div class="rw-actions"><button class="rw-btn" type="submit" id="redeemBtn">Redeem points</button></div>
        <p class="rw-msg" id="redeemOut" role="status" aria-live="polite"></p>
        <div id="redeemCode"></div>
      </form>`;
  }

  function historyRow(it) {
    const credit = it.bucket === "gift_credit";
    let what = "", sub = [];
    if (it.tx_type === "earn") {
      what = "Earned" + (it.rule ? ": " + it.rule : "");
      if (it.app_name || it.source_app) sub.push(it.app_name || it.source_app);
      if (it.campaign) sub.push(it.campaign + (it.brand ? " by " + it.brand : ""));
    } else if (it.tx_type === "redeem") {
      what = "Redeemed" + (it.redemption_code ? " · code " + it.redemption_code : "");
      if (it.redemption_status) sub.push(it.redemption_status === "fulfilled" ? "Used" : it.redemption_status === "issued" ? "Code not used yet" : "Reversed");
      if (it.app_name) sub.push(it.app_name);
    } else if (it.tx_type === "gift_sent") {
      what = "Gift sent" + (it.counterparty ? " to " + it.counterparty : "");
      if (it.gift_message) sub.push("“" + it.gift_message + "”");
    } else if (it.tx_type === "gift_received") {
      what = "Gift received" + (it.counterparty ? " from " + it.counterparty : "");
      if (it.campaign) sub.push(it.campaign);
      if (it.gift_message) sub.push("“" + it.gift_message + "”");
    } else if (it.tx_type === "expire") {
      what = "Expired";
    } else {
      what = "Adjusted by ZonicMe";
      if (it.reason) sub.push(it.reason);
    }
    if (credit) sub.push("gift credit");
    if (it.expires_at && Number(it.amount) > 0) sub.push("expires " + R.dateOnly(it.expires_at));
    const amt = Number(it.amount);
    return `<tr><td>${esc(R.dateTime(it.created_at))}</td>
      <td>${esc(what)}${sub.length ? `<span class="rw-sub">${esc(sub.join(" · "))}</span>` : ""}</td>
      <td class="n"><span class="${amt >= 0 ? "rw-plus" : "rw-minus"}">${amt >= 0 ? "+" : "−"}${num(Math.abs(amt))}</span></td>
      <td class="n">${num(it.balance_after)}</td></tr>`;
  }

  async function loadHistory(reset) {
    const body = $("#histBody"), more = $("#histMore"), out = $("#histOut"), empty = $("#histEmpty"), table = $("#histTable");
    if (!body) return;
    if (reset) { nextBefore = null; body.innerHTML = ""; }
    try {
      const args = { limit: 25 };
      if (nextBefore) args.before = nextBefore;
      const h = await R.call("history", args);
      const items = h.items || [];
      body.insertAdjacentHTML("beforeend", items.map(historyRow).join(""));
      nextBefore = h.next_before || null;
      const has = body.children.length > 0;
      table.classList.toggle("hidden", !has);
      empty.classList.toggle("hidden", has);
      more.classList.toggle("hidden", !nextBefore);
      say(out, "");
    } catch (e) {
      say(out, R.errText(e), "bad");
    }
  }

  function paint(root, w) {
    const a = w.account, s = w.settings || {};
    const hold = a.status !== "active"
      ? `<div class="rw-note"><strong>Your wallet is on hold.</strong> Your points are safe, but earning, gifting and redeeming are paused. Please contact hello@zonicme.com.ng.</div>` : "";
    const badges = (w.badges || []).length
      ? `<div class="rw-card"><h2>Badges</h2><div class="rw-pills">${w.badges.map((b) => `<span class="rw-pill ok" title="${esc(R.dateOnly(b.awarded_at))}">${esc(b.label)}</span>`).join("")}</div></div>` : "";
    root.innerHTML = `${hold}
      <div class="rw-stats">
        <div class="rw-stat big"><div class="l">Your points</div><div class="v" id="wTotal">${num(a.total)}</div><div class="s">${esc(valueLine(a.total, s))}</div></div>
        <div class="rw-stat"><div class="l">Points you earned</div><div class="v">${num(a.points_balance)}</div><div class="s">Yours to gift or redeem</div></div>
        <div class="rw-stat"><div class="l">Gift credit</div><div class="v">${num(a.gift_credit_balance)}</div><div class="s">Received as gifts</div></div>
        <div class="rw-stat"><div class="l">Earned so far</div><div class="v">${num(a.lifetime_earned)}</div><div class="s">Redeemed: ${num(a.lifetime_redeemed)}</div></div>
      </div>
      <div class="rw-two">
        <div class="rw-card"><h2>Where your points come from</h2>${linkedHtml(w)}</div>
        <div class="rw-card"><h2>Ways to earn now</h2>${offersHtml(w)}</div>
      </div>
      <div class="rw-two">
        <div class="rw-card"><h2>Send a gift</h2><p class="rw-lead">Send some of your earned points to another person. They land as gift credit in their wallet, even if they have not signed up yet.</p>${giftHtml(w)}</div>
        <div class="rw-card"><h2>Redeem</h2><p class="rw-lead">Turn points into value inside a ZonicMe app.</p>${redeemHtml(w)}</div>
      </div>
      ${badges}
      <div class="rw-card">
        <h2>History</h2>
        <p class="rw-lead">Every time your balance changed, newest first. Entries are never edited or removed.</p>
        <p class="rw-empty hidden" id="histEmpty">Nothing here yet. Points appear as soon as one of the apps reports a completed purchase or activity under your email address.</p>
        <div class="rw-scroll"><table class="rw-table hidden" id="histTable">
          <thead><tr><th>When</th><th>What happened</th><th class="n">Points</th><th class="n">Balance</th></tr></thead>
          <tbody id="histBody"></tbody></table></div>
        <div class="rw-actions"><button type="button" class="rw-btn ghost hidden" id="histMore">Show older entries</button></div>
        <p class="rw-msg" id="histOut" role="status"></p>
      </div>`;

    const more = $("#histMore", root);
    if (more) more.addEventListener("click", () => loadHistory(false));

    const gf = $("#giftForm", root);
    if (gf) gf.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const out = $("#giftOut", root), btn = $("#giftBtn", root);
      const email = $("#giftEmail", root).value.trim(), raw = $("#giftPoints", root).value.trim().replace(/,/g, "");
      if (!email || email.indexOf("@") < 1) return say(out, "Enter the email address of the person you want to gift.", "bad");
      if (!/^[0-9]{1,9}$/.test(raw) || Number(raw) < 1) return say(out, "Enter a whole number of points to send.", "bad");
      const r = await R.withBusy(btn, out, "Sending…", () => R.call("gift", { email, points: Number(raw), message: $("#giftMsg", root).value.trim() }));
      if (r) {
        const done = "Sent " + pts(r.points) + " to " + (r.recipient || "them") + ".";
        await refresh(root);
        say($("#giftOut", root), done, "ok");
      }
    });

    const rf = $("#redeemForm", root);
    if (rf) rf.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const out = $("#redeemOut", root), btn = $("#redeemBtn", root);
      const raw = $("#redeemPoints", root).value.trim().replace(/,/g, "");
      if (!/^[0-9]{1,9}$/.test(raw) || Number(raw) < 1) return say(out, "Enter a whole number of points to redeem.", "bad");
      const r = await R.withBusy(btn, out, "Redeeming…", () => R.call("redeem", { points: Number(raw), app_id: $("#redeemApp", root).value }));
      if (r && r.redemption) {
        const rd = r.redemption;
        await refresh(root);
        const box = $("#redeemCode", root);
        if (box) box.innerHTML = `<div class="rw-note calm" style="margin-top:14px"><strong>Your code</strong><div class="rw-code">${esc(rd.code)}</div>
          ${pts(rd.points)} · worth ${esc(R.money(rd.value_minor, rd.value_currency))}. Enter or show this code in the app. It works once. You can find it again in your history.</div>`;
      }
    });
  }

  async function refresh(root) {
    const w = await R.call("wallet");
    wallet = w;
    R.setAccess({ is_admin: w.is_admin, brand_count: w.brand_count });
    if (!w.account) {
      root.innerHTML = `<div class="rw-note"><strong>One more step.</strong> Your wallet opens once your email address is confirmed.
        Open the confirmation link we emailed you when you created your account, then sign in again.
        If you have already done that and still see this message, write to hello@zonicme.com.ng and we will sort it out.</div>`;
      return;
    }
    paint(root, w);
    await loadHistory(true);
  }

  async function signedIn(root) {
    await refresh(root);
  }

  R.boot({ page: "wallet", signedOut, signedIn });
})();
