/**
 * Zonic ADMINTESTER approval — ZonicMe.
 * Orbit standard: ~/Downloads/MyYangaX-COMPLETE/AUTH.md
 *
 * 2026-09-25 (login-instability fix): the approval queue now lives in the
 * `admin_approval_queue` Supabase table instead of localStorage, so a
 * request raised on one device is visible to the owner from any device —
 * that was the actual bug behind "the queue only shows requests made on
 * this browser."
 */
(function (global) {
  const OWNER_EMAIL = "oadeagbo@gmail.com";
  const AWAITING_MSG =
    "Access request recorded. The ZonicMe owner can approve it from any device — check back after they do.";

  function sb() {
    if (!global.ZonicSupabase) throw new Error("Supabase client not ready");
    return global.ZonicSupabase;
  }

  function isOwnerEmail(email) {
    return String(email ?? "").trim().toLowerCase() === OWNER_EMAIL;
  }

  function norm(email) {
    return String(email ?? "").trim().toLowerCase();
  }

  /** Called after a real Supabase sign-in already happened; `session` is the
   *  ZonicMeAuth session object (has userId, email, roles). */
  async function resolveAdminGateLogin(identity, session) {
    if (!session) return { ok: false, status: "invalid", message: "Sign-in failed" };
    if (isOwnerEmail(session.email)) return { ok: true, status: "owner" };
    if ((session.roles || []).some((r) => r === "owner" || r === "super_admin" || r === "admin")) {
      return { ok: true, status: "approved" };
    }

    const { data: existing, error } = await sb()
      .from("admin_approval_queue")
      .select("id,status")
      .eq("user_id", session.userId)
      .eq("app", "zonicme")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[ZonicMe approval] queue lookup failed", error);
      return { ok: false, status: "error", message: "Could not check approval status — try again." };
    }
    if (existing && existing.status === "denied") {
      return {
        ok: false,
        status: "revoked",
        message: "Admin access was revoked. Contact the owner to request access again.",
      };
    }
    if (!existing || existing.status !== "pending") {
      const { error: insertErr } = await sb().from("admin_approval_queue").insert({
        user_id: session.userId,
        identity: String(identity || "").trim(),
        email: session.email,
        app: "zonicme",
        status: "pending",
      });
      if (insertErr) console.error("[ZonicMe approval] queue insert failed", insertErr);
    }
    return { ok: false, status: "pending", message: AWAITING_MSG };
  }

  async function listPendingQueue(appFilter) {
    try {
      let query = sb().from("admin_approval_queue").select("*").eq("status", "pending").order("requested_at", { ascending: false });
      if (appFilter) query = query.eq("app", appFilter);
      const { data, error } = await query;
      if (error) {
        console.error("[ZonicMe approval] listPendingQueue failed", error);
        return [];
      }
      return (data || []).map((row) => ({
        email: row.email,
        identity: row.identity,
        app: row.app,
        requestedAt: row.requested_at,
      }));
    } catch (err) {
      console.error("[ZonicMe approval] listPendingQueue threw", err);
      return [];
    }
  }

  async function listApprovedAdmins() {
    try {
      const { data, error } = await sb()
        .from("profiles")
        .select("email,roles")
        .order("email", { ascending: true });
      if (error) {
        console.error("[ZonicMe approval] listApprovedAdmins failed", error);
        return [];
      }
      return (data || [])
        .filter((p) => !isOwnerEmail(p.email) && (p.roles || []).some((r) => r === "super_admin" || r === "admin"))
        .map((p) => ({ email: p.email }));
    } catch (err) {
      console.error("[ZonicMe approval] listApprovedAdmins threw", err);
      return [];
    }
  }

  /** actorSession is the owner's ZonicMeAuth session. */
  async function approveAdmin(actorSession, targetEmail) {
    if (!actorSession || !isOwnerEmail(actorSession.email)) {
      return { ok: false, error: "Only the owner can approve." };
    }
    const email = norm(targetEmail);
    const { data: profile, error: findErr } = await sb().from("profiles").select("id,roles").eq("email", email).maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!profile) return { ok: false, error: "No account found for that email yet." };
    const roles = Array.from(new Set([...(profile.roles || []), "super_admin"]));
    const { error: updateErr } = await sb().from("profiles").update({ roles }).eq("id", profile.id);
    if (updateErr) return { ok: false, error: updateErr.message };
    await sb()
      .from("admin_approval_queue")
      .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: actorSession.userId })
      .eq("email", email)
      .eq("app", "zonicme");
    return { ok: true, email };
  }

  async function revokeAdmin(actorSession, targetEmail) {
    if (!actorSession || !isOwnerEmail(actorSession.email)) {
      return { ok: false, error: "Only the owner can revoke." };
    }
    const email = norm(targetEmail);
    if (isOwnerEmail(email)) return { ok: false, error: "Cannot revoke owner." };
    const { data: profile, error: findErr } = await sb().from("profiles").select("id").eq("email", email).maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (profile) {
      const { error: updateErr } = await sb().from("profiles").update({ roles: [] }).eq("id", profile.id);
      if (updateErr) return { ok: false, error: updateErr.message };
    }
    await sb()
      .from("admin_approval_queue")
      .update({ status: "denied", decided_at: new Date().toISOString(), decided_by: actorSession.userId })
      .eq("email", email)
      .eq("app", "zonicme");
    return { ok: true, email };
  }

  global.ZonicAdminApproval = {
    OWNER_EMAIL,
    AWAITING_MSG,
    isOwnerEmail,
    resolveAdminGateLogin,
    listPendingQueue,
    listApprovedAdmins,
    approveAdmin,
    revokeAdmin,
  };
})(typeof window !== "undefined" ? window : globalThis);
