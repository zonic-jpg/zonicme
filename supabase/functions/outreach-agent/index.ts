// ZonicMe Outreach research agent. Finds leads for a campaign target and writes draft emails.
// It can only ADD leads and FILL drafts. It cannot approve, queue or send: the database refuses
// those changes from anything but a signed-in administrator (see outreach_leads_guard).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const APPS: Record<string, { name: string; url: string; what: string }> = {
  adspot: { name: "AdSpot", url: "https://adspotx.netlify.app", what: "a platform where real people watch and review adverts so brands learn what their audience took away" },
  rubba: { name: "Rubba", url: "https://myrubba.com", what: "a life-planning app that helps people in Nigeria plan goals such as saving, study, property and travel" },
  myyanga: { name: "MyYanga", url: "https://myyangax.netlify.app", what: "an African fashion platform with brand profiles, virtual try-on and a virtual runway" },
  myafriart: { name: "MyAfriArt", url: "https://myafriartx.netlify.app", what: "a marketplace for African art with a catalogue, auctions and room staging" },
  owanbe: { name: "Owanbe", url: "https://owanbex.netlify.app", what: "an event-planning app for weddings and celebrations with a vendor directory" },
  sydef: { name: "Sydef", url: "https://mysydef.com", what: "a membership programme with plans for individuals and packages for organisations" },
  confirmahead: { name: "ConfirmAhead", url: "https://confirmahead.netlify.app", what: "an appointment booking and confirmation tool for small businesses" },
};

async function isAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await service().auth.getUser(token);
  if (!data?.user) return false;
  const { data: p } = await service().from("profiles").select("roles").eq("id", data.user.id).maybeSingle();
  const roles: string[] = (p?.roles as string[]) ?? [];
  return roles.some((r) => ["owner", "super_admin", "admin"].includes(r));
}

async function claude(key: string, body: Record<string, unknown>): Promise<{ text: string; error?: string }> {
  const models = [Deno.env.get("OUTREACH_MODEL") ?? "claude-sonnet-4-6", "claude-sonnet-4-20250514"];
  let messages = body.messages as unknown[];
  for (const model of models) {
    for (let turn = 0; turn < 3; turn++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ ...body, model, messages }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) break; // unknown model name: try the next one
      if (!r.ok) return { text: "", error: j?.error?.message ?? `AI service error ${r.status}` };
      const text = ((j.content ?? []) as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
      if (j.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: j.content }]; continue; }
      return { text };
    }
  }
  return { text: "", error: "The AI service did not accept the request." };
}

function parseJson(text: string): unknown {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "");
  for (const [open, close] of [["[", "]"], ["{", "}"]]) {
    const a = clean.indexOf(open), b = clean.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)); } catch { /* try the other shape */ } }
  }
  return null;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const validEmail = (v: unknown) => { const s = str(v, 200); return s && /^[^\s@<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) ? s.toLowerCase() : null; };
const httpUrl = (v: unknown) => { const s = str(v, 500); return s && /^https?:\/\//i.test(s) ? s : null; };

async function acceptsMail(email: string): Promise<boolean> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(email.split("@")[1])}&type=MX`);
    const j = await r.json();
    return j.Status === 0 && Array.isArray(j.Answer) && j.Answer.some((a: { type: number }) => a.type === 15);
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  if (!(await isAdmin(req))) return json({ ok: false, error: "This is for ZonicMe administrators." }, 403);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, code: "no_ai_key", error: "On-demand research is not switched on for this button. Set the campaign to Active and the Creative Desk assistant researches its leads once a day (about 5:45am) and files them here for your review. You can also add leads from a spreadsheet." });

  const b = await req.json().catch(() => ({}));
  const sb = service();
  const limit = Math.min(Math.max(Number(b.limit) || 5, 1), 8);
  const { data: camp } = await sb.from("outreach_campaigns").select("*").eq("id", String(b.campaign_id ?? "")).maybeSingle();
  if (!camp) return json({ ok: false, error: "That campaign was not found." }, 404);
  const app = APPS[camp.app] ?? { name: camp.app, url: "", what: "a ZonicMe application" };
  const started = Date.now();

  if (b.op === "draft") {
    const { data: leads } = await sb.from("outreach_leads").select("*").eq("campaign_id", camp.id).eq("approval_status", "pending_review").is("draft_body", null).limit(limit);
    const { data: ctxs } = await sb.from("outreach_contexts").select("*").eq("app", camp.app);
    let written = 0; const problems: string[] = [];
    for (const l of leads ?? []) {
      if (Date.now() - started > 100_000) break;
      const ctx = (ctxs ?? []).find((c) => c.id === l.context_id);
      const prompt = `Write a short first-contact email on behalf of ${app.name}, ${app.what} (${app.url}), run by ZonicMe Limited.\n\n` +
        `Recipient organisation: ${l.org_name}\nContact person: ${l.owner_name ?? "not known"}\nCountry: ${l.country ?? "not known"}\nWhy they fit: ${l.evidence ?? "not recorded"}\n` +
        `Kind of approach: ${ctx?.purpose ?? "introduction"}\nWhat this email offers: ${ctx?.pitch_brief ?? "an introduction"}\n\n` +
        `Rules: plain text only, 90 to 140 words, warm and specific, British spelling. State nothing about the recipient that is not given above. No superlatives, no invented numbers. ` +
        `One clear next step (a reply or a short call). Greet the contact person by name if known, otherwise the team. Sign off as "The ${app.name} team, ZonicMe Limited". ` +
        `End with this exact final line: "If you would rather not hear from us, reply STOP and we will not write again."\n\nReturn ONLY JSON: {"subject": "...", "body": "..."}`;
      const out = await claude(key, { max_tokens: 700, messages: [{ role: "user", content: prompt }] });
      if (out.error) { problems.push(out.error); break; }
      const j = parseJson(out.text) as { subject?: string; body?: string } | null;
      const subject = str(j?.subject, 200), body = str(j?.body, 4000);
      if (!subject || !body) { problems.push(`No usable draft for ${l.org_name}`); continue; }
      const { error } = await sb.from("outreach_leads").update({ draft_subject: subject, draft_body: body }).eq("id", l.id).is("draft_body", null);
      if (error) problems.push(error.message); else written++;
    }
    await sb.from("outreach_events").insert({ campaign_id: camp.id, actor: "agent", action: "drafts_written", detail: { written } });
    return json({ ok: true, written, waiting: Math.max((leads ?? []).length - written, 0), problems: problems.slice(0, 3) });
  }

  if (b.op === "discover") {
    const { data: targets } = await sb.from("outreach_campaign_targets").select("*").eq("campaign_id", camp.id).gt("quota", 0);
    const { data: held } = await sb.from("outreach_leads").select("org_name, contact_email, context_id, country, campaign_id").eq("app", camp.app).limit(3000);
    const have = (t: { context_id: string; country: string }) => (held ?? []).filter((l) => l.campaign_id === camp.id && l.context_id === t.context_id && String(l.country ?? "").toLowerCase() === t.country.toLowerCase()).length;
    const target = (targets ?? []).filter((t) => !b.target_id || t.id === b.target_id).find((t) => have(t) < t.quota);
    if (!target) return json({ ok: true, added: 0, done: true, message: "Every target in this campaign already has its number." });
    const { data: ctx } = await sb.from("outreach_contexts").select("*").eq("id", target.context_id).maybeSingle();
    if (!ctx) return json({ ok: false, error: "That target's group no longer exists." }, 404);
    const want = Math.min(limit, target.quota - have(target));
    const exclude = (held ?? []).map((l) => l.org_name).slice(0, 250).join("; ");
    const prompt = `You are researching outreach leads for ${app.name}, ${app.what}.\n\nFind up to ${want} real ${ctx.label} in ${target.country}.\nBrief: ${ctx.discovery_brief}\n\n` +
      `For each one return: org_name; website_url (their own site or official social profile); owner_name (only if publicly stated, otherwise null); ` +
      `contact_email (ONLY an address published on their own website or official profile, otherwise null. Never guess, infer or construct an address); ` +
      `source_url (the page where you found the contact details); evidence (one factual sentence on why they fit the brief, with any figure you actually saw).\n` +
      `Only include organisations you found through search in this session. Skip any you cannot confirm exist. Do not include these, which are already held: ${exclude || "none"}.\n\n` +
      `Finish with ONLY a JSON array of objects with exactly those keys. If you find none, return [].`;
    const out = await claude(key, { max_tokens: 4000, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }], messages: [{ role: "user", content: prompt }] });
    if (out.error) return json({ ok: false, error: out.error });
    const found = parseJson(out.text);
    if (!Array.isArray(found)) return json({ ok: true, added: 0, message: "The search came back with nothing usable. Try again." });
    let added = 0, skipped = 0, checked = 0;
    for (const f of found.slice(0, want) as Record<string, unknown>[]) {
      const org = str(f.org_name, 200); if (!org) { skipped++; continue; }
      const email = validEmail(f.contact_email);
      const ok = email ? await acceptsMail(email) : false;
      const { error } = await sb.from("outreach_leads").insert({
        campaign_id: camp.id, context_id: ctx.id, app: camp.app, country: target.country, org_name: org, website_url: httpUrl(f.website_url), owner_name: str(f.owner_name, 160),
        contact_email: email, email_verified: ok, verification_note: email ? (ok ? "Automatic check: the domain accepts email." : "Automatic check: the domain does not accept email.") : null,
        source_url: httpUrl(f.source_url), evidence: str(f.evidence, 600), origin: "agent",
      });
      if (error) skipped++; else { added++; if (ok) checked++; }
    }
    await sb.from("outreach_events").insert({ campaign_id: camp.id, actor: "agent", action: "leads_found", detail: { added, skipped, country: target.country, group: ctx.label } });
    return json({ ok: true, added, skipped, checked, country: target.country, group: ctx.label, remaining: Math.max(target.quota - have(target) - added, 0) });
  }

  return json({ ok: false, error: "Unknown request." }, 400);
});
