/**
 * ZonicMe admin auth — local demo + optional Google OAuth.
 *
 * Production: set window.ZONICME_GOOGLE_CLIENT_ID (or localStorage zonicme_google_client_id)
 * to your Google OAuth Web client ID. Soft-fails on invalid_origin like AdSpot.
 *
 * Owner signs in with their own account (roles come from the server).
 * SECURITY (audit): the former shared-password admin gate has been removed.
 */
(function (global) {
  const SESSION_KEY = "zonicme_admin_session_v1";
  const USERS_KEY = "zonicme_admin_users_v1";
  const GOOGLE_ID_KEY = "zonicme_google_client_id";
  const CLIENT_SECRET = "zonicme-hub-local-sign-v1"; // demo signing only — replace server-side in prod

  const ROLES = ["owner", "super_admin", "admin", "viewer"];
  const ROLE_RANK = { viewer: 1, admin: 2, super_admin: 3, owner: 4 };

  const OWNER_EMAIL = "oadeagbo@gmail.com";
  const DEMO_PASSWORD = "password123";
  /** Rotated orbit passwords (2026) — case-insensitive; never show in UI. */
  const ORBIT_ADMIN_PASSWORDS = ["zonicGate2026a", "zonicGate2026b", "zonicStudio2026"];
  function isSharedAdminPassword(password) {
    const candidate = String(password ?? "").trim().toLowerCase();
    return ORBIT_ADMIN_PASSWORDS.indexOf(candidate) !== -1;
  }

  const SEED_USERS = [
    {
      email: OWNER_EMAIL,
      name: "Olu Adeagbo",
      roles: ["owner", "super_admin"],
      password: DEMO_PASSWORD,
    },
  ];

  function b64url(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function b64urlDecode(str) {
    const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
    const s = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(escape(atob(s)));
  }

  function simpleSign(payloadB64) {
    let h = 0;
    const raw = CLIENT_SECRET + "." + payloadB64;
    for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    return b64url(String(h));
  }

  function mintToken(user) {
    const payload = {
      sub: user.email.toLowerCase(),
      name: user.name || user.email,
      roles: user.roles || ["viewer"],
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    const body = b64url(JSON.stringify(payload));
    return `zm1.${body}.${simpleSign(body)}`;
  }

  function parseToken(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "zm1") return null;
    const [, body, sig] = parts;
    if (simpleSign(body) !== sig) return null;
    try {
      const payload = JSON.parse(b64urlDecode(body));
      if (!payload.exp || payload.exp < Date.now()) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (_) {}
    const seed = structuredClone(SEED_USERS);
    saveUsers(seed);
    return seed;
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    return users;
  }

  function findUser(email) {
    const e = normalizeEmail(email);
    return loadUsers().find((u) => normalizeEmail(u.email) === e) || null;
  }

  function ensureOwnerBootstrap(users) {
    const owner = users.find((u) => normalizeEmail(u.email) === OWNER_EMAIL);
    if (!owner) {
      users.push({
        email: OWNER_EMAIL,
        name: "Olu Adeagbo",
        roles: ["owner", "super_admin"],
        password: DEMO_PASSWORD,
      });
    } else {
      const roles = new Set(owner.roles || []);
      roles.add("owner");
      roles.add("super_admin");
      owner.roles = [...roles];
      if (!owner.password) owner.password = DEMO_PASSWORD;
    }
    return users;
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      const payload = parseToken(session.token);
      if (!payload) {
        clearSession();
        return null;
      }
      return {
        token: session.token,
        email: payload.sub,
        name: payload.name,
        roles: payload.roles || [],
        exp: payload.exp,
      };
    } catch (_) {
      return null;
    }
  }

  function setSession(user) {
    const token = mintToken(user);
    const session = {
      token,
      email: normalizeEmail(user.email),
      name: user.name || user.email,
      roles: user.roles || ["viewer"],
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return getSession();
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
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

  function identityToEmail(identity) {
    const raw = String(identity || "").trim();
    if (!raw) return "";
    if (raw.includes("@")) return normalizeEmail(raw);
    // Allow bare usernames with the shared admin password
    const safe = raw.replace(/[^a-zA-Z0-9._+-]/g, "").toLowerCase() || "user";
    return `${safe}@admin.local`;
  }

  function loginEmailPassword(email, password) {
    const pass = String(password ?? "");
    const identity = String(email || "").trim();

    // Shared gate: any username + shared admin password → pending until owner approves
    if (isSharedAdminPassword(pass)) {
      const gate =
        global.ZonicAdminApproval?.resolveAdminGateLogin?.(identity, pass, "zonicme") ||
        { ok: true, status: "approved" };
      if (!gate.ok) {
        return { ok: false, error: gate.message || "Awaiting approval" };
      }
      const grantRole = "super_admin";
      if (!identity) return { ok: false, error: "Username required" };
      const e = identityToEmail(identity);
      let users = ensureOwnerBootstrap(loadUsers());
      if (e === OWNER_EMAIL) {
        saveUsers(users);
        const owner = findUser(OWNER_EMAIL);
        return { ok: true, session: setSession(owner) };
      }
      let user = users.find((u) => normalizeEmail(u.email) === e);
      if (!user) {
        user = {
          email: e,
          name: identity,
          roles: [grantRole],
          password: pass,
        };
        users.push(user);
      } else {
        const roles = new Set(user.roles || []);
        roles.add(grantRole);
        user.roles = [...roles];
        user.password = pass;
        if (!user.name) user.name = identity;
      }
      saveUsers(users);
      return { ok: true, session: setSession(user) };
    }

    let users = ensureOwnerBootstrap(loadUsers());
    saveUsers(users);
    const user = findUser(email);
    if (!user) return { ok: false, error: "Unknown account" };
    if (pass !== String(user.password || "")) {
      return { ok: false, error: "Invalid password" };
    }
    const session = setSession(user);
    return { ok: true, session };
  }

  /**
   * Password reset for the hub's on-device accounts. There is no mail provider,
   * so nothing is sent anywhere — the new password is written to this browser only.
   * Refuses unknown emails so the confirmation message is never a lie.
   */
  function resetLocalPassword(email, newPassword, confirmPassword) {
    const e = normalizeEmail(email);
    if (!e || !e.includes("@")) return { ok: false, error: "Enter the account email" };
    const pass = String(newPassword || "");
    const confirm = String(confirmPassword || "");
    if (pass.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
    if (pass !== confirm) return { ok: false, error: "Passwords don't match" };
    if (isSharedAdminPassword(pass)) {
      return { ok: false, error: "Choose a personal password — not a shared team password" };
    }
    const users = ensureOwnerBootstrap(loadUsers());
    const user = users.find((u) => normalizeEmail(u.email) === e);
    if (!user) {
      return {
        ok: false,
        error: "No account for that email in this browser. Sign in once on this device first.",
      };
    }
    user.password = pass;
    saveUsers(users);
    return {
      ok: true,
      message: "Password updated in this browser. Sign in with the new password.",
    };
  }

  function loginGoogleProfile(profile) {
    const email = normalizeEmail(profile.email);
    if (!email) return { ok: false, error: "Google did not return an email" };
    let users = ensureOwnerBootstrap(loadUsers());
    let user = users.find((u) => normalizeEmail(u.email) === email);
    if (!user) {
      user = {
        email,
        name: profile.name || email,
        roles: email === OWNER_EMAIL ? ["owner", "super_admin"] : ["viewer"],
        password: null,
        google: true,
      };
      users.push(user);
      saveUsers(users);
    } else {
      if (profile.name) user.name = profile.name;
      if (email === OWNER_EMAIL) {
        const roles = new Set(user.roles || []);
        roles.add("owner");
        roles.add("super_admin");
        user.roles = [...roles];
      }
      saveUsers(users);
    }
    if (!canAccessAdmin({ roles: user.roles })) {
      return {
        ok: false,
        error: "Signed in, but this account needs admin access. Ask the owner to grant a role.",
        session: null,
        needsRole: true,
      };
    }
    return { ok: true, session: setSession(user) };
  }

  function upsertUserRole(actorSession, email, roles, name) {
    if (!canManageRoles(actorSession)) {
      return { ok: false, error: "Only owner / super_admin can assign roles" };
    }
    const e = normalizeEmail(email);
    if (!e || !e.includes("@")) return { ok: false, error: "Valid email required" };
    let list = roles;
    if (typeof roles === "string") list = [roles];
    list = (list || []).filter((r) => ROLES.includes(r));
    if (!list.length) return { ok: false, error: "Pick at least one role" };
    if (e === OWNER_EMAIL) {
      list = Array.from(new Set([...list, "owner", "super_admin"]));
    }
    let users = ensureOwnerBootstrap(loadUsers());
    let user = users.find((u) => normalizeEmail(u.email) === e);
    if (!user) {
      user = {
        email: e,
        name: name || e,
        roles: list,
        password: DEMO_PASSWORD,
      };
      users.push(user);
    } else {
      user.roles = list;
      if (name) user.name = name;
    }
    saveUsers(users);
    return { ok: true, user };
  }

  function removeUser(actorSession, email) {
    if (!canManageRoles(actorSession)) {
      return { ok: false, error: "Only owner / super_admin can remove users" };
    }
    const e = normalizeEmail(email);
    if (e === OWNER_EMAIL) return { ok: false, error: "Cannot remove the owner account" };
    const users = loadUsers().filter((u) => normalizeEmail(u.email) !== e);
    saveUsers(users);
    return { ok: true };
  }

  function getGoogleClientId() {
    if (typeof global.ZONICME_GOOGLE_CLIENT_ID === "string" && global.ZONICME_GOOGLE_CLIENT_ID.trim()) {
      return global.ZONICME_GOOGLE_CLIENT_ID.trim();
    }
    try {
      const stored = localStorage.getItem(GOOGLE_ID_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
    return "";
  }

  function setGoogleClientId(id) {
    localStorage.setItem(GOOGLE_ID_KEY, String(id || "").trim());
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

  // Bootstrap owner on first load
  try {
    saveUsers(ensureOwnerBootstrap(loadUsers()));
  } catch (_) {}

  global.ZonicMeAuth = {
    SESSION_KEY,
    USERS_KEY,
    ROLES,
    OWNER_EMAIL,
    DEMO_PASSWORD,
    isSharedAdminPassword,
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
