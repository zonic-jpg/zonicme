# ZonicMe Orbit — Identity, Admin & Super-Admin
## Technical Implementation Guide for AWS Engineers

This document describes how authentication, the orbit-wide **admin** role, and the single
**super-admin** (with email-verified transfer) are implemented and deployed across the entire
ZonicMe application orbit — **MyYanga, MyAfriArt, Rubba, AdSpot, Sydef, EduChatRooms,
InfluenceMatch**, and the ZonicMe hub/central auth. The model is identical for every app; only
the per-app wiring file differs.

---

## 1. Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │      SHARED Supabase project (one)           │
   Browser  ── SSO ───▶  │  Postgres + Auth + Edge Functions + RLS      │
   (any orbit app)       │  • user_roles (admin/super_admin/…)          │
                         │  • is_admin() / is_super_admin()  (SECDEF)   │
                         │  • super_admin_transfers + confirm fn        │
                         │  • admin_allowlist + sign-up triggers        │
                         │  • edge fn: super-admin-transfer (emails code)│
                         └─────────────────────────────────────────────┘
        ▲                         ▲                         ▲
   MyYanga (S3/CF)         AdSpot api-server (ECS)     Sydef (Amplify SSR)
   Rubba   (S3/CF)         MyAfriArt (EC2 node)        EduChatRooms (S3/CF)
   InfluenceMatch (S3/CF)  central auth (S3/CF)        … all point at the SAME project
```

**Key principle:** identity and roles live **once**, in a single shared Supabase project. Every
app authenticates against it (via the central auth SSO at `auth.zonicme.com.ng`) and reads roles
from it. Granting/revoking admin is therefore a **data change**, never a redeployment.

---

## 2. Hard prerequisite — one shared Supabase project

Orbit-wide admin only works if **every** participating app points at the **same** Supabase
project (the one central auth/SSO uses). Verify each app's build env:

```
VITE_SUPABASE_URL        = https://<shared-ref>.supabase.co     (Vite SPAs)
VITE_SUPABASE_ANON_KEY   = <shared anon key>
SUPABASE_URL / KEY       = same                                  (SSR/Express apps)
```

Any app currently on its own project must be **repointed** to the shared project: change the two
env vars and rebuild. That is an env + rebuild step (re-upload `dist/` or redeploy the container)
— **not** a reinstall, and no new infrastructure.

---

## 3. Roles & access model

| Role | Granted to | Capabilities |
|------|-----------|--------------|
| `admin` | testers / staff (allowlist or grant) | full admin rights in every app — passes `is_admin()` everywhere, so all admin UIs/actions unlock |
| `super_admin` | **oadeagbo@gmail.com only** | everything `admin` can do **plus** the right to transfer super-admin |
| `reviewer` / `brand` / `user` | end users | app-specific, non-admin |

`is_admin()` returns true for both `admin` and `super_admin`. Apps gate admin features on
`is_admin()`; super-admin-only features gate on `is_super_admin()`.

---

## 4. Deployment runbook (≈20 min, no app reinstall)

### 4.1 Database (shared Supabase project, SQL editor — run in order)
```
sql/0001_orbit_roles.sql        -- user_roles, is_admin(), admin_allowlist, auto-grant trigger
sql/0002_super_admin_transfer.sql -- super_admin_transfers, is_super_admin(), confirm fn
sql/0003_seed_super_admin.sql   -- seeds oadeagbo@gmail.com as the sole super_admin
sql/provision-admin.sql         -- grant/allowlist your testers (edit emails first)
```
All are idempotent (`if not exists` / `on conflict do nothing`). No redeploy — pure SQL.

### 4.2 Edge function (email-verified transfer)
```
supabase functions deploy super-admin-transfer
```
Set its secrets (Supabase dashboard → Edge Functions → Secrets):
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (project values)
# email delivery — pick ONE:
RESEND_API_KEY + TRANSFER_EMAIL_FROM="ZonicMe <no-reply@zonicme.com.ng>"
# or:
ZONICME_OTP_SERVICE_URL=https://<otp-lambda-url>     (reuse the SES OTP service)
```

### 4.3 Central auth app (hosts the admin/super-admin panel)
Rebuild and re-upload `auth/dist/` to its host (S3+CloudFront / Amplify) at
`auth.zonicme.com.ng`. Env: shared `VITE_SUPABASE_URL` + anon key, `VITE_OTP_SERVICE_URL`,
`VITE_ALLOWED_REDIRECTS`.

### 4.4 Wire the other apps (drop-in, per app)
Copy `auth/src/zonicme-admin.ts` into each app (e.g. `src/lib/`) and gate admin UI on it:
```ts
import { useIsAdmin } from "@/lib/zonicme-admin";
const { isAdmin } = useIsAdmin(supabase);   // supabase = shared-project client
```
Per-app notes:
- **MyAfriArt, Rubba** — already role-based on `user_roles`; compatible as-is, or swap their check
  to `supabase.rpc("is_admin")` for consistency.
- **MyYanga** — replace its local "Admin view" checkbox with `useIsAdmin` (real gate).
- **AdSpot** — already has RBAC (`reviewer`/`brand`/`admin`); point it at the shared project and map
  its admin check to `is_admin()`.
- **Sydef** — Next.js; use the same helper in client components, or call `is_admin()` from server
  components/route handlers with the user's session.
- **EduChatRooms** — already has `profiles.role` + a super-admin studio; either map its role to the
  shared `user_roles` or read `is_admin()`. Its `orbit-manifest` feed is unaffected.
- **InfluenceMatch** — apply the same drop-in once its source is available.

Each wired app is rebuilt and its `dist/`/container re-uploaded — a frontend redeploy only.

---

## 5. Provisioning testers (so admins can start testing)
Two ways, both pure SQL in the shared project:
```sql
-- direct grant (account must already exist):
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'tester@example.com' on conflict do nothing;

-- OR allowlist (auto-grants admin on sign-up, even before they register):
insert into public.admin_allowlist (email) values ('tester@example.com') on conflict do nothing;
```
After this, the tester has **full admin rights in every orbit app** that shares the project — no
per-app SQL, no redeploy.

---

## 6. Super-admin transfer (email-verified) — flow

```
 current super_admin                 Edge fn                    new owner
 ──────────────────                  ───────                    ─────────
 initiateSuperAdminTransfer(toEmail) ─▶ verify caller is super_admin
                                        generate 6-digit code
                                        store SHA-256(code) in super_admin_transfers
                                        EMAIL plain code to toEmail ─────────────▶ inbox
 (code never returned to caller)
                                                       new owner logs in AS toEmail
                                                       (Supabase Auth = email verified)
                                                       confirmSuperAdminTransfer(code)
                                        confirm fn: hash matches & not expired?
                                        ─▶ ATOMIC: move super_admin old→new
```

Two independent proofs of email control are required: (1) logging in as the target email, which
Supabase Auth only allows after email verification, and (2) the one-time code delivered to that
inbox. The role swap is a single atomic transaction.

---

## 7. Security considerations
- `is_admin()` / `is_super_admin()` are `SECURITY DEFINER`, `stable`, with `search_path` pinned —
  safe to call from RLS policies without recursion on `user_roles`.
- `user_roles` RLS: a user may read **only their own** roles; only the service role / SQL grants.
- `create_super_admin_transfer` is service-role-only (revoked from anon/authenticated); the
  initiator is authenticated via JWT and re-checked as super_admin inside the edge function.
- The verification code is stored **hashed**, expires in 30 minutes, and is never returned in any
  HTTP response.
- Transfer confirmation is scoped by RLS to the recipient's own email.
- Secrets (service role, Resend/SES) live only in Edge Function secrets / Lambda env — never in any
  client bundle.

---

## 8. What redeploys vs. what doesn't (summary)
| Action | Mechanism | Redeploy? |
|--------|-----------|-----------|
| Create roles / functions / transfer infra | SQL in shared Supabase | **No** |
| Grant/allowlist a tester as admin | SQL (one insert) | **No** |
| Transfer super-admin | runtime (edge fn + RPC) | **No** |
| Add `is_admin()` gate to an app | client code | rebuild + re-upload `dist/` (frontend redeploy) |
| Repoint an app to the shared project | env change | rebuild + re-upload `dist/` |
| New servers / infrastructure | — | **Never required** |

---

## 9. Package contents (`zonicme-auth-platform.zip`)
```
auth/                     central auth app (SSO + admin/super-admin panel)
  src/App.tsx             panel UI (transfer + confirm)
  src/zonicme-admin.ts    useIsAdmin() drop-in for any app
  src/zonicme-super-admin.ts  initiate/confirm transfer helpers
sql/                      0001 roles · 0002 transfer · 0003 seed super-admin · provision · otp
functions/super-admin-transfer/  edge function (emails the code)
otp-service/              SES email-OTP service (login delivery)
README.md / build.sh      build + deploy
```
This single package is the source of truth for orbit identity. Apply the same wiring approach to
every app in the orbit.
