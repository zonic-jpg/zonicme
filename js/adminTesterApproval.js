/**
 * Zonic ADMINTESTER approval — ZonicMe (browser).
 * Orbit standard: ~/Downloads/MyYangaX-COMPLETE/AUTH.md
 */
(function (global) {
  const OWNER_EMAIL = "oadeagbo@gmail.com";
  const APPROVAL_STORE_KEY = "zonic_admintester_approval_v1";
  /**
   * The approval store is localStorage, so a request only exists in the browser it
   * was made from and nothing is emailed. Say exactly that — do not promise a
   * notification or a central queue this implementation cannot deliver.
   */
  const AWAITING_MSG =
    "Access request recorded on this device. Approvals are stored per browser and nothing is sent automatically, so ask the ZonicMe owner to approve you on this computer.";

  /** Orbit admin password (2026) — case-insensitive; never show in UI. */
  const ORBIT_ADMIN_PASSWORDS = ["zonicGate2026"];
  function isSharedAdminPassword(password) {
    const candidate = String(password ?? "").trim().toLowerCase();
    return ORBIT_ADMIN_PASSWORDS.some((p) => p.toLowerCase() === candidate);
  }

  function isOwnerEmail(email) {
    return String(email ?? "").trim().toLowerCase() === OWNER_EMAIL;
  }

  function identityToEmail(identity) {
    const raw = String(identity || "").trim();
    if (!raw) return "";
    if (raw.includes("@")) return raw.toLowerCase();
    const safe = raw.replace(/[^a-zA-Z0-9._+-]/g, "").toLowerCase() || "user";
    return `${safe}@admin.local`;
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(APPROVAL_STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { pending: [], approved: [], revoked: [] };
  }

  function saveStore(store) {
    try {
      localStorage.setItem(APPROVAL_STORE_KEY, JSON.stringify(store));
    } catch (_) {}
  }

  function norm(email) {
    return identityToEmail(email);
  }

  function isRevoked(email) {
    return loadStore().revoked.some((r) => norm(r.email) === norm(email));
  }

  function isApproved(email) {
    const e = norm(email);
    if (isOwnerEmail(e)) return true;
    if (isRevoked(e)) return false;
    return loadStore().approved.some((a) => norm(a.email) === e);
  }

  function listPendingQueue(appFilter) {
    const pending = loadStore().pending.filter((p) => !isApproved(p.email));
    if (!appFilter) return pending;
    return pending.filter((p) => !p.app || p.app === appFilter);
  }

  function listApprovedAdmins() {
    return loadStore().approved.filter((a) => !isRevoked(a.email));
  }

  async function notifyOwnerPending(requesterEmail, appId) {
    try {
      const url = global.ZONIC_NOTIFY_URL || global.VITE_ZONIC_NOTIFY_URL;
      if (url) {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: OWNER_EMAIL, requester: requesterEmail, app: appId }),
        });
      }
    } catch (_) {
      /* fail-open */
    }
  }

  function queuePendingApproval(identity, appId) {
    appId = appId || "zonicme";
    const email = norm(identity);
    if (!email || isOwnerEmail(email)) return { ok: true, status: "owner" };
    if (isApproved(email)) return { ok: true, status: "approved" };
    const store = loadStore();
    if (!store.pending.some((p) => norm(p.email) === email)) {
      store.pending.unshift({
        email,
        identity: String(identity || "").trim(),
        app: appId,
        requestedAt: new Date().toISOString(),
      });
      saveStore(store);
      void notifyOwnerPending(email, appId);
    }
    return { ok: false, status: "pending", email, message: AWAITING_MSG };
  }

  function resolveAdminGateLogin(identity, password, appId) {
    if (!isSharedAdminPassword(password)) return { ok: false, status: "not_admin_password" };
    const email = norm(identity);
    if (!email) return { ok: false, status: "invalid", message: "Enter any username with admin password." };
    if (isOwnerEmail(email)) return { ok: true, status: "owner", email };
    if (isRevoked(email)) {
      return {
        ok: false,
        status: "revoked",
        email,
        message: "Admin access was revoked. Contact the owner to request access again.",
      };
    }
    if (isApproved(email)) return { ok: true, status: "approved", email };
    return queuePendingApproval(identity, appId || "zonicme");
  }

  function approveAdmin(actorEmail, targetEmail) {
    if (!isOwnerEmail(actorEmail)) return { ok: false, error: "Only the owner can approve." };
    const email = norm(targetEmail);
    const store = loadStore();
    store.pending = store.pending.filter((p) => norm(p.email) !== email);
    store.revoked = store.revoked.filter((r) => norm(r.email) !== email);
    store.approved.unshift({ email, approvedAt: new Date().toISOString(), approvedBy: OWNER_EMAIL });
    saveStore(store);
    return { ok: true, email };
  }

  function revokeAdmin(actorEmail, targetEmail) {
    if (!isOwnerEmail(actorEmail)) return { ok: false, error: "Only the owner can revoke." };
    const email = norm(targetEmail);
    if (isOwnerEmail(email)) return { ok: false, error: "Cannot revoke owner." };
    const store = loadStore();
    store.approved = store.approved.filter((a) => norm(a.email) !== email);
    store.pending = store.pending.filter((p) => norm(p.email) !== email);
    store.revoked.unshift({ email, revokedAt: new Date().toISOString(), revokedBy: OWNER_EMAIL });
    saveStore(store);
    return { ok: true, email };
  }

  global.ZonicAdminApproval = {
    OWNER_EMAIL,
    AWAITING_MSG,
    isSharedAdminPassword,
    isOwnerEmail,
    isApproved,
    listPendingQueue,
    listApprovedAdmins,
    resolveAdminGateLogin,
    approveAdmin,
    revokeAdmin,
    notifyOwnerPending,
  };
})(typeof window !== "undefined" ? window : globalThis);
