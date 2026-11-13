// ZonicMe Rewards - trusted event intake (server to server only).
//
// An app's own back end POSTs one event here. The request must be signed with that app's
// secret; the signature is checked inside the database, next to the secret, which never
// leaves it. This function holds no secrets of its own beyond the standard service key.
//
//   POST /functions/v1/rewards-ingest
//   x-zonic-app:        myyanga
//   x-zonic-timestamp:  unix seconds (must be within 10 minutes of now)
//   x-zonic-signature:  hex( HMAC-SHA256( secret, app + "." + timestamp + "." + raw body ) )
//   body: {"event_id","event_type","occurred_at","identity":{"email"|"email_hash","email_verified"},
//          "payload":{"amount","currency","sku","category","brand_id","metadata":{}}}
//
// JWT verification is off on purpose: callers are other back ends, not signed-in people, and
// every request is authenticated by its signature. Browsers are not expected here, so no
// cross-origin headers are sent.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY = 32768;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "invalid", reason: "post_only" }, 405);
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > MAX_BODY) return json({ status: "invalid", reason: "payload_too_large" }, 413);
  let body = "";
  try { body = await req.text(); } catch { return json({ status: "invalid", reason: "unreadable" }, 400); }
  if (new TextEncoder().encode(body).length > MAX_BODY) return json({ status: "invalid", reason: "payload_too_large" }, 413);

  const app = (req.headers.get("x-zonic-app") || "").trim().toLowerCase().slice(0, 60);
  const ts = (req.headers.get("x-zonic-timestamp") || "").trim().slice(0, 20);
  const sig = (req.headers.get("x-zonic-signature") || "").trim().slice(0, 100);

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data, error } = await sb.rpc("rewards_ingest_signed", { p_app: app, p_ts: ts, p_sig: sig, p_body: body });
    if (error || !data || typeof data !== "object") {
      console.error("rewards-ingest: database call failed", error?.code || "no-data");
      return json({ status: "error", reason: "temporarily_unavailable" }, 503);
    }
    const { http, ...rest } = data as Record<string, unknown>;
    return json(rest, typeof http === "number" ? http : 200);
  } catch (_e) {
    console.error("rewards-ingest: unexpected failure");
    return json({ status: "error", reason: "temporarily_unavailable" }, 503);
  }
});
