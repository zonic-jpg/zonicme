// ZonicMe Rewards - app-facing API (server to server only): balance, eligibility, redeem,
// verify_redemption, fulfil_redemption.
//
// Signed exactly like the event intake; the signature is checked inside the database, next to
// the app's secret, which never leaves it.
//
//   POST /functions/v1/rewards-api
//   x-zonic-app:        myyanga
//   x-zonic-timestamp:  unix seconds (must be within 10 minutes of now)
//   x-zonic-signature:  hex( HMAC-SHA256( secret, app + "." + timestamp + "." + raw body ) )
//   body: {"action":"balance","identity":{"email"|"email_hash"}}
//         {"action":"eligibility","identity":{...},"points":500}
//         {"action":"redeem","identity":{...},"points":500,"idempotency_key":"order-123-redeem","note":"..."}
//         {"action":"verify_redemption","code":"ZR-XXXXXXXXXX","identity":{...}}   (identity optional)
//         {"action":"fulfil_redemption","code":"ZR-XXXXXXXXXX","identity":{...}}   (identity optional)
//
// JWT verification is off on purpose: callers are other back ends, authenticated by signature.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY = 16384;
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
    const { data, error } = await sb.rpc("rewards_api_signed", { p_app: app, p_ts: ts, p_sig: sig, p_body: body });
    if (error || !data || typeof data !== "object") {
      console.error("rewards-api: database call failed", error?.code || "no-data");
      return json({ status: "error", reason: "temporarily_unavailable" }, 503);
    }
    const { http, ...rest } = data as Record<string, unknown>;
    return json(rest, typeof http === "number" ? http : 200);
  } catch (_e) {
    console.error("rewards-api: unexpected failure");
    return json({ status: "error", reason: "temporarily_unavailable" }, 503);
  }
});
