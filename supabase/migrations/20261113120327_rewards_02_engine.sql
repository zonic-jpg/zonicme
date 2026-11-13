-- =====================================================================
-- ZonicMe Central Rewards - Phase 1 (2/4): engine
-- Ledger posting, declarative rules, event processing (with dry-run),
-- HMAC-verified intake and the key exchange used to provision app secrets.
-- Internal helpers run with the caller's rights; only the entry points
-- (ingest_signed / api_signed / dispatch) are SECURITY DEFINER.
-- =====================================================================

-- Brand managers and app links are never erased: taking one away stamps the row instead, so the history stays.
alter table public.reward_brand_members add column if not exists removed_at timestamptz;
alter table public.reward_brand_app_links add column if not exists removed_at timestamptz;

create or replace function rewards_core.email_hash(p_email text) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  -- same convention as the hub (zonic-hub-ingest): sha256 hex of the trimmed, lower-cased email
  select case
    when p_email is null or btrim(p_email, E' \t\n\r') = '' or char_length(p_email) > 200 or position('@' in p_email) < 2 then null
    else encode(sha256(convert_to(lower(btrim(p_email, E' \t\n\r')), 'UTF8')), 'hex')
  end;
$$;

create or replace function rewards_core.mask_email(p_email text) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when p_email is null or position('@' in p_email) < 2 then null
    else left(split_part(lower(btrim(p_email)), '@', 1), 2) || '***@' || split_part(lower(btrim(p_email)), '@', 2) end;
$$;

create or replace function rewards_core.as_int(v jsonb) returns bigint
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when (v #>> '{}') ~ '^[0-9]{1,15}$' then (v #>> '{}')::bigint end;
$$;

create or replace function rewards_core.safe_ts(p text) returns timestamptz
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function rewards_core.safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function rewards_core.period_start(p_period text, p_now timestamptz, p_tz text) returns timestamptz
language sql stable set search_path = pg_catalog, pg_temp as $$
  select case p_period
    when 'day' then date_trunc('day', p_now at time zone p_tz) at time zone p_tz
    when 'week' then date_trunc('week', p_now at time zone p_tz) at time zone p_tz
    when 'month' then date_trunc('month', p_now at time zone p_tz) at time zone p_tz
    else '-infinity'::timestamptz
  end;
$$;

create or replace function rewards_core.audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb) returns void
language plpgsql set search_path = pg_catalog, public, auth, pg_temp as $$
declare v_uid uuid := auth.uid(); v_label text;
begin
  if v_uid is not null then
    select lower(u.email) into v_label from auth.users u where u.id = v_uid;
  else
    v_label := 'system';
  end if;
  insert into public.reward_audit_log (actor_user_id, actor_label, action, target_type, target_id, detail)
  values (v_uid, v_label, p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
end $$;

create or replace function rewards_core.note_intake(p_app text, p_outcome text) returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare v_app text := '(unknown)';
begin
  if exists (select 1 from public.reward_apps where app_id = p_app) then v_app := p_app; end if;
  insert into public.reward_intake_stats (app_id, outcome, bucket, hits, last_at)
  values (v_app, left(coalesce(p_outcome, 'unknown'), 40), date_trunc('hour', now()), 1, now())
  on conflict (app_id, outcome, bucket) do update set hits = public.reward_intake_stats.hits + 1, last_at = now();
end $$;

-- ---------------------------------------------------------------------
-- Conditions: {"all":[...]} | {"any":[...]} | {"not":{...}} | {"field","op","value"}
-- ---------------------------------------------------------------------
create or replace function rewards_core.jcmp(a jsonb, b jsonb) returns integer
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare ta text := a #>> '{}'; tb text := b #>> '{}';
begin
  if ta is null or tb is null or jsonb_typeof(a) in ('object','array') or jsonb_typeof(b) in ('object','array') then
    return null;
  end if;
  if ta ~ '^-?[0-9]{1,20}(\.[0-9]{1,10})?$' and tb ~ '^-?[0-9]{1,20}(\.[0-9]{1,10})?$' then
    return sign(ta::numeric - tb::numeric)::integer;
  end if;
  ta := lower(ta); tb := lower(tb);
  return case when ta = tb then 0 when ta < tb then -1 else 1 end;
end $$;

create or replace function rewards_core.eval_conditions(c jsonb, ctx jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, rewards_core, pg_temp as $$
declare item jsonb; v jsonb; t jsonb; op text; f text;
begin
  if c is null or jsonb_typeof(c) <> 'object' or c = '{}'::jsonb then return true; end if;
  if c ? 'all' then
    if jsonb_typeof(c->'all') <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(c->'all') loop
      if not rewards_core.eval_conditions(item, ctx) then return false; end if;
    end loop;
    return true;
  end if;
  if c ? 'any' then
    if jsonb_typeof(c->'any') <> 'array' then return false; end if;
    if jsonb_array_length(c->'any') = 0 then return true; end if;
    for item in select value from jsonb_array_elements(c->'any') loop
      if rewards_core.eval_conditions(item, ctx) then return true; end if;
    end loop;
    return false;
  end if;
  if c ? 'not' then return not rewards_core.eval_conditions(c->'not', ctx); end if;

  f := c->>'field'; op := coalesce(c->>'op', 'eq'); t := c->'value';
  if f is null then return false; end if;
  v := ctx #> string_to_array(f, '.');
  if v = 'null'::jsonb then v := null; end if;
  if op = 'exists' then return v is not null; end if;
  if op = 'not_exists' then return v is null; end if;
  if v is null or t is null or t = 'null'::jsonb then return false; end if;
  if op = 'eq' then return coalesce(rewards_core.jcmp(v, t) = 0, false);
  elsif op = 'ne' then return coalesce(rewards_core.jcmp(v, t) <> 0, false);
  elsif op = 'gt' then return coalesce(rewards_core.jcmp(v, t) > 0, false);
  elsif op = 'gte' then return coalesce(rewards_core.jcmp(v, t) >= 0, false);
  elsif op = 'lt' then return coalesce(rewards_core.jcmp(v, t) < 0, false);
  elsif op = 'lte' then return coalesce(rewards_core.jcmp(v, t) <= 0, false);
  elsif op = 'between' then
    return jsonb_typeof(t) = 'array' and jsonb_array_length(t) = 2
       and coalesce(rewards_core.jcmp(v, t->0) >= 0 and rewards_core.jcmp(v, t->1) <= 0, false);
  elsif op in ('in', 'not_in') then
    if jsonb_typeof(t) <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(t) loop
      if rewards_core.jcmp(v, item) = 0 then return op = 'in'; end if;
    end loop;
    return op = 'not_in';
  elsif op = 'contains' then
    return position(lower(t #>> '{}') in lower(v #>> '{}')) > 0;
  elsif op = 'starts_with' then
    return left(lower(v #>> '{}'), char_length(t #>> '{}')) = lower(t #>> '{}');
  end if;
  return false;
end $$;

create or replace function rewards_core.validate_conditions(c jsonb, p_depth integer default 0) returns void
language plpgsql immutable set search_path = pg_catalog, rewards_core, pg_temp as $$
declare item jsonb; f text; op text; grp text;
begin
  if c is null or c = '{}'::jsonb then return; end if;
  if jsonb_typeof(c) <> 'object' then raise exception 'A condition is not written correctly.'; end if;
  if p_depth > 4 then raise exception 'Conditions are nested too deeply.'; end if;
  foreach grp in array array['all','any'] loop
    if c ? grp then
      if jsonb_typeof(c->grp) <> 'array' or jsonb_array_length(c->grp) > 20 then
        raise exception 'A group of conditions can hold at most 20 conditions.';
      end if;
      for item in select value from jsonb_array_elements(c->grp) loop
        perform rewards_core.validate_conditions(item, p_depth + 1);
      end loop;
      return;
    end if;
  end loop;
  if c ? 'not' then perform rewards_core.validate_conditions(c->'not', p_depth + 1); return; end if;
  f := c->>'field'; op := coalesce(c->>'op', 'eq');
  if f is null or not (f in ('source_app','event_type','amount','currency','sku','category','brand_id','hour','dow')
       or f ~ '^metadata(\.[A-Za-z0-9_]{1,40}){1,3}$') then
    raise exception 'A condition uses a field that is not available: %', coalesce(f, '(none)');
  end if;
  if op not in ('eq','ne','gt','gte','lt','lte','between','in','not_in','contains','starts_with','exists','not_exists') then
    raise exception 'A condition uses a comparison that is not available: %', op;
  end if;
  if op not in ('exists','not_exists') and (c->'value' is null or c->'value' = 'null'::jsonb) then
    raise exception 'A condition on "%" is missing its value.', f;
  end if;
  if op in ('in','not_in') and (jsonb_typeof(c->'value') <> 'array' or jsonb_array_length(c->'value') not between 1 and 50) then
    raise exception 'A list condition on "%" needs between 1 and 50 values.', f;
  end if;
  if op = 'between' and (jsonb_typeof(c->'value') <> 'array' or jsonb_array_length(c->'value') <> 2) then
    raise exception 'A "between" condition on "%" needs two values.', f;
  end if;
end $$;

create or replace function rewards_core.validate_award(cfg jsonb) returns void
language plpgsql immutable set search_path = pg_catalog, rewards_core, pg_temp as $$
begin
  if (cfg ? 'points') = (cfg ? 'bps') then
    raise exception 'Choose either a fixed number of points or a percentage of the amount.';
  end if;
  if cfg ? 'points' and coalesce(rewards_core.as_int(cfg->'points'), 0) not between 1 and 10000000 then
    raise exception 'Fixed points must be a whole number between 1 and 10,000,000.';
  end if;
  if cfg ? 'bps' and coalesce(rewards_core.as_int(cfg->'bps'), 0) not between 1 and 100000 then
    raise exception 'The percentage must be between 0.01%% and 1000%%.';
  end if;
end $$;

create or replace function rewards_core.validate_rule(p jsonb) returns void
language plpgsql immutable set search_path = pg_catalog, rewards_core, pg_temp as $$
declare v_action text := p->>'action'; cfg jsonb := coalesce(p->'config', '{}'::jsonb);
        caps jsonb := coalesce(p->'caps', '[]'::jsonb); item jsonb;
begin
  if v_action is null or v_action not in ('award_points','award_gift_credit','badge','cashback','multiplier') then
    raise exception 'Choose what this rule awards.';
  end if;
  if jsonb_typeof(cfg) <> 'object' then raise exception 'The award settings are not written correctly.'; end if;
  if v_action in ('award_points','award_gift_credit','cashback') then
    if cfg ? 'tiers' then
      if jsonb_typeof(cfg->'tiers') <> 'array' or jsonb_array_length(cfg->'tiers') not between 1 and 10 then
        raise exception 'Add between 1 and 10 tiers.';
      end if;
      for item in select value from jsonb_array_elements(cfg->'tiers') loop
        if coalesce(item->>'min_amount', '') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' then
          raise exception 'Each tier needs the amount it starts from.';
        end if;
        perform rewards_core.validate_award(item);
        if v_action = 'cashback' and not (item ? 'bps') then raise exception 'Cashback is always a percentage of the amount.'; end if;
      end loop;
    else
      perform rewards_core.validate_award(cfg);
      if v_action = 'cashback' and not (cfg ? 'bps') then raise exception 'Cashback is always a percentage of the amount.'; end if;
    end if;
    if cfg ? 'max_points' and coalesce(rewards_core.as_int(cfg->'max_points'), 0) < 1 then
      raise exception 'The most points per event must be a whole number above zero.';
    end if;
    if cfg ? 'min_points' and coalesce(rewards_core.as_int(cfg->'min_points'), 0) < 1 then
      raise exception 'The fewest points per event must be a whole number above zero.';
    end if;
  elsif v_action = 'multiplier' then
    if coalesce(rewards_core.as_int(cfg->'factor_bps'), 0) not between 10001 and 100000 then
      raise exception 'A multiplier must be more than 1x and at most 10x.';
    end if;
  else
    if coalesce(cfg->>'badge', '') !~ '^[a-z0-9_-]{2,60}$' then
      raise exception 'Give the badge a short code using lower-case letters, numbers, dashes or underscores.';
    end if;
  end if;
  if jsonb_typeof(caps) <> 'array' or jsonb_array_length(caps) > 8 then raise exception 'A rule can have at most 8 limits.'; end if;
  for item in select value from jsonb_array_elements(caps) loop
    if coalesce(item->>'per', '') not in ('user','rule','app','campaign')
       or coalesce(item->>'period', '') not in ('day','week','month','total') then
      raise exception 'A limit must say who it applies to and over what period.';
    end if;
    if (item ? 'points') = (item ? 'count') or coalesce(rewards_core.as_int(coalesce(item->'points', item->'count')), 0) < 1 then
      raise exception 'A limit needs either a number of points or a number of awards, above zero.';
    end if;
    if item->>'per' = 'campaign' and coalesce(p->>'scope', '') <> 'campaign' then
      raise exception 'A per-campaign limit only makes sense on a campaign rule.';
    end if;
  end loop;
  perform rewards_core.validate_conditions(coalesce(p->'conditions', '{}'::jsonb), 0);
end $$;

create or replace function rewards_core.compute_award(cfg jsonb, p_amount numeric) returns bigint
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare c jsonb := cfg; t jsonb; v bigint := 0; best numeric := -1; m numeric;
begin
  if cfg ? 'tiers' then
    c := null;
    for t in select value from jsonb_array_elements(cfg->'tiers') loop
      m := (t->>'min_amount')::numeric;
      if coalesce(p_amount, 0) >= m and m > best then best := m; c := t; end if;
    end loop;
    if c is null then return 0; end if;
  end if;
  if c ? 'points' then
    v := (c->>'points')::bigint;
  elsif c ? 'bps' then
    if p_amount is null or p_amount <= 0 then return 0; end if;
    v := floor(p_amount * (c->>'bps')::numeric / 10000)::bigint;   -- exact decimal arithmetic, whole points only
    if cfg ? 'min_points' then v := greatest(v, (cfg->>'min_points')::bigint); end if;
  end if;
  if cfg ? 'max_points' then v := least(v, (cfg->>'max_points')::bigint); end if;
  return greatest(v, 0);
end $$;

-- ---------------------------------------------------------------------
-- The ONLY place a balance changes: lock the account, move the balance,
-- write the ledger row - one transaction.
-- ---------------------------------------------------------------------
create or replace function rewards_core.post_ledger(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, pg_temp as $$
declare
  a public.reward_accounts%rowtype;
  v_amount bigint := (p->>'amount')::bigint;
  v_bucket text := coalesce(p->>'bucket', 'points');
  v_type text := p->>'tx_type';
  v_new bigint;
  v_id uuid;
begin
  if v_amount is null or v_amount = 0 then raise exception 'A ledger entry needs a whole, non-zero number of points.'; end if;
  if v_bucket not in ('points','gift_credit') then raise exception 'Unknown balance.'; end if;
  select * into a from public.reward_accounts where id = (p->>'account_id')::uuid for update;
  if not found then raise exception 'That reward account does not exist.'; end if;
  v_new := (case when v_bucket = 'points' then a.points_balance else a.gift_credit_balance end) + v_amount;
  if v_new < 0 then raise exception 'There are not enough points for that.'; end if;

  perform set_config('rewards.ledger_write', 'on', true);
  update public.reward_accounts set
    points_balance = case when v_bucket = 'points' then v_new else points_balance end,
    gift_credit_balance = case when v_bucket = 'gift_credit' then v_new else gift_credit_balance end,
    lifetime_earned = lifetime_earned + case when v_type in ('earn','gift_received') then v_amount else 0 end,
    lifetime_redeemed = lifetime_redeemed + case when v_type = 'redeem' then -v_amount else 0 end,
    updated_at = now()
  where id = a.id;
  perform set_config('rewards.ledger_write', 'off', true);

  insert into public.reward_ledger (account_id, tx_type, bucket, amount, balance_after, source_app, event_id, rule_id, rule_key,
    campaign_id, redemption_id, gift_id, counterparty_account_id, actor_user_id, reason, expires_at, meta, is_demo)
  values (a.id, v_type, v_bucket, v_amount, v_new, p->>'source_app', (p->>'event_id')::uuid, (p->>'rule_id')::uuid, (p->>'rule_key')::uuid,
    (p->>'campaign_id')::uuid, (p->>'redemption_id')::uuid, (p->>'gift_id')::uuid, (p->>'counterparty_account_id')::uuid,
    (p->>'actor_user_id')::uuid, p->>'reason', (p->>'expires_at')::timestamptz, coalesce(p->'meta', '{}'::jsonb), a.is_demo)
  returning id into v_id;
  return jsonb_build_object('ledger_id', v_id, 'balance_after', v_new);
end $$;

-- ---------------------------------------------------------------------
-- Evaluate one event against the rules, in priority order.
-- ---------------------------------------------------------------------
create or replace function rewards_core.process_event_inner(p_app text, p_event jsonb, p_opts jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, pg_temp as $$
declare
  v_dry boolean := coalesce((p_opts->>'dry_run')::boolean, false);
  v_demo boolean := coalesce((p_opts->>'is_demo')::boolean, false);
  v_assume_campaign uuid := rewards_core.safe_uuid(p_opts->>'assume_campaign');
  v_assume_rules uuid[] := coalesce((select array_agg(rewards_core.safe_uuid(x)) from jsonb_array_elements_text(
      case when jsonb_typeof(p_opts->'assume_rules') = 'array' then p_opts->'assume_rules' else '[]'::jsonb end) x), '{}');
  v_now timestamptz := now();
  s public.reward_settings%rowtype;
  app public.reward_apps%rowtype;
  a public.reward_accounts%rowtype;
  r record;
  dup record;
  cap jsonb;
  v_event_key text := p_event->>'event_id';
  v_type text := lower(coalesce(p_event->>'event_type', ''));
  v_ident jsonb := case when jsonb_typeof(p_event->'identity') = 'object' then p_event->'identity' else '{}'::jsonb end;
  v_payload jsonb := coalesce(p_event->'payload', '{}'::jsonb);
  v_hash text; v_verified boolean; v_amount numeric; v_amt_txt text;
  v_eid uuid; v_ctx jsonb; v_local timestamp; v_person uuid;
  v_trace jsonb := '[]'::jsonb; v_awards jsonb := '[]'::jsonb; v_badges jsonb := '[]'::jsonb;
  v_pts bigint; v_base bigint; v_used bigint; v_cnt bigint; v_rem bigint; v_start timestamptz;
  v_total_points bigint := 0; v_total_credit bigint := 0; v_bucket text; v_why text; v_step jsonb;
begin
  select * into s from public.reward_settings where id;
  if v_dry and rewards_core.safe_ts(p_opts->>'at') is not null then v_now := rewards_core.safe_ts(p_opts->>'at'); end if;

  -- 1. shape of the event
  select * into app from public.reward_apps where app_id = p_app;
  if not found then return jsonb_build_object('status', 'invalid', 'reason', 'unknown_app'); end if;
  if app.status <> 'active' and not v_dry then return jsonb_build_object('status', 'rejected', 'reason', 'app_not_active'); end if;
  if v_type !~ '^[a-z0-9_.:-]{2,64}$' then return jsonb_build_object('status', 'invalid', 'reason', 'event_type'); end if;
  if v_event_key is null or char_length(v_event_key) not between 1 and 200 then
    return jsonb_build_object('status', 'invalid', 'reason', 'event_id');
  end if;
  if jsonb_typeof(v_payload) <> 'object' then return jsonb_build_object('status', 'invalid', 'reason', 'payload'); end if;
  if octet_length(v_payload::text) > 8000 then return jsonb_build_object('status', 'invalid', 'reason', 'payload_too_large'); end if;
  v_amt_txt := v_payload->>'amount';
  if v_amt_txt is not null then
    if v_amt_txt !~ '^[0-9]{1,13}(\.[0-9]{1,6})?$' then return jsonb_build_object('status', 'invalid', 'reason', 'amount'); end if;
    v_amount := round(v_amt_txt::numeric, 2);
  end if;
  if coalesce(v_ident->>'email_hash', '') ~ '^[a-f0-9]{64}$' then
    v_hash := v_ident->>'email_hash';
  else
    v_hash := rewards_core.email_hash(v_ident->>'email');
  end if;
  if v_hash is null then return jsonb_build_object('status', 'invalid', 'reason', 'identity'); end if;
  v_verified := coalesce(lower(v_ident->>'email_verified') in ('true', 't', '1'), false);

  -- 2. idempotency: the first delivery of (source_app, event_id) wins; the raw email is never stored
  insert into public.reward_events (source_app, event_id, event_type, email_hash, identity_verified, amount, currency, sku, category,
    brand_ref, payload, occurred_at, key_id, is_demo)
  values (p_app, v_event_key, v_type, v_hash, v_verified, v_amount, left(v_payload->>'currency', 8), left(v_payload->>'sku', 120),
    left(v_payload->>'category', 120), left(v_payload->>'brand_id', 120), v_payload, rewards_core.safe_ts(p_event->>'occurred_at'),
    rewards_core.safe_uuid(p_opts->>'key_id'), v_demo)
  on conflict (source_app, event_id) do nothing
  returning id into v_eid;
  if v_eid is null then
    select e.id, e.status, e.points_awarded, e.gift_credit_awarded, e.received_at into dup
      from public.reward_events e where e.source_app = p_app and e.event_id = v_event_key;
    return jsonb_build_object('status', 'duplicate', 'event_ref', dup.id, 'first_status', dup.status,
      'points_awarded', dup.points_awarded, 'gift_credit_awarded', dup.gift_credit_awarded, 'first_received_at', dup.received_at);
  end if;

  -- 3. the one account for this identity (it may exist long before its owner signs in to ZonicMe)
  insert into public.reward_accounts (account_type, email_hash, is_demo) values ('user', v_hash, v_demo)
  on conflict (email_hash) do nothing;
  select * into a from public.reward_accounts where email_hash = v_hash for update;
  if a.is_demo <> v_demo then v_why := 'demo_mismatch';
  elsif a.status <> 'active' then v_why := 'account_not_active';
  elsif s.require_verified_identity and not v_verified then v_why := 'identity_unverified';
  end if;
  if v_why is not null then
    update public.reward_events set status = 'rejected', reason = v_why,
      account_id = case when v_why = 'demo_mismatch' then null else a.id end where id = v_eid;
    return jsonb_build_object('status', 'rejected', 'reason', v_why, 'event_ref', v_eid);
  end if;
  if not (p_app = any(a.linked_applications)) then
    update public.reward_accounts set linked_applications = array_append(linked_applications, p_app), updated_at = now() where id = a.id;
  end if;
  if not v_demo and not v_dry then
    begin   -- keep the hub's cross-app person record in step; never let it block a reward
      v_person := public.hub_register_person(v_hash, null, p_app);
      if v_person is not null and a.hub_person_id is null then
        update public.reward_accounts set hub_person_id = v_person where id = a.id;
      end if;
    exception when others then null;
    end;
  end if;

  -- 4. what the conditions can look at
  v_local := v_now at time zone s.timezone;
  v_ctx := jsonb_build_object('source_app', p_app, 'event_type', v_type, 'amount', v_amount,
    'currency', v_payload->'currency', 'sku', v_payload->'sku', 'category', v_payload->'category',
    'brand_id', v_payload->'brand_id', 'metadata', coalesce(v_payload->'metadata', '{}'::jsonb),
    'hour', extract(hour from v_local)::integer, 'dow', extract(isodow from v_local)::integer);

  -- 5. rules, lowest priority number first
  for r in
    select ru.*, c.name as c_name
    from public.reward_rules ru
    left join public.reward_campaigns c on c.id = ru.campaign_id
    where ru.is_current and ru.is_demo = v_demo
      and (ru.active or ru.rule_key = any(v_assume_rules) or (ru.campaign_id is not null and ru.campaign_id = v_assume_campaign))
      and (ru.starts_at is null or ru.starts_at <= v_now) and (ru.ends_at is null or ru.ends_at > v_now)
      and (ru.event_type is null or ru.event_type = v_type)
      and case ru.scope
            when 'global' then true
            when 'application' then ru.app_id = p_app
            when 'brand' then (v_payload->>'brand_id') is not null and (
                   (v_payload->>'brand_id') = ru.brand_id::text
                   or exists (select 1 from public.reward_brand_app_links k
                               where k.brand_id = ru.brand_id and k.app_id = p_app and k.removed_at is null
                                 and k.external_brand_id = (v_payload->>'brand_id')))
            when 'campaign' then p_app = any(c.applications)
                   and (c.status = 'active' or c.id = v_assume_campaign)
                   and (c.starts_at is null or c.starts_at <= v_now) and (c.ends_at is null or c.ends_at > v_now)
            else false
          end
    order by ru.priority, ru.created_at, ru.id
  loop
    v_why := null; v_pts := 0; v_base := null;
    v_step := jsonb_build_object('rule_key', r.rule_key, 'rule', r.name, 'version', r.version, 'priority', r.priority,
      'scope', r.scope, 'action', r.action, 'brand_id', r.brand_id, 'campaign_id', r.campaign_id, 'campaign', r.c_name);

    if not rewards_core.eval_conditions(r.conditions, v_ctx) then
      v_why := 'conditions_not_met';
    elsif r.action = 'badge' then
      if exists (select 1 from public.reward_badges b where b.account_id = a.id and b.badge = r.config->>'badge') then
        v_why := 'badge_already_held';
      else
        insert into public.reward_badges (account_id, badge, label, rule_id, event_id, is_demo)
        values (a.id, r.config->>'badge', coalesce(nullif(r.config->>'label', ''), r.name), r.id, v_eid, v_demo);
        v_badges := v_badges || jsonb_build_object('badge', r.config->>'badge',
          'label', coalesce(nullif(r.config->>'label', ''), r.name), 'rule', r.name, 'brand_id', r.brand_id);
        v_trace := v_trace || (v_step || jsonb_build_object('outcome', 'badge'));
        if r.stop_after then exit; end if;
        continue;
      end if;
    else
      if r.action = 'multiplier' then
        v_base := floor(v_total_points::numeric * ((r.config->>'factor_bps')::numeric - 10000) / 10000)::bigint;
      else
        v_base := rewards_core.compute_award(r.config, v_amount);
      end if;
      v_pts := greatest(coalesce(v_base, 0), 0);
      if v_pts = 0 then
        v_why := case when r.action = 'multiplier' then 'nothing_to_multiply' else 'zero_award' end;
      end if;

      -- limits written on the rule
      if v_why is null then
        for cap in select value from jsonb_array_elements(r.caps) loop
          v_start := rewards_core.period_start(cap->>'period', v_now, s.timezone);
          if cap->>'per' = 'user' then
            select coalesce(sum(l.amount), 0), count(*) into v_used, v_cnt from public.reward_ledger l
             where l.account_id = a.id and l.rule_key = r.rule_key and l.tx_type = 'earn' and l.created_at >= v_start;
          elsif cap->>'per' = 'rule' then
            perform 1 from public.reward_rules x where x.id = r.id for no key update;
            select coalesce(sum(l.amount), 0), count(*) into v_used, v_cnt from public.reward_ledger l
             where l.rule_key = r.rule_key and l.tx_type = 'earn' and l.created_at >= v_start;
          elsif cap->>'per' = 'app' then
            perform 1 from public.reward_rules x where x.id = r.id for no key update;
            select coalesce(sum(l.amount), 0), count(*) into v_used, v_cnt from public.reward_ledger l
             where l.rule_key = r.rule_key and l.source_app = p_app and l.tx_type = 'earn' and l.created_at >= v_start;
          elsif cap->>'per' = 'campaign' and r.campaign_id is not null then
            perform 1 from public.reward_campaigns x where x.id = r.campaign_id for update;
            select coalesce(sum(l.amount), 0), count(*) into v_used, v_cnt from public.reward_ledger l
             where l.campaign_id = r.campaign_id and l.tx_type = 'earn' and l.created_at >= v_start;
          else
            continue;
          end if;
          if cap ? 'count' then
            if v_cnt >= (cap->>'count')::bigint then v_pts := 0; end if;
          else
            v_pts := least(v_pts, greatest((cap->>'points')::bigint - v_used, 0));
          end if;
          if v_pts = 0 then
            v_why := 'cap_reached:' || (cap->>'per') || '/' || (cap->>'period');
            exit;
          end if;
        end loop;
      end if;

      -- platform-wide daily ceiling per account (optional setting)
      if v_why is null and s.account_daily_earn_cap is not null then
        select coalesce(sum(l.amount), 0) into v_used from public.reward_ledger l
         where l.account_id = a.id and l.tx_type = 'earn'
           and l.created_at >= rewards_core.period_start('day', v_now, s.timezone);
        v_pts := least(v_pts, greatest(s.account_daily_earn_cap - v_used, 0));
        if v_pts = 0 then v_why := 'account_daily_cap'; end if;
      end if;

      -- campaign budget: locked, so concurrent events can never overspend it
      if v_why is null and r.campaign_id is not null then
        select c.budget_points - c.spent_points into v_rem from public.reward_campaigns c where c.id = r.campaign_id for update;
        v_pts := least(v_pts, greatest(coalesce(v_rem, 0), 0));
        if v_pts = 0 then v_why := 'budget_exhausted'; end if;
      end if;
    end if;

    if v_why is not null then
      v_trace := v_trace || (v_step || jsonb_build_object('outcome', 'skipped', 'why', v_why));
      continue;
    end if;

    v_bucket := case when r.action = 'award_gift_credit' then 'gift_credit' else 'points' end;
    perform rewards_core.post_ledger(jsonb_build_object(
      'account_id', a.id, 'bucket', v_bucket, 'tx_type', 'earn', 'amount', v_pts, 'source_app', p_app, 'event_id', v_eid,
      'rule_id', r.id, 'rule_key', r.rule_key, 'campaign_id', r.campaign_id,
      'expires_at', case when r.expiry_days is not null then v_now + make_interval(days => r.expiry_days) end,
      'meta', jsonb_build_object('action', r.action, 'rule_version', r.version, 'computed', v_base)));
    if r.campaign_id is not null then
      update public.reward_campaigns set spent_points = spent_points + v_pts, updated_at = now() where id = r.campaign_id;
    end if;
    if v_bucket = 'points' then v_total_points := v_total_points + v_pts; else v_total_credit := v_total_credit + v_pts; end if;
    v_awards := v_awards || jsonb_build_object('rule', r.name, 'rule_key', r.rule_key, 'action', r.action, 'bucket', v_bucket,
      'points', v_pts, 'campaign', r.c_name, 'campaign_id', r.campaign_id, 'brand_id', r.brand_id);
    v_trace := v_trace || (v_step || jsonb_build_object('outcome', 'awarded', 'points', v_pts, 'bucket', v_bucket, 'computed', v_base));
    if r.stop_after then exit; end if;
  end loop;

  select * into a from public.reward_accounts where id = a.id;
  update public.reward_events set account_id = a.id,
    status = case when v_total_points + v_total_credit > 0 or jsonb_array_length(v_badges) > 0 then 'processed' else 'no_award' end,
    points_awarded = v_total_points, gift_credit_awarded = v_total_credit, evaluation = v_trace
  where id = v_eid;

  return jsonb_build_object('status', 'accepted', 'event_ref', v_eid, 'points_awarded', v_total_points,
    'gift_credit_awarded', v_total_credit, 'awards', v_awards, 'badges', v_badges, 'trace', v_trace,
    'balance', jsonb_build_object('points', a.points_balance, 'gift_credit', a.gift_credit_balance));
end $$;

-- Dry-run runs the REAL evaluation inside a sub-transaction and then rolls it back,
-- so it reports exactly what would be awarded and is guaranteed to write nothing.
create or replace function rewards_core.process_event(p_app text, p_event jsonb, p_opts jsonb default '{}'::jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, pg_temp as $$
declare v_res jsonb; v_event jsonb := p_event;
begin
  if coalesce((p_opts->>'dry_run')::boolean, false) then
    if coalesce(v_event->>'event_id', '') = '' then
      v_event := v_event || jsonb_build_object('event_id', 'dry-run:' || gen_random_uuid());
    end if;
    begin
      v_res := rewards_core.process_event_inner(p_app, v_event, p_opts);
      raise exception sqlstate 'RWDRY';
    exception when sqlstate 'RWDRY' then
      null;
    end;
    return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('dry_run', true);
  end if;
  return rewards_core.process_event_inner(p_app, p_event, p_opts);
end $$;

-- ---------------------------------------------------------------------
-- Signed intake. signature = hex( HMAC-SHA256( key = app secret,
--   message = app_id + "." + unix_timestamp + "." + raw_body ) )
-- ---------------------------------------------------------------------
create or replace function rewards_core.verify_signature(p_app text, p_ts text, p_sig text, p_body text) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, extensions, pg_temp as $$
declare
  k record;
  v_sig text := lower(regexp_replace(coalesce(p_sig, ''), '^sha256=', ''));
  v_expect text;
  v_nonce bytea := gen_random_bytes(16);
begin
  if coalesce(p_app, '') !~ '^[a-z0-9_]{2,40}$' or v_sig !~ '^[a-f0-9]{64}$' or coalesce(p_ts, '') !~ '^[0-9]{9,11}$' then
    return jsonb_build_object('ok', false, 'reason', 'unsigned');
  end if;
  if abs(extract(epoch from now())::bigint - p_ts::bigint) > 600 then
    return jsonb_build_object('ok', false, 'reason', 'stale_timestamp');
  end if;
  for k in select id, secret, is_demo from rewards_core.app_keys where app_id = p_app and status = 'active' order by activated_at desc loop
    v_expect := encode(hmac(convert_to(p_app || '.' || p_ts || '.' || coalesce(p_body, ''), 'UTF8'), convert_to(k.secret, 'UTF8'), 'sha256'), 'hex');
    -- compare under a one-time key so the comparison leaks nothing about the expected value
    if hmac(convert_to(v_expect, 'UTF8'), v_nonce, 'sha256') = hmac(convert_to(v_sig, 'UTF8'), v_nonce, 'sha256') then
      update rewards_core.app_keys set last_used_at = now()
       where id = k.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
      return jsonb_build_object('ok', true, 'key_id', k.id, 'is_demo', k.is_demo);
    end if;
  end loop;
  return jsonb_build_object('ok', false, 'reason', 'bad_signature');
end $$;

create or replace function rewards_core.ingest_signed(p_app text, p_ts text, p_sig text, p_body text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, rewards_core, extensions, pg_temp as $$
declare v jsonb; v_event jsonb; v_res jsonb; v_app text := lower(coalesce(p_app, ''));
begin
  if not rewards_core.is_service() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_body is null or octet_length(p_body) > 32768 then
    perform rewards_core.note_intake(v_app, 'invalid_payload');
    return jsonb_build_object('status', 'invalid', 'reason', 'payload_too_large', 'http', 413);
  end if;
  v := rewards_core.verify_signature(v_app, p_ts, p_sig, p_body);
  if not (v->>'ok')::boolean then
    perform rewards_core.note_intake(v_app, v->>'reason');
    return jsonb_build_object('status', 'unauthorized', 'http', 401);
  end if;
  begin
    v_event := p_body::jsonb;
  exception when others then
    v_event := null;
  end;
  if v_event is null or jsonb_typeof(v_event) <> 'object' then
    perform rewards_core.note_intake(v_app, 'invalid_payload');
    return jsonb_build_object('status', 'invalid', 'reason', 'invalid_json', 'http', 422);
  end if;
  if (v_event ? 'source_app') and lower(v_event->>'source_app') <> v_app then
    perform rewards_core.note_intake(v_app, 'invalid_payload');
    return jsonb_build_object('status', 'invalid', 'reason', 'source_app_mismatch', 'http', 422);
  end if;
  -- an event is demo when its key OR its app is marked demo, so demo data can never mix with real data
  v_res := rewards_core.process_event(v_app, v_event, jsonb_build_object('key_id', v->>'key_id',
    'is_demo', (v->>'is_demo')::boolean or coalesce((select x.is_demo from public.reward_apps x where x.app_id = v_app), false)));
  perform rewards_core.note_intake(v_app, case v_res->>'status'
    when 'accepted' then 'accepted' when 'duplicate' then 'duplicate' when 'rejected' then 'rejected' else 'invalid_payload' end);
  return (v_res - 'trace') || jsonb_build_object('http', case when v_res->>'status' = 'invalid' then 422 else 200 end);
end $$;

-- ---------------------------------------------------------------------
-- Key exchange (Diffie-Hellman, RFC 3526 group 14, generator 2): lets the
-- hub database and an app database agree on a signing secret that never
-- leaves either database and is never displayed. Database administrators only.
-- ---------------------------------------------------------------------
create or replace function rewards_core.hex2num(p text) returns numeric
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare n numeric := 0; i integer; h text := lower(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
begin
  if h !~ '^[0-9a-f]+$' or length(h) > 1024 then raise exception 'Not a hexadecimal number.'; end if;
  for i in 1..length(h) loop
    n := n * 16 + (position(substr(h, i, 1) in '0123456789abcdef') - 1);
  end loop;
  return n;
end $$;

create or replace function rewards_core.num2hex(n numeric, p_len integer default 0) returns text
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare h text := ''; v numeric := n;
begin
  while v > 0 loop
    h := lpad(to_hex((v % 65536)::integer), 4, '0') || h;
    v := div(v, 65536);
  end loop;
  h := ltrim(h, '0');
  if h = '' then h := '0'; end if;
  return lpad(h, greatest(p_len, length(h)), '0');
end $$;

create or replace function rewards_core.modpow(b numeric, e numeric, m numeric) returns numeric
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare r numeric := 1; x numeric := b % m; k numeric := e;
begin
  while k > 0 loop
    if k % 2 = 1 then r := (r * x) % m; end if;
    x := (x * x) % m;
    k := div(k, 2);
  end loop;
  return r;
end $$;

create or replace function rewards_core.dh_prime() returns numeric
language sql immutable set search_path = pg_catalog, rewards_core, pg_temp as $$
  select rewards_core.hex2num(
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' ||
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' ||
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' ||
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' ||
    '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' ||
    '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' ||
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' ||
    '3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF');
$$;

-- step 1: returns this side's PUBLIC value (safe to display); the private half stays in the keys table
create or replace function rewards_core.dh_begin(p_app text, p_is_demo boolean default false) returns text
language plpgsql security definer set search_path = pg_catalog, public, rewards_core, extensions, pg_temp as $$
declare v_priv text := encode(gen_random_bytes(32), 'hex'); v_pub text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' or session_user = 'authenticator' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reward_apps where app_id = p_app) then raise exception 'Unknown app: %', p_app; end if;
  v_pub := rewards_core.num2hex(rewards_core.modpow(2, rewards_core.hex2num(v_priv), rewards_core.dh_prime()), 512);
  update rewards_core.app_keys set status = 'revoked', revoked_at = now(), dh_private = null where app_id = p_app and status = 'pending';
  insert into rewards_core.app_keys (app_id, status, dh_private, dh_public, is_demo)
  values (p_app, 'pending', v_priv, v_pub, p_is_demo or (select x.is_demo from public.reward_apps x where x.app_id = p_app));
  return v_pub;
end $$;

-- step 2: give it the other side's public value; stores the derived secret, returns only a fingerprint to compare
create or replace function rewards_core.dh_finish(p_app text, p_peer_public text, p_revoke_previous boolean default true) returns text
language plpgsql security definer set search_path = pg_catalog, public, rewards_core, extensions, pg_temp as $$
declare k record; v_peer numeric; v_p numeric := rewards_core.dh_prime(); v_secret text; v_fp text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' or session_user = 'authenticator' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into k from rewards_core.app_keys where app_id = p_app and status = 'pending' order by created_at desc limit 1 for update;
  if not found or k.dh_private is null then raise exception 'No key exchange is waiting for %.', p_app; end if;
  v_peer := rewards_core.hex2num(p_peer_public);
  if v_peer < 2 or v_peer > v_p - 2 then raise exception 'That public value is not valid.'; end if;
  v_secret := encode(sha256(decode(rewards_core.num2hex(rewards_core.modpow(v_peer, rewards_core.hex2num(k.dh_private), v_p), 512), 'hex')), 'hex');
  v_fp := left(encode(sha256(convert_to('zonic-rewards-fingerprint:' || v_secret, 'UTF8')), 'hex'), 16);
  if p_revoke_previous then
    update rewards_core.app_keys set status = 'revoked', revoked_at = now(), secret = null where app_id = p_app and status = 'active';
  end if;
  update rewards_core.app_keys set secret = v_secret, dh_private = null, status = 'active', activated_at = now(), fingerprint = v_fp
   where id = k.id;
  return v_fp;
end $$;

-- public wrappers for the edge functions: they run with the CALLER's rights, so only a role that
-- may use the rewards_core schema gets through, and the inner function still insists on the service role.
create or replace function public.rewards_ingest_signed(p_app text, p_ts text, p_sig text, p_body text) returns jsonb
language sql set search_path = pg_catalog, public, pg_temp as $$
  select rewards_core.ingest_signed(p_app, p_ts, p_sig, p_body);
$$;
