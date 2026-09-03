/**
 * Public message guard — ZonicMe admin (ported from MyYangaX publicMessage.js).
 */
(function (global) {
  const GENERIC_ERROR = "Something went wrong. Please try again.";
  const SIGN_IN_MESSAGE = "Please sign in to continue.";

  const INTERNAL_TERMS = [
    "supabase", "netlify", "edge function", "edge functions", "anon key",
    "service role", "rls", "migration", "deploy", "localhost", "mock",
    "jwt", "unauthorized", "permission denied", "row-level security",
    "auth session missing", "invalid token", "admin sign-in required",
  ];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const TERM_RE = new RegExp(`\\b(?:${INTERNAL_TERMS.map(escapeRe).join("|")})\\b`, "i");

  const AUTH_TERMS = [
    "unauthorized", "unauthorised", "not authorized", "not authorised",
    "jwt", "permission denied", "row-level security", "row level security",
    "auth session missing", "invalid claim", "invalid api key", "invalid token",
    "admin required", "admin sign-in required", "sign in required",
  ];
  const AUTH_RE = new RegExp(`\\b(?:${AUTH_TERMS.map(escapeRe).join("|")})\\b`, "i");

  let diagnosticsAudience = false;

  function isAuthMessage(raw) {
    const text = String(raw ?? "").trim();
    return !!text && AUTH_RE.test(text);
  }

  function isInternalMessage(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return false;
    return TERM_RE.test(text);
  }

  function setDiagnosticsAudience(isAdmin) {
    diagnosticsAudience = !!isAdmin;
  }

  function publicMessage(raw, opts) {
    opts = opts || {};
    const fallback = opts.fallback || GENERIC_ERROR;
    const authFallback = opts.authFallback || SIGN_IN_MESSAGE;
    const force = !!opts.force;
    const text = String((raw && raw.message) || raw || "").trim();
    if (!text) return "";
    if (diagnosticsAudience && !force) return text;
    if (isAuthMessage(text)) return authFallback;
    return isInternalMessage(text) ? fallback : text;
  }

  function publicError(err, fallback) {
    return publicMessage(err, { fallback: fallback || GENERIC_ERROR, authFallback: fallback || SIGN_IN_MESSAGE }) || fallback || GENERIC_ERROR;
  }

  global.ZonicPublicMessage = {
    GENERIC_ERROR,
    SIGN_IN_MESSAGE,
    setDiagnosticsAudience,
    publicMessage,
    publicError,
  };
})(typeof window !== "undefined" ? window : globalThis);
