// ZonicMe Outreach: the sending service.
// It can only send what an administrator has approved and queued: the database hands out
// work through outreach_claim_batch, which checks approval, the checked address, the
// do-not-contact list, each campaign's daily limit and the master switch. Nothing here can
// approve, queue or change an email.
//
// Called every 10 minutes by the database scheduler (private secret), or by a signed-in
// administrator for "status" and "test".
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const PER_RUN = 4;      // emails per run: about 24 an hour at most, well under a campaign's daily limit
const CHECKS_PER_RUN = 12;
const GAP_MS = 600;     // the email provider allows two calls a second
const OPT_OUT = 'If you would rather not hear from us again, just reply with the word "stop" and we will not write again.';

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const toHtml = (text: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f;max-width:600px">` +
  text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("") +
  `<p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #e8e8ed;font-size:12px;color:#6e6e73">${esc(OPT_OUT)}</p></div>`;

type Settings = { sending_paused: boolean; from_name: string | null; from_email: string | null; reply_to: string | null };
type Lead = { id: string; contact_email: string; draft_subject: string; draft_body: string; provider_id?: string | null };

async function resend(key: string, path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const r = await fetch("https://api.resend.com" + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body: (body ?? {}) as Record<string, unknown> };
  } catch (_) { return { status: 0, body: { message: "The email service could not be reached." } }; }
}
const sender = (s: Settings) => (s.from_name ? `${s.from_name.replace(/[<>"]/g, "")} <${s.from_email}>` : String(s.from_email));
const errText = (r: { status: number; body: Record<string, unknown> }) => String(r.body?.message ?? (r.body?.error as { message?: string })?.message ?? `The email service answered ${r.status}.`).slice(0, 240);
const limited = (r: { status: number; body: Record<string, unknown> }) => r.status === 429 || /quota|rate limit|too many/i.test(errText(r));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const body = (await req.json().catch(() => ({}))) as { op?: string };
  const op = body.op ?? "run";
  const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

  // Who is calling: the scheduler, or a signed-in administrator.
  let scheduler = false;
  let adminEmail: string | null = null;
  const secret = req.headers.get("x-cron-secret");
  if (secret) { const { data } = await db.rpc("outreach_cron_ok", { p_secret: secret }); scheduler = data === true; }
  if (!scheduler) {
    const auth = req.headers.get("authorization") ?? "";
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await asUser.auth.getUser();
    const { data: isAdmin } = await asUser.rpc("outreach_is_admin");
    if (!u?.user || isAdmin !== true) return json({ ok: false, error: "This is for ZonicMe administrators." }, 403);
    adminEmail = u.user.email ?? null;
  }

  const { data: s } = await db.from("outreach_settings").select("sending_paused,from_name,from_email,reply_to").eq("id", 1).maybeSingle<Settings>();
  const key = Deno.env.get("RESEND_API_KEY") ?? "";

  if (op === "status") {
    if (!key) return json({ ok: true, ready: false, reason: "Email sending is not set up yet." });
    if (!s?.from_email) return json({ ok: true, ready: false, reason: "Enter a sender address first." });
    const d = await resend(key, "/domains");
    const list = ((d.body?.data ?? []) as { name?: string; status?: string }[]);
    const domain = s.from_email.split("@")[1]?.toLowerCase();
    const hit = list.find((x) => String(x.name).toLowerCase() === domain);
    if (d.status !== 200) return json({ ok: true, ready: true, reason: "", note: "The sender's domain could not be checked just now." });
    if (!hit) return json({ ok: true, ready: false, reason: `Emails cannot be sent from ${domain}: that domain is not set up for sending. Use an address on ${list.filter((x) => x.status === "verified").map((x) => x.name).join(" or ") || "your sending domain"}.` });
    if (hit.status !== "verified") return json({ ok: true, ready: false, reason: `${domain} is not yet confirmed for sending.` });
    return json({ ok: true, ready: true, reason: "", paused: !!s.sending_paused });
  }

  if (op === "test") {
    if (scheduler || !adminEmail) return json({ ok: false, error: "Sign in as an administrator to send a test." }, 403);
    if (!key) return json({ ok: false, error: "Email sending is not set up yet." });
    if (!s?.from_email) return json({ ok: false, error: "Enter a sender address first, then save." });
    const sample = "Hello,\n\nThis is a test from ZonicMe Outreach. It shows how an approved email will look when it reaches someone: your sender name and address above, your message here, and the opt-out line below.\n\nNothing has been sent to any lead.";
    const r = await resend(key, "/emails", { method: "POST", body: JSON.stringify({ from: sender(s), to: [adminEmail], subject: "ZonicMe Outreach: test email", text: sample + "\n\n" + OPT_OUT, html: toHtml(sample), ...(s.reply_to ? { reply_to: s.reply_to } : {}) }) });
    if (r.status >= 300 || !r.body?.id) return json({ ok: false, error: errText(r) });
    return json({ ok: true, to: adminEmail });
  }

  if (op !== "run") return json({ ok: false, error: "Unknown request." }, 400);
  if (!key) return json({ ok: true, skipped: "no key" });

  const out = { checked: 0, bounced: 0, recovered: 0, sent: 0, failed: 0, skipped: "" };

  // 1. An email left half-sent by an interrupted run is released so it can be queued again.
  //    (The provider ignores a repeat of the same email for a day, so this cannot double-send.)
  const { data: stuck } = await db.from("outreach_leads").select("id").eq("outreach_status", "sending").lt("sent_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(20);
  for (const l of stuck ?? []) { await db.rpc("outreach_mark", { p_lead: l.id, p_status: "failed", p_provider_id: null, p_error: "Sending was interrupted. Queue it again." }); out.recovered++; }

  // 2. Follow up on recent emails: delivered, bounced or marked as spam.
  const { data: recent } = await db.from("outreach_leads").select("id,contact_email,provider_id,delivery_state")
    .eq("outreach_status", "sent").not("provider_id", "is", null).gt("sent_at", new Date(Date.now() - 5 * 86_400_000).toISOString())
    .or("delivery_state.is.null,delivery_state.not.in.(delivered,bounced,complained)")
    .order("delivery_checked_at", { ascending: true, nullsFirst: true }).limit(CHECKS_PER_RUN);
  for (const l of (recent ?? []) as (Lead & { delivery_state: string | null })[]) {
    const r = await resend(key, "/emails/" + l.provider_id);
    await sleep(GAP_MS);
    if (r.status !== 200) { if (limited(r)) break; continue; }
    const state = String(r.body?.last_event ?? "").toLowerCase() || null;
    await db.from("outreach_leads").update({ delivery_state: state, delivery_checked_at: new Date().toISOString() }).eq("id", l.id);
    out.checked++;
    if (state === "bounced" || state === "complained") {
      const why = state === "bounced" ? "The address bounced." : "The recipient marked the email as spam.";
      await db.rpc("outreach_mark", { p_lead: l.id, p_status: "bounced", p_provider_id: null, p_error: why });
      const { data: have } = await db.from("outreach_suppressions").select("id").eq("email", l.contact_email).limit(1);
      if (!have?.length) await db.from("outreach_suppressions").insert({ email: l.contact_email, reason: state === "bounced" ? "bounced" : "marked as spam" });
      out.bounced++;
    }
  }

  // 3. Send what is approved and queued. The database decides what may go.
  if (!s || s.sending_paused) { out.skipped = "sending is switched off"; return json({ ok: true, ...out }); }
  if (!s.from_email) { out.skipped = "no sender address"; return json({ ok: true, ...out }); }
  const { data: batch, error: claimErr } = await db.rpc("outreach_claim_batch", { p_limit: PER_RUN });
  if (claimErr) return json({ ok: false, error: "The queue could not be read.", ...out });
  let stop = "";
  for (const l of (batch ?? []) as Lead[]) {
    if (stop) { await db.rpc("outreach_mark", { p_lead: l.id, p_status: "failed", p_provider_id: null, p_error: stop }); out.failed++; continue; }
    const r = await resend(key, "/emails", {
      method: "POST",
      headers: { "Idempotency-Key": "outreach-" + l.id },
      body: JSON.stringify({ from: sender(s), to: [l.contact_email], subject: l.draft_subject, text: l.draft_body.trim() + "\n\n" + OPT_OUT, html: toHtml(l.draft_body), ...(s.reply_to ? { reply_to: s.reply_to } : {}) }),
    });
    if (r.status < 300 && r.body?.id) { await db.rpc("outreach_mark", { p_lead: l.id, p_status: "sent", p_provider_id: String(r.body.id), p_error: null }); out.sent++; }
    else {
      const why = limited(r) ? "The email service's sending limit was reached. Queue it again later." : errText(r);
      if (limited(r)) stop = why;
      await db.rpc("outreach_mark", { p_lead: l.id, p_status: "failed", p_provider_id: null, p_error: why }); out.failed++;
    }
    await sleep(GAP_MS);
  }
  return json({ ok: true, ...out });
});
