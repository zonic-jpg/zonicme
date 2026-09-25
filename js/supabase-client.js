/**
 * ZonicMe hub — shared Supabase client.
 *
 * Backs the real admin auth (see auth.js / adminTesterApproval.js). Replaces
 * the old localStorage-only implementation documented in AUTH.md, whose
 * "does not sync between devices or browsers" limitation was the root cause
 * of the reported login instability: sessions, users and the tester-approval
 * queue never left the browser they were created in.
 *
 * Publishable key — safe to ship client-side by design (Supabase's anon/
 * publishable key is meant to be public; access is enforced by the RLS
 * policies on the `profiles` and `admin_approval_queue` tables, not by
 * keeping this key secret).
 */
(function (global) {
  const SUPABASE_URL = "https://qdhlbplzdblcvvaaluwu.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aYNuDQ2xQx1q45xmIKwpOQ_0DmUBmby";

  if (!global.supabase || typeof global.supabase.createClient !== "function") {
    console.error("[ZonicMe] Supabase SDK failed to load — admin login is unavailable.");
    return;
  }

  global.ZonicSupabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "zonicme-admin-auth",
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
