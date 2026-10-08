// Emails the founding owner when someone is waiting for approval (ZonicMe).
// Caller must be signed in and can only announce THEIR OWN waiting row. Recipient fixed: the founding owner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_NAME = "ZonicMe";
const APP_ID = "zonicme";
const APP_URL = "https://zonicme.netlify.app";
const APPROVALS_PATH = "/admin.html#approvals";
const OWNER = "oadeagbo@gmail.com";
const HOURLY_CAP = 20;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { kind?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const kind = body.kind === "admin_request" ? "admin_request" : body.kind === "signup" ? "signup" : "";
  if (!kind) return json({ error: "unknown kind" }, 400);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ sent: false, reason: "not signed in" }, 401);

  const col = kind === "signup" ? "notified_at" : "admin_notified_at";
  const { data: row } = await admin.from("signup_approvals")
    .select("user_id,email,status,notified_at,admin_requested_at,admin_notified_at")
    .eq("user_id", u.user.id).maybeSingle();
  if (!row) return json({ sent: false, reason: "nothing to notify" });
  if (kind === "signup" && (row.status !== "pending" || row.notified_at)) return json({ sent: false, reason: "nothing to notify" });
  if (kind === "admin_request" && (!row.admin_requested_at || row.admin_notified_at)) return json({ sent: false, reason: "nothing to notify" });
  if (String(row.email).toLowerCase() === OWNER) return json({ sent: false, reason: "owner" });

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [a, b] = await Promise.all([
    admin.from("signup_approvals").select("user_id", { count: "exact", head: true }).gte("notified_at", hourAgo),
    admin.from("signup_approvals").select("user_id", { count: "exact", head: true }).gte("admin_notified_at", hourAgo),
  ]);
  if ((a.count ?? 0) + (b.count ?? 0) >= HOURLY_CAP) return json({ sent: false, reason: "rate limited" }, 429);

  const { data: claimed } = await admin.from("signup_approvals")
    .update({ [col]: new Date().toISOString() }).eq("user_id", row.user_id).is(col, null).select("user_id");
  if (!claimed || claimed.length === 0) return json({ sent: false, reason: "already notified" });

  const who = String(row.email);
  const base = (Deno.env.get("PUBLIC_APP_URL") ?? APP_URL).replace(/\/+$/, "");
  const link = `${base}${APPROVALS_PATH}`;
  const what = kind === "signup" ? "a new sign-up" : "an admin-access request";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px">
    <h2 style="margin:0 0 8px">${esc(APP_NAME)}: approval needed</h2>
    <p><b>${esc(who)}</b> is waiting — ${what}.</p>
    <p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Review &amp; approve</a></p>
    <p style="color:#666;font-size:12px">You'll be asked to sign in if needed, then land straight on the approvals page.<br>${esc(link)}</p></div>`;

  const key = Deno.env.get("RESEND_API_KEY");
  const RELAY = Deno.env.get("MAIL_RELAY_URL") ?? "https://nuleyrowkiuxrnlrkrkd.supabase.co/functions/v1/owner-mail-relay";
  let res: Response;
  try {
    res = !key ? await fetch(RELAY, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: APP_ID, who, kind }),
    }) : await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("APPROVAL_EMAIL_FROM") ?? Deno.env.get("EMAIL_FROM") ?? `${APP_NAME} <onboarding@resend.dev>`,
        to: [OWNER], subject: `${APP_NAME}: ${who} is waiting for approval`, html,
      }),
    });
  } catch {
    await admin.from("signup_approvals").update({ [col]: null }).eq("user_id", row.user_id);
    return json({ sent: false, reason: "email provider unreachable" }, 502);
  }
  if (!res.ok) {
    await admin.from("signup_approvals").update({ [col]: null }).eq("user_id", row.user_id);
    return json({ sent: false, reason: `email provider ${res.status}` }, 502);
  }
  return json({ sent: true });
});
