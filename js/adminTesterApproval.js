/**
 * ZonicMe sign-up approvals (portfolio rules).
 *
 * - The owner is recognised by VERIFIED email (oadeagbo@gmail.com) on the server. No shared password.
 * - Default: everyone signs in straight away. The owner can switch "require approval" on; it then holds
 *   ONLY admin/tester sign-ups (never ordinary visitors).
 * - People who want admin access sign up / sign in, then press "Request admin access". The owner is emailed a
 *   link that opens this console on the approvals tab; granting is one click.
 *
 * All state lives in Supabase (project zonicme): signup_policy + signup_approvals, changed only through
 * SECURITY DEFINER functions that check the caller is the verified owner.
 */
(function (global) {
  const OWNER_EMAIL = "oadeagbo@gmail.com";

  function sb() {
    if (!global.ZonicSupabase) throw new Error("Supabase client not ready");
    return global.ZonicSupabase;
  }

  function isOwnerEmail(email) {
    return String(email ?? "").trim().toLowerCase() === OWNER_EMAIL;
  }

  async function rpc(fn, args) {
    const { data, error } = await sb().rpc(fn, args || {});
    if (error) throw new Error(error.message);
    return data;
  }

  /** Fire-and-forget email to the owner. The in-app queue works even if this fails. */
  async function notifyOwner(kind) {
    try {
      await sb().functions.invoke("notify-owner-approval", { body: { kind } });
    } catch (err) {
      console.warn("[ZonicMe approval] owner email not sent", err);
    }
  }

  /** Records the account; fails open so a missing function never blocks a visitor. */
  async function registerSignup(requestedRole) {
    try {
      const res = await rpc("register_signup", { _requested_role: requestedRole === "admin" ? "admin" : "member" });
      if (res && res.status === "pending") notifyOwner("signup");
      return res || { status: "approved" };
    } catch (err) {
      console.warn("[ZonicMe approval] register_signup unavailable", err);
      return { status: "approved" };
    }
  }

  async function requestAdminAccess() {
    const res = await rpc("request_admin_access");
    if (res && res.status === "requested") notifyOwner("admin_request");
    return res || { status: "requested" };
  }

  /** Owner only. Returns { require_approvals, pending, admin_requests, members, rejected }. */
  async function loadOverview() {
    try {
      return await rpc("list_signup_approvals");
    } catch (err) {
      console.error("[ZonicMe approval] list failed", err);
      return { error: err.message, require_approvals: false, pending: [], admin_requests: [], members: [], rejected: [] };
    }
  }

  async function setRequireApprovals(on) {
    try {
      await rpc("set_require_approvals", { _on: !!on });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function decide(userId, decision, role) {
    try {
      await rpc("decide_signup", { _user_id: userId, _decision: decision, _role: role || "member" });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function setRole(userId, role) {
    try {
      await rpc("set_member_role", { _user_id: userId, _role: role });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  global.ZonicAdminApproval = {
    OWNER_EMAIL,
    isOwnerEmail,
    notifyOwner,
    registerSignup,
    requestAdminAccess,
    loadOverview,
    setRequireApprovals,
    decide,
    setRole,
  };
})(typeof window !== "undefined" ? window : globalThis);
