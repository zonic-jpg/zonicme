# ZonicMe Group — AWS Deployment Guide

**Audience:** AWS / DevOps engineer
**Scope:** Installing and deploying the six application bundles — **Rubba, MyYanga, MyAfriart, AdSpot, Owanbe Planner, ZonicMe (hub + central auth)**
**Last updated:** June 2026

---

## 0. Read this first

These six apps share one identity backbone. Where possible they all point at a **single
ZonicMe Supabase project** (one database, one auth) and a **single central login** at
`auth.zonicme.com.ng`, so one account works across every app. You can still deploy each
app independently; the shared project is what links them.

| App | Framework | Build output | Recommended AWS host | Backend |
|-----|-----------|--------------|----------------------|---------|
| **Rubba** | React + Vite (SPA) | static `dist/` | Amplify Hosting *or* S3 + CloudFront | Supabase + Claude API (Genie) |
| **MyYanga** | React + Vite (SPA) | static `dist/` | Amplify Hosting *or* S3 + CloudFront | Supabase + Edge Function + SageMaker (try-on) |
| **MyAfriart** | TanStack Start (SSR) | **Node server** `dist/` | App Runner / Elastic Beanstalk / ECS | Supabase + AI image gateway |
| **AdSpot** | React 19 (SPA) + Node API | static client + Node API | client on S3+CloudFront, API on App Runner/ECS | Supabase (`adspot_db.sql`) |
| **Owanbe Planner** | React + Vite (SPA) | static `dist/` | Amplify Hosting *or* S3 + CloudFront | Supabase |
| **ZonicMe hub** | static HTML | single file | S3 + CloudFront (or Amplify) | none (content-driven) |
| **ZonicMe central auth** | React + Vite (SPA) | static `dist/` | Amplify / S3 + CloudFront at `auth.zonicme.com.ng` | Supabase (shared project) |

**General prerequisites**
- Node.js 20 LTS, npm (and `pnpm` for AdSpot).
- AWS CLI configured; SAM CLI for MyYanga's try-on infra.
- One Supabase account with the **ZonicMe project** created.
- A domain you control (`zonicme.com.ng`) for the `auth.` subdomain.

> Every app reads its Supabase keys from environment variables. None are committed.
> Each app ships an `.env.example`; copy to `.env` and fill in.

---

## 1. Shared backbone (do this once)

1. **Create the ZonicMe Supabase project.** Note the **Project URL** and **anon key** —
   these are reused by every app as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
2. **Run each app's schema migration** in the SQL editor (each app ships its own
   `supabase/migrations/*.sql`; AdSpot ships `adspot_db.sql`, Rubba ships
   `rubba_schema.sql`). They create separate tables, so they coexist in one project.
3. **Enable auth providers** (Authentication → Providers): **Google** (OAuth client id/secret)
   and **Phone** (connect an SMS provider, e.g. Twilio, for phone OTP). Email OTP is on by default.
4. **Deploy the central login** (section 7) and register every app's URL under
   Authentication → URL Configuration → Redirect URLs.

---

## 2. Rubba (AI life-planning) — static SPA

```bash
unzip rubba-production.zip && cd rubba
cp .env.example .env          # fill VITE_SUPABASE_URL / ANON_KEY
npm install
# Run the schema:
#   Supabase SQL editor → paste supabase/migrations/<rubba_schema>.sql → Run
npm run build                 # -> dist/
```
- **Host:** Amplify Hosting (connect the repo, build `npm run build`, output `dist`) **or**
  `aws s3 sync dist/ s3://rubba-app` behind CloudFront (SPA: set 403/404 → `/index.html`).
- **Genie AI:** Rubba calls the Claude API (Sonnet) to parse wishes and write the plan.
  Do **not** ship the Anthropic key in the client — front it with a small proxy
  (Lambda + API Gateway, or a Supabase Edge Function) holding `ANTHROPIC_API_KEY`, and
  point the app at that endpoint.
- **Admin:** after first sign-up, promote yourself:
  `insert into user_roles (user_id, role) select id,'admin' from auth.users where email='you@…';`

---

## 3. MyYanga (fashion marketplace + virtual try-on)

```bash
unzip myyanga-app.zip && cd myyanga-app
cp .env.example .env
npm install
npm run build                 # -> dist/  (runs on seed data if Supabase env is blank)
```
- **Host the SPA:** Amplify or S3+CloudFront (SPA fallback to `/index.html`).
- **Supabase:** run `supabase/migrations/0001_init.sql`; set env; promote a super-admin
  (`update profiles set role='super_admin' where id=(select id from auth.users where email='…')`).
- **Virtual Try-On (GPU pipeline):** in `infra/` —
  ```bash
  cd infra && sam build && sam deploy --guided \
    --parameter-overrides ModelImageUri=<ecr-catvton-image> InstanceType=ml.g5.xlarge
  ```
  then deploy the Edge Function and set its secrets:
  ```bash
  supabase functions deploy virtual-tryon
  supabase secrets set AWS_REGION=… TRYON_API_HOST=… TRYON_AWS_ACCESS_KEY_ID=… TRYON_AWS_SECRET_ACCESS_KEY=…
  ```
  SageMaker async endpoint scales to zero when idle (~$1.4–1.6/hr only while rendering).
- **Central login:** set `VITE_ZONICME_AUTH_URL=https://auth.zonicme.com.ng` so sign-in
  routes through the hub; leave blank for the in-app modal in local dev.
- Full detail in the bundle's `ACTIVATION.md`.

---

## 4. MyAfriart (African art + AI room-staging) — **SSR, needs a Node host**

This is the one app that is **not** a static SPA — it is server-rendered (TanStack Start),
so it runs as a Node process, not a bucket of files.

```bash
unzip MyAfriart-ArtStage-AWS.zip && cd artstage
cp .env.example .env
npm install
npm run build                 # = NITRO_PRESET=node-server vite build  -> dist/
npm start                     # = node dist/server/server.js   (listens on PORT, default 3000)
```
- **Host (pick one):**
  - **AWS App Runner** — point at the repo; build `npm run build`, start `npm start`, port 3000. Simplest.
  - **Elastic Beanstalk (Node platform)** — deploy repo; run command `npm start`.
  - **ECS/Fargate** — container (`node:20-slim`, `npm ci && npm run build`, `CMD ["npm","start"]`).
- **Cloudflare is fully removed** (this bundle replaced the Workers build with the Node
  target). `npm run build:cloudflare` remains only as an optional fallback — do not use it on AWS.
- **AI room-staging** is provider-agnostic: set `AI_API_URL`, `AI_API_KEY`, `AI_IMAGE_MODEL`
  (any OpenAI-compatible image endpoint, including an AWS-hosted gateway).
- See the bundle's `DEPLOY_AWS.md`.

---

## 5. AdSpot (gamified ad-review) — client + Node API

AdSpot is a pnpm workspace: a React 19 client plus a Node API server, against Supabase.

```bash
unzip AdSpot.zip && cd adspot_extract
corepack enable && pnpm install
# Database:
#   Supabase SQL editor → paste adspot_db.sql → Run
```
- **Client:** build the brand/admin front-end (`pnpm --filter <client> build`) → host the
  static output on S3 + CloudFront (or Amplify).
- **API server:** the `api-server` package is a Node service (it bundles to `dist/index.mjs`).
  Containerise and run on **App Runner** or **ECS/Fargate**; set its Supabase service-role
  key and any payment provider keys as env vars (never in the client).
- **Env:** client gets `VITE_SUPABASE_URL` / `ANON_KEY` + `VITE_ZONICME_AUTH_URL`; API gets
  the service-role key + provider secrets.
- Inspect the bundle's `DEPLOY_AWS.md` for the exact workspace package names.

---

## 6. Owanbe Planner (event planning) — static SPA

```bash
unzip Owanbe_Joy.zip && cd owanbe
cp .env.example .env
npm install
npm run build                 # -> dist/  (chunk-size warning is benign)
```
- **Host:** Amplify or S3 + CloudFront (SPA fallback to `/index.html`).
- **Supabase:** run its migration(s) in `supabase/`; set env; promote an admin as above.
- **Central login:** set `VITE_ZONICME_AUTH_URL=https://auth.zonicme.com.ng`.

---

## 7. ZonicMe — hub + central login (the identity layer)

**Hub (showcase, static):**
```bash
# zonicme-hub.html is a single self-contained file.
aws s3 cp zonicme-hub.html s3://zonicme-hub/index.html
# front with CloudFront; map zonicme.com.ng to the distribution.
```

**Central login at `auth.zonicme.com.ng`:**
```bash
unzip zonicme-auth.zip && cd zonicme-auth
cp .env.example .env
#   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  -> the ONE ZonicMe project
#   VITE_ALLOWED_REDIRECTS=https://myyanga.com,https://myafriart.com,https://adspot.ng,https://owanbe.app,https://rubba.app,https://zonicme.com.ng
npm install && npm run build  # -> dist/
```
- Host `dist/` on Amplify or S3+CloudFront. Create a **CNAME `auth.zonicme.com.ng`** →
  the host. Add `https://auth.zonicme.com.ng` to Supabase redirect URLs (for the Google round-trip).
- Each app embeds `client/zonicme-sso.ts`: it redirects to the central page for login and
  adopts the returned session. `VITE_ALLOWED_REDIRECTS` is the open-redirect guard — only
  listed origins can receive a session.

---

## 8. Recommended order of deployment

1. Supabase project + all schema migrations + auth providers (section 1).
2. Central login at `auth.zonicme.com.ng` (section 7) + redirect URLs.
3. The static SPAs — Rubba, MyYanga, Owanbe, ZonicMe hub (fast, low-risk).
4. The server apps — MyAfriart (Node host) and AdSpot (client + API).
5. MyYanga's SageMaker try-on infra (section 3) once the storefront is live.

## 9. What only the account owner can do
Creating the Supabase project, creating AWS resources (App Runner/ECS/SageMaker/S3/CloudFront),
the `auth.zonicme.com.ng` DNS record, and pasting provider keys all happen **inside your
AWS, Supabase and DNS accounts**. The code, schemas, and the exact commands above are
complete; running them is the owner's/engineer's step.

---

### Per-app reference docs inside each bundle
- MyYanga → `ACTIVATION.md`
- MyAfriart → `DEPLOY_AWS.md`
- AdSpot → `DEPLOY_AWS.md`
- Owanbe → `DEPLOY_AWS.md`
- ZonicMe central auth → `README.md`
- Rubba → `README.md`
