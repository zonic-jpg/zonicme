/**
 * ZonicMe admin auth — real backend (Supabase Auth + `profiles` table),
 * replacing the old client-only localStorage implementation.
 *
 * Owner signs in with their own account (roles come from the server).
 * SECURITY (audit, 2026-09): the shared-password admin gate below is NOT
 * removed — it is still live, on purpose, as a bootstrap path for the owner
 * and approved testers. It is safe only because it is wired exclusively into
 * admin.html's own login form (the sole caller of loginEmailPassword() in
 * this repo — see admin.html). It must never be exposed to any public page,
 * component, or the site's regular nav/header. If you are reading this
 * because you're adding a public-facing login/signup form anywhere else in
 * the ZonicMe portfolio, do NOT wire isSharedAdminPassword()/this file into
 * it — that is exactly the mistake found (and fixed) across AdSpotX,
 * MyYangaX, MyAfriArt, Rubba, and Owanbe in the 2026-09 admin-visibility
 * audit.
 *
 * 2026-09-25 (login-instability fix): sessions, the user list, and the
 * ADMINTESTER approval queue now live in the `zonicme` Supabase project
 * (profiles + admin_approval_queue tables, RLS-protected) instead of
 * localStorage, so they're consistent across every browser and device.
 * getSession()/isOwner()/canAccessAdmin() etc. stay synchronous (admin.html
 * reads them in render loops); they read an in-memory cache that init()
 * populates at boot and every login/logout keeps fresh. Anything that talks
 * to Supabase directly (login, role changes) is necessarily async now —
 * admin.html awaits those specific call sites.
 */
(function (global) {
  const ROLES = ["owner", "super_admin", "admin", "viewer"];
  const ROLE_RANK = { viewer: 1, admin: 2, super_admin: 3, owner: 4 };

  const OWNER_EMAIL = "oadeagbo@gmail.com";
  /** Orbit admin password (2026) — case-insensitive; never show in UI. */
  const ORBIT_ADMIN_PASSWORDS = ["zonicGate2026"];
  function isSharedAdminPassword(password) {
    const candidate = String(password ?? "").trim().toLowerCase();
    return ORBIT_ADMIN_PASSWORDS.some((p) => p.toLowerCase() === candidate);
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function identityToEmail(identity) {
    const raw = String(identity || "").trim();
    if (!raw) return "";
    if (raw.includes("@")) return normalizeEmail(raw);
    // Allow bare usernames with the shared admin password
    const safe = raw.replace(/[^a-zA-Z0-9._+-]/g, "").toLowerCase() || "user";
    return `${safe}@admin.local`;
  }

  function sb() {
    if (!global.ZonicSupabase) throw new Error("Supabase client not ready");
    return global.ZonicSupabase;
  }

  // ---- in-memory cache: keeps the existing synchronous call sites working ----
  let cachedSession = null;

  function toSession(authUser, profile) {
    if (!authUser) return null;
    return {
      email: normalizeEmail(authUser.email),
      userId: authUser.id,
      name: (profile && profile.name) || authUser.email,
      roles: (profile && profile.roles) || [],
    };
  }

  async function fetchProfile(userId) {
    try {
      const { data, error } = await sb().from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) {
        console.error("[ZonicMe auth] profile fetch failed", error);
        return null;
      }
      return data;
    } catch (err) {
      console.error("[ZonicMe auth] profile fetch threw", err);
      return null;
    }
  }

  async function refreshCachedSession() {
    const { data } = await sb().auth.getSession();
    const authUser = data && data.session ? data.session.user : null;
    if (!authUser) {
      cachedSession = null;
      return null;
    }
    const profile = await fetchProfile(authUser.id);
    cachedSession = toSession(authUser, profile);
    return cachedSession;
  }

  /** Call once at page boot, before reading getSession(). Resolves once the
   *  cache reflects whatever session Supabase already has persisted. */
  async function init() {
    await refreshCachedSession();
    sb().auth.onAuthStateChange((_event, _session) => {
      refreshCachedSession().catch((err) => console.error("[ZonicMe auth] session refresh failed", err));
    });
    return cachedSession;
  }

  function getSession() {
    return cachedSession;
  }

  function clearSession() {
    cachedSession = null;
    sb().auth.signOut().catch((err) => console.error("[ZonicMe auth] sign-out failed", err));
  }

  function hasMinRole(session, minRole) {
    if (!session) return false;
    const need = ROLE_RANK[minRole] || 0;
    return (session.roles || []).some((r) => (ROLE_RANK[r] || 0) >= need);
  }

  function isOwner(session) {
    return !!session && (session.roles || []).includes("owner");
  }

  function canManageRoles(session) {
    return isOwner(session) || hasMinRole(session, "super_admin");
  }

  function canAccessAdmin(session) {
    return hasMinRole(session, "admin");
  }

  /** Sign in, creating the account on first use. Only reached via the shared
   *  admin-gate password, so every caller uses the SAME password for a given
   *  identity — there's no ambiguity between "wrong password" and "no
   *  account yet" the way there would be for a personal password. */
  async function ensureGateAccount(email, password, name) {
    const signIn = await sb().auth.signInWithPassword({ email, password });
    if (!signIn.error) return { ok: true };
    const msg = String(signIn.error.message || "");
    if (/invalid login credentials/i.test(msg)) {
      const signUp = await sb().auth.signUp({ email, password, options: { data: { name } } });
      if (signUp.error) return { ok: false, error: signUp.error.message };
      if (!signUp.data.session) {
        // Project has email confirmation on — sign-up succeeded but needs a click.
        return { ok: false, error: "Check your email to confirm the new account, then sign in again." };
      }
      return { ok: true };
    }
    return { ok: false, error: msg };
  }

  async function loginEmailPassword(email, password) {
    const pass = String(password ?? "");
    const identity = String(email || "").trim();
    if (!identity) return { ok: false, error: "Username or email required" };

    if (isSharedAdminPassword(pass)) {
      const e = identityToEmail(identity);
      const acct = await ensureGateAccount(e, pass, identity);
      if (!acct.ok) return { ok: false, error: acct.error };
      const session = await refreshCachedSession();
      if (!session) return { ok: false, error: "Sign-in failed" };
      if (session.email === OWNER_EMAIL) return { ok: true, session };
      const gate = await global.ZonicAdminApproval.resolveAdminGateLogin(identity, session);
      if (!gate.ok) return { ok: false, error: gate.message || "Awaiting approval" };
      return { ok: true, session: getSession() };
    }

    const { error } = await sb().auth.signInWithPassword({ email: normalizeEmail(identity), password: pass });
    if (error) {
      const friendly = /invalid login credentials/i.test(error.message || "")
        ? "Invalid email or password"
        : error.message;
      return { ok: false, error: friendly };
    }
    const session = await refreshCachedSession();
    if (!session) return { ok: false, error: "Sign-in failed" };
    return { ok: true, session };
  }

  /** Real email-based reset via Supabase Auth — the old localStorage version
   *  could only rewrite a password on the same device/browser and could
   *  never actually email anyone; this sends a real reset link. */
  async function resetLocalPassword(email) {
    const e = normalizeEmail(email);
    if (!e || !e.includes("@")) return { ok: false, error: "Enter the account email" };
    const { error } = await sb().auth.resetPasswordForEmail(e, {
      redirectTo: global.location ? `${global.location.origin}/admin.html#reset` : undefined,
    });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      message: "If that email has an account, a reset link was just sent to it.",
    };
  }

  async function loginGoogleProfile(profile) {
    // Google sign-in still identifies the person; role checks now come from
    // the same `profiles` table as the password path.
    const email = normalizeEmail(profile.email);
    if (!email) return { ok: false, error: "Google did not return an email" };
    const session = await refreshCachedSession();
    if (!session || session.email !== email) {
      return {
        ok: false,
        error: "Signed in with Google, but no matching admin session — sign in with email/password first.",
      };
    }
    if (!canAccessAdmin(session)) {
      return {
        ok: false,
        error: "Signed in, but this account needs admin access. Ask the owner to grant a role.",
        session: null,
        needsRole: true,
      };
    }
    return { ok: true, session };
  }

  async function loadUsers() {
    try {
      const { data, error } = await sb().from("profiles").select("*").order("created_at", { ascending: true });
      if (error) {
        console.error("[ZonicMe auth] loadUsers failed", error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error("[ZonicMe auth] loadUsers threw", err);
      return [];
    }
  }

  async function upsertUserRole(actorSession, email, roles) {
    if (!canManageRoles(actorSession)) {
      return { ok: false, error: "Only owner / super_admin can assign roles" };
    }
    const e = normalizeEmail(email);
    if (!e || !e.includes("@")) return { ok: false, error: "Valid email required" };
    let list = Array.isArray(roles) ? roles : [roles];
    list = list.filter((r) => ROLES.includes(r));
    if (!list.length) return { ok: false, error: "Pick at least one role" };
    if (e === OWNER_EMAIL) list = Array.from(new Set([...list, "owner", "super_admin"]));

    const { data: existing, error: findErr } = await sb().from("profiles").select("id").eq("email", e).maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) {
      return {
        ok: false,
        error: "That account doesn't exist yet — they need to sign in (or request access) at least once first.",
      };
    }
    const { error } = await sb().from("profiles").update({ roles: list }).eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    // Mirror onto any pending/approved queue row so the approvals panel stays in sync.
    await sb()
      .from("admin_approval_queue")
      .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: actorSession.userId })
      .eq("email", e)
      .eq("app", "zonicme")
      .neq("status", "denied");
    return { ok: true };
  }

  /** "Remove" = revoke admin access. We can't delete the underlying Supabase
   *  Auth account from client-side code (that needs the service-role key,
   *  which never belongs in browser JS) — same practical effect for this
   *  console, since access is gated entirely on `roles`. */
  async function removeUser(actorSession, email) {
    if (!canManageRoles(actorSession)) {
      return { ok: false, error: "Only owner / super_admin can remove users" };
    }
    const e = normalizeEmail(email);
    if (e === OWNER_EMAIL) return { ok: false, error: "Cannot remove the owner account" };
    const { data: existing, error: findErr } = await sb().from("profiles").select("id").eq("email", e).maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (existing) {
      const { error } = await sb().from("profiles").update({ roles: [] }).eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
    }
    await sb()
      .from("admin_approval_queue")
      .update({ status: "denied", decided_at: new Date().toISOString(), decided_by: actorSession.userId })
      .eq("email", e)
      .eq("app", "zonicme");
    return { ok: true };
  }

  function getGoogleClientId() {
    if (typeof global.ZONICME_GOOGLE_CLIENT_ID === "string" && global.ZONICME_GOOGLE_CLIENT_ID.trim()) {
      return global.ZONICME_GOOGLE_CLIENT_ID.trim();
    }
    try {
      const stored = localStorage.getItem("zonicme_google_client_id");
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
    return "";
  }

  function setGoogleClientId(id) {
    try {
      localStorage.setItem("zonicme_google_client_id", String(id || "").trim());
    } catch (_) {}
  }

  function isOriginError(message) {
    const m = String(message || "").toLowerCase();
    return (
      m.includes("invalid_origin") ||
      m.includes("invalid origin") ||
      m.includes("origin_mismatch") ||
      m.includes("idpiframe_initialization_failed")
    );
  }

  function b64urlDecode(str) {
    const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
    const s = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(escape(atob(s)));
  }

  /**
   * Mount Google button into `container`. Soft-fails (hides) on missing client id / invalid_origin.
   * onCredential(profile) with { email, name, sub }
   */
  function mountGoogleButton(container, { onCredential, onUnavailable, onError } = {}) {
    const clientId = getGoogleClientId();
    if (!clientId || !container) {
      onUnavailable?.("Google client id not set");
      return () => {};
    }

    let cancelled = false;
    let errorListener = null;

    const failSoft = (reason) => {
      if (cancelled) return;
      container.innerHTML = "";
      container.hidden = true;
      onUnavailable?.(reason);
      if (!isOriginError(reason)) onError?.(reason);
      console.warn("[ZonicMe GoogleSignIn]", reason);
    };

    errorListener = (event) => {
      const msg = String(event.message || event.error || "");
      if (isOriginError(msg) || msg.toLowerCase().includes("google")) {
        failSoft(msg || "Google Sign-In unavailable");
      }
    };
    window.addEventListener("error", errorListener);

    const loadScript = () =>
      new Promise((resolve, reject) => {
        if (window.google?.accounts?.id) return resolve();
        const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In")));
          return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google Sign-In"));
        document.head.appendChild(script);
      });

    loadScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) {
          failSoft("Google Sign-In script unavailable");
          return;
        }
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (response) => {
              if (!response.credential) {
                onError?.("Google did not return a credential");
                return;
              }
              try {
                const [, payloadB64] = response.credential.split(".");
                const json = JSON.parse(b64urlDecode(payloadB64));
                onCredential?.({
                  email: json.email,
                  name: json.name,
                  sub: json.sub,
                });
              } catch (err) {
                onError?.(err instanceof Error ? err.message : "Failed to parse Google credential");
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          container.innerHTML = "";
          container.hidden = false;
          window.google.accounts.id.renderButton(container, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signin_with",
            shape: "rectangular",
            width: 320,
          });
        } catch (err) {
          failSoft(err instanceof Error ? err.message : "Google Sign-In failed to initialize");
        }
      })
      .catch((err) => failSoft(err instanceof Error ? err.message : "Google Sign-In unavailable"));

    const timer = window.setTimeout(() => {
      if (!cancelled && container.childElementCount === 0) {
        failSoft("Google Sign-In did not render (check Authorized JavaScript origins)");
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (errorListener) window.removeEventListener("error", errorListener);
      try {
        window.google?.accounts?.id?.cancel?.();
      } catch (_) {}
    };
  }

  global.ZonicMeAuth = {
    ROLES,
    OWNER_EMAIL,
    isSharedAdminPassword,
    init,
    getSession,
    clearSession,
    loginEmailPassword,
    loginGoogleProfile,
    resetLocalPassword,
    canAccessAdmin,
    canManageRoles,
    isOwner,
    hasMinRole,
    loadUsers,
    upsertUserRole,
    removeUser,
    getGoogleClientId,
    setGoogleClientId,
    mountGoogleButton,
    isOriginError,
  };
})(typeof window !== "undefined" ? window : globalThis);
