-- =====================================================================
-- ZonicMe Central Rewards - Phase 1 (1/4): schema, guards, row-level security
-- Additive only. Balances change ONLY through rewards_core functions that
-- write an append-only ledger row in the same transaction.
-- =====================================================================
create schema if not exists rewards_core;
grant usage on schema rewards_core to authenticated, service_role;
comment on schema rewards_core is 'ZonicMe rewards engine internals. Not exposed through the API; reached only via public.rewards_call / rewards_ingest_signed / rewards_api_signed.';

-- ---------- registry of applications that may send reward events ----------
create table if not exists public.reward_apps (
  app_id text primary key check (app_id ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  status text not null default 'planned' check (status in ('active','paused','planned')),
  phase integer not null default 2,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.reward_apps (app_id, name, status, phase) values
  ('myyanga', 'MyYangaX', 'active', 1),
  ('myafriart', 'MyAfriArt', 'active', 1),
  ('adspot', 'AdSpot', 'active', 1),
  ('owanbe', 'Owanbe', 'planned', 2),
  ('rubba', 'Rubba', 'planned', 2),
  ('confirmahead', 'ConfirmAhead', 'planned', 2),
  ('sydef', 'Sydef', 'planned', 2)
on conflict (app_id) do nothing;

-- ---------- platform settings (single row) ----------
create table if not exists public.reward_settings (
  id boolean primary key default true check (id),
  redemption_enabled boolean not null default false,
  point_value_minor integer check (point_value_minor is null or point_value_minor > 0),
  value_currency text not null default 'NGN' check (value_currency ~ '^[A-Z]{3}$'),
  min_redeem_points bigint not null default 100 check (min_redeem_points > 0),
  gifting_enabled boolean not null default true,
  gift_daily_limit_points bigint not null default 5000 check (gift_daily_limit_points > 0),
  require_verified_identity boolean not null default true,
  account_daily_earn_cap bigint check (account_daily_earn_cap is null or account_daily_earn_cap > 0),
  velocity_earns_per_hour integer not null default 20 check (velocity_earns_per_hour > 0),
  timezone text not null default 'Africa/Lagos',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (not redemption_enabled or point_value_minor is not null)
);
insert into public.reward_settings (id) values (true) on conflict (id) do nothing;

-- ---------- brands and who manages them ----------
create table if not exists public.reward_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  status text not null default 'active' check (status in ('active','suspended')),
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_brand_members (
  brand_id uuid not null references public.reward_brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner','manager')),
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);
create index if not exists reward_brand_members_user on public.reward_brand_members(user_id);

-- which app-level brand ids belong to a ZonicMe brand (used by brand-scoped rules)
create table if not exists public.reward_brand_app_links (
  brand_id uuid not null references public.reward_brands(id) on delete cascade,
  app_id text not null references public.reward_apps(app_id),
  external_brand_id text not null check (char_length(external_brand_id) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (app_id, external_brand_id)
);
create index if not exists reward_brand_app_links_brand on public.reward_brand_app_links(brand_id);

-- ---------- one identity -> one reward account ----------
create table if not exists public.reward_accounts (
  id uuid primary key default gen_random_uuid(),
  account_type text not null check (account_type in ('user','brand')),
  email_hash text unique check (email_hash is null or email_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid unique references auth.users(id) on delete set null,
  brand_id uuid unique references public.reward_brands(id),
  hub_person_id uuid,
  points_balance bigint not null default 0 check (points_balance >= 0),
  gift_credit_balance bigint not null default 0 check (gift_credit_balance >= 0),
  lifetime_earned bigint not null default 0,
  lifetime_redeemed bigint not null default 0,
  linked_applications text[] not null default '{}',
  status text not null default 'active' check (status in ('active','frozen','closed')),
  currency text not null default 'ZPT',
  is_demo boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((account_type = 'user' and email_hash is not null and brand_id is null)
      or (account_type = 'brand' and brand_id is not null and email_hash is null and user_id is null))
);

-- ---------- campaigns (brand-owned, budgeted, approved by the platform) ----------
create table if not exists public.reward_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.reward_brands(id),
  name text not null check (char_length(name) between 2 and 100),
  description text not null default '' check (char_length(description) <= 500),
  applications text[] not null default '{}',
  budget_points bigint not null check (budget_points > 0),
  spent_points bigint not null default 0 check (spent_points >= 0),
  status text not null default 'draft' check (status in ('draft','pending','active','paused','ended','rejected')),
  starts_at timestamptz,
  ends_at timestamptz,
  decision_note text,
  approved_by uuid,
  approved_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (spent_points <= budget_points),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists reward_campaigns_brand on public.reward_campaigns(brand_id);

-- ---------- rules (declarative, versioned, evaluated by priority) ----------
create table if not exists public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '' check (char_length(description) <= 500),
  scope text not null check (scope in ('global','application','brand','campaign')),
  owner_type text not null default 'platform' check (owner_type in ('platform','brand','application')),
  app_id text references public.reward_apps(app_id),
  brand_id uuid references public.reward_brands(id),
  campaign_id uuid references public.reward_campaigns(id),
  event_type text check (event_type is null or event_type ~ '^[a-z0-9_.:-]{2,64}$'),
  conditions jsonb not null default '{}',
  action text not null check (action in ('award_points','award_gift_credit','badge','cashback','multiplier')),
  config jsonb not null default '{}',
  caps jsonb not null default '[]',
  expiry_days integer check (expiry_days is null or expiry_days between 1 and 3650),
  priority integer not null default 100 check (priority between 0 and 10000),
  stop_after boolean not null default false,
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (rule_key, version),
  check ((scope = 'campaign') = (campaign_id is not null)),
  check (scope <> 'application' or app_id is not null),
  check (scope not in ('brand','campaign') or brand_id is not null),
  check (owner_type <> 'brand' or scope = 'campaign')
);
create unique index if not exists reward_rules_one_current on public.reward_rules(rule_key) where is_current;
create index if not exists reward_rules_live on public.reward_rules(priority) where is_current and active;
create index if not exists reward_rules_campaign on public.reward_rules(campaign_id) where campaign_id is not null;
create index if not exists reward_rules_brand on public.reward_rules(brand_id) where brand_id is not null;

-- ---------- trusted events (server-to-server only; idempotent) ----------
create table if not exists public.reward_events (
  id uuid primary key default gen_random_uuid(),
  source_app text not null references public.reward_apps(app_id),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null,
  account_id uuid references public.reward_accounts(id),
  email_hash text,
  identity_verified boolean not null default false,
  amount numeric(18,2),
  currency text,
  sku text,
  category text,
  brand_ref text,
  payload jsonb not null default '{}',
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'processing' check (status in ('processing','processed','no_award','rejected')),
  reason text,
  points_awarded bigint not null default 0,
  gift_credit_awarded bigint not null default 0,
  evaluation jsonb not null default '[]',
  key_id uuid,
  is_demo boolean not null default false,
  unique (source_app, event_id)
);
create index if not exists reward_events_account on public.reward_events(account_id, received_at desc);
create index if not exists reward_events_recent on public.reward_events(received_at desc);

-- ---------- redemptions (ledger debit + a record an app can verify) ----------
create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  account_id uuid not null references public.reward_accounts(id),
  points bigint not null check (points > 0),
  from_gift_credit bigint not null default 0,
  from_points bigint not null default 0,
  point_value_minor integer not null,
  value_currency text not null,
  value_minor bigint not null,
  source_app text references public.reward_apps(app_id),
  initiated_by text not null check (initiated_by in ('user','app')),
  idempotency_key text,
  status text not null default 'issued' check (status in ('issued','fulfilled','reversed')),
  fulfilled_by_app text,
  fulfilled_at timestamptz,
  reversed_at timestamptz,
  reversed_by uuid,
  note text check (note is null or char_length(note) <= 280),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists reward_redemptions_idem on public.reward_redemptions(source_app, idempotency_key) where idempotency_key is not null;
create index if not exists reward_redemptions_account on public.reward_redemptions(account_id, created_at desc);

-- ---------- gifts ----------
create table if not exists public.reward_gifts (
  id uuid primary key default gen_random_uuid(),
  gift_type text not null check (gift_type in ('user_to_user','brand_to_user')),
  from_account_id uuid not null references public.reward_accounts(id),
  to_account_id uuid not null references public.reward_accounts(id),
  brand_id uuid references public.reward_brands(id),
  campaign_id uuid references public.reward_campaigns(id),
  points bigint not null check (points > 0),
  message text check (message is null or char_length(message) <= 280),
  sender_label text,
  recipient_hint text,
  created_by uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index if not exists reward_gifts_from on public.reward_gifts(from_account_id, created_at desc);
create index if not exists reward_gifts_to on public.reward_gifts(to_account_id, created_at desc);

-- ---------- immutable ledger ----------
create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  account_id uuid not null references public.reward_accounts(id),
  tx_type text not null check (tx_type in ('earn','redeem','gift_sent','gift_received','expire','adjustment')),
  bucket text not null default 'points' check (bucket in ('points','gift_credit')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  source_app text,
  event_id uuid references public.reward_events(id),
  rule_id uuid references public.reward_rules(id),
  rule_key uuid,
  campaign_id uuid references public.reward_campaigns(id),
  redemption_id uuid references public.reward_redemptions(id),
  gift_id uuid references public.reward_gifts(id),
  counterparty_account_id uuid references public.reward_accounts(id),
  actor_user_id uuid,
  reason text,
  expires_at timestamptz,
  meta jsonb not null default '{}',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  check ((tx_type in ('earn','gift_received') and amount > 0)
      or (tx_type in ('redeem','gift_sent','expire') and amount < 0)
      or tx_type = 'adjustment'),
  check (tx_type <> 'adjustment' or (reason is not null and char_length(btrim(reason)) >= 5))
);
create index if not exists reward_ledger_account on public.reward_ledger(account_id, seq desc);
create index if not exists reward_ledger_rule on public.reward_ledger(rule_key, created_at) where rule_key is not null;
create index if not exists reward_ledger_campaign on public.reward_ledger(campaign_id, created_at) where campaign_id is not null;
create index if not exists reward_ledger_recent on public.reward_ledger(created_at desc);

create table if not exists public.reward_badges (
  account_id uuid not null references public.reward_accounts(id),
  badge text not null check (badge ~ '^[a-z0-9_-]{2,60}$'),
  label text,
  rule_id uuid references public.reward_rules(id),
  event_id uuid references public.reward_events(id),
  is_demo boolean not null default false,
  awarded_at timestamptz not null default now(),
  primary key (account_id, badge)
);

-- ---------- immutable audit log of privileged actions ----------
create table if not exists public.reward_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_label text,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- bounded intake counters (per app, outcome, hour) ----------
create table if not exists public.reward_intake_stats (
  app_id text not null,
  outcome text not null,
  bucket timestamptz not null,
  hits bigint not null default 0,
  last_at timestamptz not null default now(),
  primary key (app_id, outcome, bucket)
);

-- ---------- per-app signing keys: private schema, no API access at all ----------
create table if not exists rewards_core.app_keys (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.reward_apps(app_id),
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  secret text,
  dh_private text,
  dh_public text,
  fingerprint text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (status <> 'active' or secret is not null)
);
create index if not exists app_keys_app on rewards_core.app_keys(app_id, status);

-- =====================================================================
-- Guards
-- =====================================================================
create or replace function rewards_core.tg_ledger_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  -- the only permitted removal: clearly-marked demo rows, during the admin demo purge
  if tg_op = 'DELETE' and old.is_demo and coalesce(current_setting('rewards.demo_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'The reward ledger is append-only (% is not allowed).', tg_op using errcode = '55000';
end $$;

create or replace function rewards_core.tg_block_truncate() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  raise exception 'This table is append-only and cannot be emptied.' using errcode = '55000';
end $$;

create or replace function rewards_core.tg_audit_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  raise exception 'The reward audit log is append-only (% is not allowed).', tg_op using errcode = '55000';
end $$;

create or replace function rewards_core.tg_account_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.points_balance <> 0 or new.gift_credit_balance <> 0 or new.lifetime_earned <> 0 or new.lifetime_redeemed <> 0 then
      raise exception 'A reward account must start at zero; balances change only through the ledger.' using errcode = '55000';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.points_balance, new.gift_credit_balance, new.lifetime_earned, new.lifetime_redeemed)
       is distinct from (old.points_balance, old.gift_credit_balance, old.lifetime_earned, old.lifetime_redeemed)
       and coalesce(current_setting('rewards.ledger_write', true), '') <> 'on' then
      raise exception 'Reward balances change only through the ledger.' using errcode = '55000';
    end if;
    if new.id <> old.id or new.account_type <> old.account_type or new.is_demo <> old.is_demo
       or new.email_hash is distinct from old.email_hash or new.brand_id is distinct from old.brand_id then
      raise exception 'A reward account''s identity cannot be changed.' using errcode = '55000';
    end if;
    return new;
  else
    if old.is_demo and coalesce(current_setting('rewards.demo_purge', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Reward accounts cannot be deleted.' using errcode = '55000';
  end if;
end $$;

create trigger reward_ledger_immutable before update or delete on public.reward_ledger
  for each row execute function rewards_core.tg_ledger_immutable();
create trigger reward_ledger_no_truncate before truncate on public.reward_ledger
  for each statement execute function rewards_core.tg_block_truncate();
create trigger reward_audit_immutable before update or delete on public.reward_audit_log
  for each row execute function rewards_core.tg_audit_immutable();
create trigger reward_audit_no_truncate before truncate on public.reward_audit_log
  for each statement execute function rewards_core.tg_block_truncate();
create trigger reward_accounts_guard before insert or update or delete on public.reward_accounts
  for each row execute function rewards_core.tg_account_guard();
create trigger reward_accounts_no_truncate before truncate on public.reward_accounts
  for each statement execute function rewards_core.tg_block_truncate();

-- =====================================================================
-- Who is asking (used by policies and by every entry point)
-- =====================================================================
create or replace function rewards_core.is_super() returns boolean
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp as $$
  select auth.uid() is not null and (
    public.is_founding_owner(auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.roles && array['owner','super_admin'])
  );
$$;

create or replace function rewards_core.is_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp as $$
  select auth.uid() is not null and (
    public.is_founding_owner(auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.roles && array['owner','super_admin','admin'])
  );
$$;

create or replace function rewards_core.is_brand_member(p_brand uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.reward_brand_members m where m.brand_id = p_brand and m.user_id = auth.uid()
  );
$$;

create or replace function rewards_core.my_account_id() returns uuid
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp as $$
  select a.id from public.reward_accounts a where a.user_id = auth.uid();
$$;

-- true only for the service role (edge functions) or a direct database session; never for a signed-in visitor
create or replace function rewards_core.is_service() returns boolean
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select case
    when coalesce(current_setting('request.jwt.claims', true), '') = '' then session_user <> 'authenticator'
    else coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  end;
$$;

-- =====================================================================
-- Row-level security: read-only for clients; all writes go through functions
-- =====================================================================
alter table public.reward_apps enable row level security;
alter table public.reward_settings enable row level security;
alter table public.reward_brands enable row level security;
alter table public.reward_brand_members enable row level security;
alter table public.reward_brand_app_links enable row level security;
alter table public.reward_accounts enable row level security;
alter table public.reward_campaigns enable row level security;
alter table public.reward_rules enable row level security;
alter table public.reward_events enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.reward_gifts enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.reward_badges enable row level security;
alter table public.reward_audit_log enable row level security;
alter table public.reward_intake_stats enable row level security;

create policy reward_apps_read on public.reward_apps for select to authenticated using (true);
create policy reward_settings_read on public.reward_settings for select to authenticated using (true);

create policy reward_brands_read on public.reward_brands for select to authenticated
  using ((select rewards_core.is_admin()) or rewards_core.is_brand_member(id));
create policy reward_brand_members_read on public.reward_brand_members for select to authenticated
  using (user_id = (select auth.uid()) or (select rewards_core.is_admin()));
create policy reward_brand_app_links_read on public.reward_brand_app_links for select to authenticated
  using ((select rewards_core.is_admin()) or rewards_core.is_brand_member(brand_id));

create policy reward_accounts_read on public.reward_accounts for select to authenticated
  using (user_id = (select auth.uid()) or (select rewards_core.is_admin())
         or (brand_id is not null and rewards_core.is_brand_member(brand_id)));

create policy reward_campaigns_read on public.reward_campaigns for select to authenticated
  using ((select rewards_core.is_admin()) or rewards_core.is_brand_member(brand_id));
create policy reward_rules_read on public.reward_rules for select to authenticated
  using ((select rewards_core.is_admin()) or (brand_id is not null and rewards_core.is_brand_member(brand_id)));

create policy reward_events_read on public.reward_events for select to authenticated
  using ((select rewards_core.is_admin()));
create policy reward_ledger_read on public.reward_ledger for select to authenticated
  using (account_id = (select rewards_core.my_account_id()) or (select rewards_core.is_admin()));
create policy reward_redemptions_read on public.reward_redemptions for select to authenticated
  using (account_id = (select rewards_core.my_account_id()) or (select rewards_core.is_admin()));
create policy reward_gifts_read on public.reward_gifts for select to authenticated
  using (from_account_id = (select rewards_core.my_account_id()) or to_account_id = (select rewards_core.my_account_id())
         or (select rewards_core.is_admin()) or (brand_id is not null and rewards_core.is_brand_member(brand_id)));
create policy reward_badges_read on public.reward_badges for select to authenticated
  using (account_id = (select rewards_core.my_account_id()) or (select rewards_core.is_admin()));
create policy reward_audit_read on public.reward_audit_log for select to authenticated
  using ((select rewards_core.is_admin()));
create policy reward_intake_stats_read on public.reward_intake_stats for select to authenticated
  using ((select rewards_core.is_admin()));
