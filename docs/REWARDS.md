# ZonicMe Rewards — Phase 1

One reward system for the ZonicMe apps. ZonicMe owns the rules, balances, campaigns, gifts and redemptions;
the apps only report what happened.

## How it works

1. **An app reports an event** ("order 123 was paid, ₦15,000, by this person") to the hub, server to server, signed with
   that app's own secret. Browser-sent events are never used for rewards.
2. **The hub finds the person's one wallet** by the hash of their verified email (the same hash the analytics hub uses:
   sha256 of the trimmed, lower-cased address). A wallet can exist and collect points before its owner ever signs in
   to ZonicMe; it is claimed the first time a ZonicMe user with that confirmed email opens `wallet.html`.
3. **The rules engine evaluates the event** against the rules that are switched on, lowest order number first, applying
   conditions, limits, the campaign budget and expiry. Each award is one row in an append-only ledger, written in the
   same transaction that changes the balance.
4. **People use their wallet** on the site: balance, history, offers, send a gift, redeem (when switched on).

Hard guarantees, all enforced in the database (project `zonicme`):

- Balances change only through `rewards_core.post_ledger`, which locks the wallet, moves the balance and writes the
  ledger row together. Direct edits of a balance are refused by a trigger, even for the database owner.
- Ledger and audit rows cannot be updated or removed. Points are whole numbers.
- The same `(app, event_id)` is processed once. A redeem request with the same `idempotency_key` debits once.
- A campaign cannot exceed its budget; nobody can gift or redeem more than they hold (row locks, tested in parallel).
- Signed-in people reach the system only through `public.rewards_call(action, args)`, which checks who is asking.
  Members see only their own wallet, brand managers only their own brand, admins everything; only the owner and super
  admins can change anything. The owner (`founding_owner_email()`) is always super admin.
- Redemption is **off** and the point value is **unset** until the owner sets them in the admin console. Redeeming is a
  ledger debit plus a code an app can verify; no money moves.
- Demo data is marked `is_demo`, never mixes with real data, and is removed separately.

## Screens (static pages on this site)

| Page | For | Script |
|---|---|---|
| `wallet.html` (menu: Rewards) | every member | `js/rewards-wallet.js` |
| `brand-rewards.html` | brand managers the owner has added | `js/rewards-brand.js` |
| `rewards-admin.html` (linked from `admin.html`) | owner and admins; includes a plain-language Guide tab | `js/rewards-admin.js` |

Shared code: `js/rewards.js`, `css/rewards.css`. No secrets are in any of these files.

## Event contract

```
POST https://qdhlbplzdblcvvaaluwu.supabase.co/functions/v1/rewards-ingest
Content-Type: application/json
x-zonic-app:        <app id, e.g. myyanga>
x-zonic-timestamp:  <unix seconds, within 10 minutes of now>
x-zonic-signature:  hex( HMAC-SHA256( key = app secret, message = app_id + "." + timestamp + "." + raw body ) )

{ "event_id": "retail_order:123",            // unique per app; the same id is only ever counted once
  "event_type": "order_paid",                 // lower-case code
  "occurred_at": "2026-11-13T10:00:00Z",
  "identity": { "email_hash": "<sha256 hex>", // or "email": "person@example.com"
                "email_verified": true },     // unverified identities earn nothing by default
  "payload": { "amount": 15000, "currency": "NGN", "sku": "...", "category": "...", "brand_id": "...",
               "metadata": { } } }
```

Answers: `200 {"status":"accepted", "points_awarded": n, ...}`, `200 {"status":"duplicate", ...}`,
`200 {"status":"rejected","reason":...}`, `401 {"status":"unauthorized"}`, `422 {"status":"invalid","reason":...}`.

App API, signed the same way: `POST .../functions/v1/rewards-api` with
`{"action":"balance"|"eligibility"|"redeem"|"verify_redemption"|"fulfil_redemption", ...}` (see the header of
`supabase/functions/rewards-api/index.ts`).

Events sent today:

| App | Moment | `event_type` | `event_id` | Amount |
|---|---|---|---|---|
| MyYangaX | `retail_orders.status` becomes `paid` | `order_paid` | `retail_order:<id>` | `subtotal_ngn` |
| MyAfriArt | `payments.status` becomes `succeeded` for an artwork purchase | `artwork_purchase_paid` | `payment:<id>` | `amount_ngn` |
| MyAfriArt | the same for an auction lot (`metadata.lot_id`) | `auction_settlement_paid` | `payment:<id>` | `amount_ngn` |
| AdSpot | `adspot_review_sessions.status` becomes `completed` | `review_completed` | `review_session:<id>` | none |

Each is a database trigger in the app's own project (`supabase/app-events/<app>_zonic_rewards_events.sql`). The trigger
only reports people whose email is confirmed in that app, sends only the email hash, runs after the app's own change,
sends asynchronously (pg_net) and swallows every error, so it cannot fail or slow the app. If the hub cannot be reached
the event is not retried (Phase 2: a re-send job; re-sending is safe because event ids are counted once).

## Keys

Each app has its own signing secret. It is never typed, shown or stored in code: the hub database and the app database
agree on it with a Diffie-Hellman exchange, and each keeps it in a private schema the API cannot reach
(`rewards_core.app_keys` on the hub, `zonic_rewards.link` in the app). To connect or re-key an app, a database
administrator runs:

```sql
-- hub:  select rewards_core.dh_begin('<app_id>');          -- gives the hub's PUBLIC value
-- app:  select zonic_rewards.dh_begin();                   -- gives the app's PUBLIC value
-- app:  select zonic_rewards.dh_finish('<hub public>');    -- returns a fingerprint
-- hub:  select rewards_core.dh_finish('<app_id>', '<app public>');   -- must return the same fingerprint
```

The fingerprint is shown per app in the admin console (Apps tab). "Disconnect" there switches an app's key off at once.

## Add a future app

1. Admin console → Apps → "Add a future app" (or it is already listed as planned).
2. Apply the app-side SQL in that app's project: copy one of `supabase/app-events/*.sql` (built by `_build.py`), keep
   the shared part, and write a trigger for the app's real "completed" moment that calls `zonic_rewards.emit(...)`.
3. Run the key exchange above, then set the app to "Start accepting events" in the Apps tab.
4. Add its event codes to `KNOWN_EVENTS` in `js/rewards.js` so they appear by name in the rule forms, then add rules.

## Add a rule

Admin console → Rules → New rule (platform rules), or Brand console → a campaign → Add a rule. The simple form covers
fixed points, a percentage of the amount, a minimum amount and per-person limits; "Advanced settings" accepts the full
JSON: conditions `{"all":[...]}`, `{"any":[...]}`, `{"not":{...}}`, `{"field","op","value"}` on `source_app`,
`event_type`, `amount`, `currency`, `sku`, `category`, `brand_id`, `hour`, `dow`, `metadata.*`; award settings
`{"points":n}`, `{"bps":n,"max_points":n,"min_points":n}`, `{"tiers":[{"min_amount":..,"points"|"bps":..}]}`; limits
`[{"per":"user"|"rule"|"app"|"campaign","period":"day"|"week"|"month"|"total","points"|"count":n}]`.
Every save creates a new version; old versions stay on record. Use "Test an event" before switching a rule on.

Four starter rules are seeded switched **off** (`rewards_05_starter_rules`).

## Files

- `supabase/migrations/*rewards_0*.sql` — hub schema, engine, API, starter rules (01 to 05 are applied to `zonicme`).
  `rewards_06_demo_purge` (the routine behind "Clear demo data") is written but **not applied yet**: applying it asks
  the project owner for confirmation because it is the one routine that takes rows out. Until it is applied, the
  "Clear demo data" button answers with a plain message and demo items simply stay marked as demo.
- `supabase/functions/rewards-ingest`, `rewards-api` — the two edge functions (JWT check off on purpose: they
  authenticate by signature inside the database).
- `supabase/app-events/` — the SQL applied to each app's project.

## Phase 2 (not built)

Remaining apps (Owanbe, Rubba, ConfirmAhead, Sydef); reversal events for refunds; a re-send job for events that failed
to reach the hub; an expiry job that posts `expire` rows (expiry dates are already recorded on each award); brand
budgets paid for in money; brand IDs on MyYangaX orders for brand-scoped rules; redemption payouts inside the apps
(the apps call `rewards-api`); single sign-on so members do not need a separate ZonicMe account.
