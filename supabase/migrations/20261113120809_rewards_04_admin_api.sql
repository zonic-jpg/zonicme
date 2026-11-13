-- =====================================================================
-- ZonicMe Central Rewards - Phase 1 (4/6): admin console, the single
-- entry point for signed-in people, and the app-facing signed API.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Admin console
-- ---------------------------------------------------------------------
create or replace function rewards_core.integrity() returns jsonb
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object('accounts_checked', count(*),
    'mismatched', count(*) filter (where a.points_balance <> coalesce(l.p, 0) or a.gift_credit_balance <> coalesce(l.g, 0)),
    'ok', coalesce(bool_and(a.points_balance = coalesce(l.p, 0) and a.gift_credit_balance = coalesce(l.g, 0)), true))
  from public.reward_accounts a
  left join (select account_id, sum(amount) filter (where bucket = 'points') as p, sum(amount) filter (where bucket = 'gift_credit') as g
               from public.reward_ledger group by account_id) l on l.account_id = a.id;
$$;

create or replace function rewards_core.api_admin_overview(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare v_totals jsonb; v_apps jsonb; v_pending jsonb; v_recent jsonb; v_demo jsonb; s public.reward_settings%rowtype;
begin
  select * into s from public.reward_settings where id;
  select jsonb_build_object(
      'accounts', count(*) filter (where a.account_type = 'user'),
      'claimed', count(*) filter (where a.user_id is not null),
      'points_outstanding', coalesce(sum(a.points_balance), 0),
      'gift_credit_outstanding', coalesce(sum(a.gift_credit_balance), 0),
      'lifetime_earned', coalesce(sum(a.lifetime_earned), 0),
      'lifetime_redeemed', coalesce(sum(a.lifetime_redeemed), 0),
      'frozen', count(*) filter (where a.status <> 'active'))
    into v_totals from public.reward_accounts a where not a.is_demo;
  v_totals := v_totals || jsonb_build_object(
    'events_24h', (select count(*) from public.reward_events e where not e.is_demo and e.received_at > now() - interval '24 hours'),
    'events_7d', (select count(*) from public.reward_events e where not e.is_demo and e.received_at > now() - interval '7 days'),
    'redemptions', (select count(*) from public.reward_redemptions r where not r.is_demo),
    'gifts', (select count(*) from public.reward_gifts g where not g.is_demo),
    'liability_minor', case when s.point_value_minor is not null then
        (v_totals->>'points_outstanding')::bigint * s.point_value_minor + (v_totals->>'gift_credit_outstanding')::bigint * s.point_value_minor end);

  select coalesce(jsonb_agg(jsonb_build_object('app_id', ap.app_id, 'name', ap.name, 'status', ap.status, 'phase', ap.phase, 'is_demo', ap.is_demo,
      'events_total', (select count(*) from public.reward_events e where e.source_app = ap.app_id),
      'events_24h', (select count(*) from public.reward_events e where e.source_app = ap.app_id and e.received_at > now() - interval '24 hours'),
      'last_event_at', (select max(e.received_at) from public.reward_events e where e.source_app = ap.app_id),
      'earned', (select coalesce(sum(l.amount), 0) from public.reward_ledger l where l.source_app = ap.app_id and l.tx_type = 'earn'),
      'redeemed', (select coalesce(sum(r.points), 0) from public.reward_redemptions r where r.source_app = ap.app_id and r.status <> 'reversed'),
      'key', (select jsonb_build_object('status', k.status, 'fingerprint', k.fingerprint, 'activated_at', k.activated_at, 'last_used_at', k.last_used_at)
                from rewards_core.app_keys k where k.app_id = ap.app_id and k.status in ('active', 'pending')
               order by (k.status = 'active') desc, k.created_at desc limit 1),
      'intake_24h', (select coalesce(jsonb_object_agg(t.outcome, t.hits), '{}'::jsonb)
                       from (select i.outcome, sum(i.hits) as hits from public.reward_intake_stats i
                              where i.app_id = ap.app_id and i.bucket > now() - interval '24 hours' group by i.outcome) t))
      order by ap.is_demo, ap.phase, ap.name), '[]'::jsonb)
    into v_apps from public.reward_apps ap;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'brand', b.name, 'budget_points', c.budget_points,
      'spent_points', c.spent_points, 'applications', c.applications, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'description', c.description, 'is_demo', c.is_demo, 'updated_at', c.updated_at,
      'rules', (select count(*) from public.reward_rules r where r.campaign_id = c.id and r.is_current)) order by c.updated_at), '[]'::jsonb)
    into v_pending from public.reward_campaigns c join public.reward_brands b on b.id = c.brand_id where c.status = 'pending';

  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq desc), '[]'::jsonb) into v_recent from (
    select l.seq, l.tx_type, l.bucket, l.amount, l.source_app, l.created_at, l.reason, l.is_demo,
           rewards_core.account_label(l.account_id) as account, c.name as campaign, r.name as rule
      from public.reward_ledger l
      left join public.reward_campaigns c on c.id = l.campaign_id
      left join public.reward_rules r on r.id = l.rule_id
     order by l.seq desc limit 25) x;

  select jsonb_build_object(
      'accounts', (select count(*) from public.reward_accounts where is_demo),
      'events', (select count(*) from public.reward_events where is_demo),
      'rules', (select count(*) from public.reward_rules where is_demo),
      'brands', (select count(*) from public.reward_brands where is_demo),
      'apps', (select count(*) from public.reward_apps where is_demo)) into v_demo;

  return jsonb_build_object('totals', v_totals, 'apps', v_apps, 'pending_campaigns', v_pending, 'recent', v_recent,
    'settings', to_jsonb(s), 'integrity', rewards_core.integrity(), 'demo', v_demo,
    'is_super', rewards_core.is_super(),
    'unexplained_intake_24h', (select coalesce(sum(i.hits), 0) from public.reward_intake_stats i
                                where i.app_id = '(unknown)' and i.bucket > now() - interval '24 hours'));
end $$;

create or replace function rewards_core.api_admin_settings_save(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare o public.reward_settings%rowtype; n public.reward_settings%rowtype;
begin
  perform rewards_core.need_super();
  select * into o from public.reward_settings where id for update;
  n := o;
  if p ? 'point_value_minor' then
    if p->'point_value_minor' = 'null'::jsonb or coalesce(p->>'point_value_minor', '') = '' then n.point_value_minor := null;
    elsif coalesce(rewards_core.as_int(p->'point_value_minor'), 0) between 1 and 100000000 then n.point_value_minor := rewards_core.as_int(p->'point_value_minor')::integer;
    else raise exception 'Enter what one point is worth as a whole number of the smallest currency unit (for example kobo).';
    end if;
  end if;
  if p ? 'value_currency' then
    if upper(coalesce(p->>'value_currency', '')) !~ '^[A-Z]{3}$' then raise exception 'Use a three-letter currency code, for example NGN.'; end if;
    n.value_currency := upper(p->>'value_currency');
  end if;
  if p ? 'redemption_enabled' then n.redemption_enabled := coalesce(rewards_core.as_bool(p->'redemption_enabled'), false); end if;
  if n.redemption_enabled and n.point_value_minor is null then
    raise exception 'Set what one point is worth before switching redemption on.';
  end if;
  if p ? 'min_redeem_points' then
    if coalesce(rewards_core.as_int(p->'min_redeem_points'), 0) < 1 then raise exception 'The smallest redemption must be at least 1 point.'; end if;
    n.min_redeem_points := rewards_core.as_int(p->'min_redeem_points');
  end if;
  if p ? 'gifting_enabled' then n.gifting_enabled := coalesce(rewards_core.as_bool(p->'gifting_enabled'), false); end if;
  if p ? 'gift_daily_limit_points' then
    if coalesce(rewards_core.as_int(p->'gift_daily_limit_points'), 0) < 1 then raise exception 'The daily gift limit must be at least 1 point.'; end if;
    n.gift_daily_limit_points := rewards_core.as_int(p->'gift_daily_limit_points');
  end if;
  if p ? 'require_verified_identity' then n.require_verified_identity := coalesce(rewards_core.as_bool(p->'require_verified_identity'), true); end if;
  if p ? 'account_daily_earn_cap' then
    if p->'account_daily_earn_cap' = 'null'::jsonb or coalesce(p->>'account_daily_earn_cap', '') = '' then n.account_daily_earn_cap := null;
    elsif coalesce(rewards_core.as_int(p->'account_daily_earn_cap'), 0) >= 1 then n.account_daily_earn_cap := rewards_core.as_int(p->'account_daily_earn_cap');
    else raise exception 'The daily earning ceiling must be a whole number above zero, or left empty for no ceiling.';
    end if;
  end if;
  if p ? 'velocity_earns_per_hour' then
    if coalesce(rewards_core.as_int(p->'velocity_earns_per_hour'), 0) not between 1 and 100000 then raise exception 'The velocity alert level must be a whole number above zero.'; end if;
    n.velocity_earns_per_hour := rewards_core.as_int(p->'velocity_earns_per_hour')::integer;
  end if;
  update public.reward_settings set redemption_enabled = n.redemption_enabled, point_value_minor = n.point_value_minor,
    value_currency = n.value_currency, min_redeem_points = n.min_redeem_points, gifting_enabled = n.gifting_enabled,
    gift_daily_limit_points = n.gift_daily_limit_points, require_verified_identity = n.require_verified_identity,
    account_daily_earn_cap = n.account_daily_earn_cap, velocity_earns_per_hour = n.velocity_earns_per_hour,
    updated_at = now(), updated_by = auth.uid()
  where id returning * into n;
  perform rewards_core.audit('settings.changed', 'settings', 'platform',
    jsonb_build_object('before', to_jsonb(o) - 'updated_at' - 'updated_by', 'after', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return to_jsonb(n);
end $$;

create or replace function rewards_core.api_admin_adjust(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  a public.reward_accounts%rowtype;
  v_id uuid := rewards_core.safe_uuid(p->>'account_id');
  v_hash text := rewards_core.email_hash(p->>'email');
  v_bucket text := coalesce(nullif(p->>'bucket', ''), 'points');
  v_reason text := btrim(coalesce(p->>'reason', ''));
  v_delta bigint; r jsonb;
begin
  perform rewards_core.need_super();
  if coalesce(p->>'delta', '') !~ '^-?[0-9]{1,9}$' or (p->>'delta')::bigint = 0 then
    raise exception 'Enter the adjustment as a whole number of points, for example 500 or -500.';
  end if;
  v_delta := (p->>'delta')::bigint;
  if v_bucket not in ('points', 'gift_credit') then raise exception 'Choose which balance to adjust.'; end if;
  if char_length(v_reason) < 5 then raise exception 'Give a reason for the adjustment (at least 5 characters). It is kept in the audit log.'; end if;
  if char_length(v_reason) > 500 then raise exception 'Keep the reason under 500 characters.'; end if;
  if v_id is not null then
    select * into a from public.reward_accounts where id = v_id;
  elsif v_hash is not null then
    if v_delta > 0 then
      insert into public.reward_accounts (account_type, email_hash) values ('user', v_hash) on conflict (email_hash) do nothing;
    end if;
    select * into a from public.reward_accounts where email_hash = v_hash;
  end if;
  if a.id is null then raise exception 'No reward account was found for that person.'; end if;
  r := rewards_core.post_ledger(jsonb_build_object('account_id', a.id, 'bucket', v_bucket, 'tx_type', 'adjustment',
    'amount', v_delta, 'reason', v_reason, 'actor_user_id', auth.uid()));
  perform rewards_core.audit('balance.adjusted', 'account', a.id::text,
    jsonb_build_object('account', rewards_core.account_label(a.id), 'bucket', v_bucket, 'delta', v_delta, 'reason', v_reason,
      'balance_after', r->'balance_after', 'ledger_id', r->'ledger_id'));
  select * into a from public.reward_accounts where id = a.id;
  return jsonb_build_object('account', rewards_core.account_json(a), 'label', rewards_core.account_label(a.id), 'ledger_id', r->'ledger_id');
end $$;

create or replace function rewards_core.api_admin_rules(p jsonb) returns jsonb
language sql stable set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
  select jsonb_build_object('rules', coalesce(jsonb_agg(jsonb_build_object('rule_key', r.rule_key, 'version', r.version, 'name', r.name,
      'description', r.description, 'scope', r.scope, 'owner_type', r.owner_type, 'app_id', r.app_id, 'brand_id', r.brand_id,
      'brand', b.name, 'campaign_id', r.campaign_id, 'campaign', c.name, 'campaign_status', c.status, 'event_type', r.event_type,
      'conditions', r.conditions, 'action', r.action, 'config', r.config, 'caps', r.caps, 'expiry_days', r.expiry_days,
      'priority', r.priority, 'stop_after', r.stop_after, 'active', r.active, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
      'is_demo', r.is_demo, 'created_at', r.created_at,
      'awarded', (select coalesce(sum(l.amount), 0) from public.reward_ledger l where l.rule_key = r.rule_key and l.tx_type = 'earn'),
      'last_awarded_at', (select max(l.created_at) from public.reward_ledger l where l.rule_key = r.rule_key))
      order by (r.campaign_id is not null), r.priority, r.created_at), '[]'::jsonb),
    'apps', (select coalesce(jsonb_agg(jsonb_build_object('app_id', x.app_id, 'name', x.name, 'status', x.status, 'is_demo', x.is_demo) order by x.phase, x.name), '[]'::jsonb) from public.reward_apps x),
    'brands', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name), '[]'::jsonb) from public.reward_brands x))
  from public.reward_rules r
  left join public.reward_brands b on b.id = r.brand_id
  left join public.reward_campaigns c on c.id = r.campaign_id
  where r.is_current;
$$;

create or replace function rewards_core.api_admin_dry_run(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare r jsonb;
begin
  if coalesce(p->>'amount', '') <> '' and (p->>'amount') !~ '^[0-9]{1,13}(\.[0-9]{1,6})?$' then
    raise exception 'Enter the amount as a number, for example 15000.';
  end if;
  r := rewards_core.process_event(coalesce(p->>'app_id', ''), rewards_core.build_test_event(p),
    jsonb_build_object('dry_run', true, 'is_demo', coalesce(rewards_core.as_bool(p->'is_demo'), false),
      'assume_rules', case when jsonb_typeof(p->'assume_rules') = 'array' then p->'assume_rules' else '[]'::jsonb end,
      'assume_campaign', p->>'assume_campaign', 'at', p->>'at'));
  if r->>'status' = 'invalid' and r->>'reason' = 'unknown_app' then raise exception 'Choose the app the test event comes from.'; end if;
  if r->>'status' = 'invalid' then raise exception 'That test event could not be evaluated. Check the details and try again.'; end if;
  return r;
end $$;

create or replace function rewards_core.api_admin_velocity(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare s public.reward_settings%rowtype; v_hot jsonb; v_top jsonb; v_gift jsonb; v_rej jsonb; v_intake jsonb;
  v_hours integer := least(greatest(coalesce(rewards_core.as_int(p->'hours'), 24), 1), 168);
begin
  select * into s from public.reward_settings where id;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.earns desc), '[]'::jsonb) into v_hot from (
    select rewards_core.account_label(l.account_id) as account, l.account_id, date_trunc('hour', l.created_at) as hour,
           count(*) as earns, sum(l.amount) as points, count(distinct l.source_app) as apps,
           (select a.status from public.reward_accounts a where a.id = l.account_id) as status
      from public.reward_ledger l
     where l.tx_type = 'earn' and not l.is_demo and l.created_at > now() - make_interval(hours => v_hours)
     group by l.account_id, date_trunc('hour', l.created_at)
    having count(*) >= s.velocity_earns_per_hour
     order by count(*) desc limit 50) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.points desc), '[]'::jsonb) into v_top from (
    select rewards_core.account_label(l.account_id) as account, l.account_id, count(*) as earns, sum(l.amount) as points
      from public.reward_ledger l
     where l.tx_type = 'earn' and not l.is_demo and l.created_at > now() - make_interval(hours => v_hours)
     group by l.account_id order by sum(l.amount) desc limit 10) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.gifts desc), '[]'::jsonb) into v_gift from (
    select rewards_core.account_label(l.account_id) as account, l.account_id, count(*) as gifts, -sum(l.amount) as points,
           count(distinct l.counterparty_account_id) as recipients
      from public.reward_ledger l
     where l.tx_type = 'gift_sent' and not l.is_demo and l.created_at > now() - make_interval(hours => v_hours)
     group by l.account_id having count(*) >= 5 order by count(*) desc limit 20) x;
  select coalesce(jsonb_object_agg(t.reason, t.n), '{}'::jsonb) into v_rej from (
    select coalesce(e.reason, 'other') as reason, count(*) as n from public.reward_events e
     where e.status = 'rejected' and not e.is_demo and e.received_at > now() - make_interval(hours => v_hours) group by 1) t;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.hits desc), '[]'::jsonb) into v_intake from (
    select i.app_id, i.outcome, sum(i.hits) as hits, max(i.last_at) as last_at from public.reward_intake_stats i
     where i.bucket > now() - make_interval(hours => v_hours) and i.outcome not in ('accepted', 'duplicate')
     group by i.app_id, i.outcome) t;
  return jsonb_build_object('hours', v_hours, 'threshold', s.velocity_earns_per_hour, 'hot_accounts', v_hot, 'top_earners', v_top,
    'heavy_gifters', v_gift, 'rejected_events', v_rej, 'intake_problems', v_intake);
end $$;

create or replace function rewards_core.api_admin_brands(p jsonb) returns jsonb
language sql stable set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
  select jsonb_build_object('brands', coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status,
      'is_demo', b.is_demo, 'created_at', b.created_at,
      'campaigns', (select count(*) from public.reward_campaigns c where c.brand_id = b.id),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', lower(u.email), 'role', m.role) order by u.email), '[]'::jsonb)
                    from public.reward_brand_members m join auth.users u on u.id = m.user_id where m.brand_id = b.id and m.removed_at is null),
      'links', (select coalesce(jsonb_agg(jsonb_build_object('app_id', k.app_id, 'external_brand_id', k.external_brand_id) order by k.app_id), '[]'::jsonb)
                  from public.reward_brand_app_links k where k.brand_id = b.id and k.removed_at is null))
    order by b.name), '[]'::jsonb))
  from public.reward_brands b;
$$;

create or replace function rewards_core.api_admin_brand_save(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  b public.reward_brands%rowtype;
  v_id uuid := rewards_core.safe_uuid(p->>'id');
  v_name text := btrim(coalesce(p->>'name', ''));
  v_slug text; v_status text := coalesce(nullif(p->>'status', ''), 'active'); k jsonb;
begin
  perform rewards_core.need_super();
  if char_length(v_name) not between 2 and 80 then raise exception 'Give the brand a name (2 to 80 characters).'; end if;
  if v_status not in ('active', 'suspended') then raise exception 'A brand is either active or suspended.'; end if;
  v_slug := left(btrim(regexp_replace(lower(coalesce(nullif(btrim(p->>'slug'), ''), v_name)), '[^a-z0-9]+', '-', 'g'), '-'), 60);
  if char_length(v_slug) < 2 then raise exception 'Give the brand a name that contains letters or numbers.'; end if;
  if exists (select 1 from public.reward_brands x where x.slug = v_slug and x.id is distinct from v_id) then
    raise exception 'Another brand already uses that name. Choose a different one.';
  end if;
  if v_id is null then
    insert into public.reward_brands (name, slug, status, is_demo, created_by)
    values (v_name, v_slug, v_status, coalesce(rewards_core.as_bool(p->'is_demo'), false), auth.uid()) returning * into b;
    insert into public.reward_accounts (account_type, brand_id, is_demo) values ('brand', b.id, b.is_demo);
    perform rewards_core.audit('brand.created', 'brand', b.id::text, jsonb_build_object('name', b.name, 'is_demo', b.is_demo));
  else
    update public.reward_brands set name = v_name, slug = v_slug, status = v_status, updated_at = now() where id = v_id returning * into b;
    if b.id is null then raise exception 'That brand could not be found.'; end if;
    perform rewards_core.audit('brand.updated', 'brand', b.id::text, jsonb_build_object('name', b.name, 'status', b.status));
  end if;
  if jsonb_typeof(p->'links') = 'array' then
    -- the new list replaces the old one: links left out are stamped as removed, never erased
    update public.reward_brand_app_links set removed_at = now() where brand_id = b.id and removed_at is null;
    for k in select value from jsonb_array_elements(p->'links') loop
      if coalesce(btrim(k->>'external_brand_id'), '') = '' then continue; end if;
      if not exists (select 1 from public.reward_apps x where x.app_id = k->>'app_id') then
        raise exception 'One of the app links names an app that does not exist.';
      end if;
      if exists (select 1 from public.reward_brand_app_links x where x.app_id = k->>'app_id'
                   and x.external_brand_id = left(btrim(k->>'external_brand_id'), 120) and x.removed_at is null and x.brand_id <> b.id) then
        raise exception 'That app brand ID is already linked to another brand.';
      end if;
      insert into public.reward_brand_app_links (brand_id, app_id, external_brand_id)
      values (b.id, k->>'app_id', left(btrim(k->>'external_brand_id'), 120))
      on conflict (app_id, external_brand_id) do update set brand_id = excluded.brand_id, removed_at = null;
    end loop;
  end if;
  return to_jsonb(b);
end $$;

create or replace function rewards_core.api_admin_brand_member(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare v_brand uuid := rewards_core.safe_uuid(p->>'brand_id'); v_user uuid; v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_role text := coalesce(nullif(p->>'role', ''), 'manager');
begin
  perform rewards_core.need_super();
  if not exists (select 1 from public.reward_brands where id = v_brand) then raise exception 'That brand could not be found.'; end if;
  v_user := rewards_core.safe_uuid(p->>'user_id');
  if v_user is null then select u.id into v_user from auth.users u where lower(u.email) = v_email; end if;
  if v_user is null then
    raise exception 'That person needs to create a ZonicMe account with that email first.';
  end if;
  if coalesce(rewards_core.as_bool(p->'remove'), false) then
    update public.reward_brand_members set removed_at = now() where brand_id = v_brand and user_id = v_user and removed_at is null;
    perform rewards_core.audit('brand.member_removed', 'brand', v_brand::text, jsonb_build_object('user_id', v_user));
    return jsonb_build_object('removed', true);
  end if;
  if v_role not in ('owner', 'manager') then raise exception 'Choose owner or manager.'; end if;
  insert into public.reward_brand_members (brand_id, user_id, role, added_by) values (v_brand, v_user, v_role, auth.uid())
  on conflict (brand_id, user_id) do update set role = excluded.role, removed_at = null, added_by = excluded.added_by;
  perform rewards_core.audit('brand.member_added', 'brand', v_brand::text, jsonb_build_object('user_id', v_user, 'role', v_role));
  return jsonb_build_object('added', true, 'user_id', v_user);
end $$;

create or replace function rewards_core.api_admin_campaign_decide(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare c public.reward_campaigns%rowtype; v_dec text := p->>'decision';
begin
  perform rewards_core.need_super();
  if v_dec not in ('approve', 'reject') then raise exception 'Choose approve or reject.'; end if;
  select * into c from public.reward_campaigns where id = rewards_core.safe_uuid(p->>'campaign_id') for update;
  if not found then raise exception 'That campaign could not be found.'; end if;
  if c.status <> 'pending' then raise exception 'That campaign is not waiting for a decision.'; end if;
  update public.reward_campaigns set status = case when v_dec = 'approve' then 'active' else 'rejected' end,
    decision_note = nullif(left(btrim(coalesce(p->>'note', '')), 500), ''),
    approved_by = case when v_dec = 'approve' then auth.uid() else approved_by end,
    approved_at = case when v_dec = 'approve' then now() else approved_at end, updated_at = now()
   where id = c.id returning * into c;
  perform rewards_core.audit('campaign.' || case when v_dec = 'approve' then 'approved' else 'rejected' end, 'campaign', c.id::text,
    jsonb_build_object('name', c.name, 'budget_points', c.budget_points, 'applications', c.applications, 'note', c.decision_note));
  return to_jsonb(c);
end $$;

create or replace function rewards_core.api_admin_account_find(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare a public.reward_accounts%rowtype; v_rows jsonb;
begin
  if rewards_core.safe_uuid(p->>'account_id') is not null then
    select * into a from public.reward_accounts where id = rewards_core.safe_uuid(p->>'account_id');
  else
    select * into a from public.reward_accounts where email_hash = rewards_core.email_hash(p->>'email');
  end if;
  if a.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq desc), '[]'::jsonb) into v_rows from (
    select l.seq, l.tx_type, l.bucket, l.amount, l.balance_after, l.source_app, l.reason, l.created_at, c.name as campaign, r.name as rule
      from public.reward_ledger l
      left join public.reward_campaigns c on c.id = l.campaign_id
      left join public.reward_rules r on r.id = l.rule_id
     where l.account_id = a.id order by l.seq desc limit 30) x;
  return jsonb_build_object('found', true, 'account', rewards_core.account_json(a), 'label', rewards_core.account_label(a.id),
    'claimed', a.user_id is not null, 'ledger', v_rows);
end $$;

create or replace function rewards_core.api_admin_account_status(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare a public.reward_accounts%rowtype; v_to text := p->>'status'; v_reason text := btrim(coalesce(p->>'reason', ''));
begin
  perform rewards_core.need_super();
  if v_to not in ('active', 'frozen') then raise exception 'An account can be active or on hold.'; end if;
  if char_length(v_reason) < 5 then raise exception 'Give a reason (at least 5 characters). It is kept in the audit log.'; end if;
  update public.reward_accounts set status = v_to, updated_at = now() where id = rewards_core.safe_uuid(p->>'account_id') returning * into a;
  if a.id is null then raise exception 'That reward account does not exist.'; end if;
  perform rewards_core.audit('account.' || v_to, 'account', a.id::text,
    jsonb_build_object('account', rewards_core.account_label(a.id), 'reason', left(v_reason, 500)));
  return jsonb_build_object('account', rewards_core.account_json(a));
end $$;

create or replace function rewards_core.api_admin_app_save(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare ap public.reward_apps%rowtype; v_id text := lower(btrim(coalesce(p->>'app_id', '')));
  v_name text := btrim(coalesce(p->>'name', '')); v_status text := coalesce(nullif(p->>'status', ''), 'planned');
begin
  perform rewards_core.need_super();
  if v_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'The app ID can use lower-case letters, numbers and underscores (2 to 40 characters).'; end if;
  if v_status not in ('active', 'paused', 'planned') then raise exception 'An app is active, paused or planned.'; end if;
  select * into ap from public.reward_apps where app_id = v_id;
  if not found then
    if char_length(v_name) not between 2 and 60 then raise exception 'Give the app a name (2 to 60 characters).'; end if;
    insert into public.reward_apps (app_id, name, status, phase) values (v_id, v_name, v_status, 2) returning * into ap;
    perform rewards_core.audit('app.added', 'app', v_id, jsonb_build_object('name', v_name, 'status', v_status));
  else
    update public.reward_apps set name = case when char_length(v_name) between 2 and 60 then v_name else name end,
      status = v_status, updated_at = now() where app_id = v_id returning * into ap;
    perform rewards_core.audit('app.updated', 'app', v_id, jsonb_build_object('name', ap.name, 'status', ap.status));
  end if;
  return to_jsonb(ap);
end $$;

create or replace function rewards_core.api_admin_key_revoke(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare n integer;
begin
  perform rewards_core.need_super();
  update rewards_core.app_keys set status = 'revoked', revoked_at = now(), secret = null, dh_private = null
   where app_id = p->>'app_id' and status in ('active', 'pending');
  get diagnostics n = row_count;
  perform rewards_core.audit('app.key_revoked', 'app', p->>'app_id', jsonb_build_object('keys', n));
  return jsonb_build_object('revoked', n);
end $$;

create or replace function rewards_core.api_admin_audit(p jsonb) returns jsonb
language sql stable set search_path = pg_catalog, public, rewards_core, pg_temp as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]'::jsonb)) from (
    select l.id, l.actor_label, l.action, l.target_type, l.target_id, l.detail, l.created_at
      from public.reward_audit_log l order by l.id desc
     limit least(greatest(coalesce(rewards_core.as_int(p->'limit'), 50), 1), 200)) x;
$$;

-- Clearing demo data: the routine that takes demo rows out lives in the last migration of this set
-- (rewards_06_demo_purge). Until that one is in place this answers with a plain message.
create or replace function rewards_core.api_admin_purge_demo(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare r jsonb;
begin
  perform rewards_core.need_super();
  if to_regprocedure('rewards_core.purge_demo()') is null then
    raise exception 'Clearing demo data is not switched on yet. Demo data stays clearly marked and separate from real data.';
  end if;
  r := rewards_core.purge_demo();
  perform rewards_core.audit('demo.purged', 'demo', 'all', r);
  return r;
end $$;

-- ---------------------------------------------------------------------
-- The single door for signed-in people
-- ---------------------------------------------------------------------
create or replace function rewards_core.dispatch(p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, rewards_core, extensions, auth, pg_temp as $$
declare p jsonb := coalesce(p_args, '{}'::jsonb);
begin
  if auth.uid() is null then raise exception 'Please sign in to continue.'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'That request is not written correctly.'; end if;
  if p_action like 'admin.%' and not rewards_core.is_admin() then
    raise exception 'This area is for ZonicMe administrators.';
  end if;
  case p_action
    when 'wallet' then return rewards_core.api_wallet(p);
    when 'history' then return rewards_core.api_history(p);
    when 'redeem' then return rewards_core.api_redeem(p);
    when 'gift' then return rewards_core.api_gift(p);
    when 'brand.list' then return rewards_core.api_brand_list(p);
    when 'brand.overview' then return rewards_core.api_brand_overview(p);
    when 'brand.campaign.save' then return rewards_core.api_brand_campaign_save(p);
    when 'brand.campaign.status' then return rewards_core.api_brand_campaign_status(p);
    when 'brand.rule.save' then return rewards_core.save_rule(p, true);
    when 'brand.rule.active' then return rewards_core.set_rule_active(p, true);
    when 'brand.dry_run' then return rewards_core.api_brand_dry_run(p);
    when 'brand.gift' then return rewards_core.api_brand_gift(p);
    when 'admin.overview' then return rewards_core.api_admin_overview(p);
    when 'admin.settings.save' then return rewards_core.api_admin_settings_save(p);
    when 'admin.adjust' then return rewards_core.api_admin_adjust(p);
    when 'admin.rules' then return rewards_core.api_admin_rules(p);
    when 'admin.rule.save' then return rewards_core.save_rule(p, false);
    when 'admin.rule.active' then return rewards_core.set_rule_active(p, false);
    when 'admin.dry_run' then return rewards_core.api_admin_dry_run(p);
    when 'admin.velocity' then return rewards_core.api_admin_velocity(p);
    when 'admin.brands' then return rewards_core.api_admin_brands(p);
    when 'admin.brand.save' then return rewards_core.api_admin_brand_save(p);
    when 'admin.brand.member' then return rewards_core.api_admin_brand_member(p);
    when 'admin.campaign.decide' then return rewards_core.api_admin_campaign_decide(p);
    when 'admin.account.find' then return rewards_core.api_admin_account_find(p);
    when 'admin.account.status' then return rewards_core.api_admin_account_status(p);
    when 'admin.app.save' then return rewards_core.api_admin_app_save(p);
    when 'admin.key.disable' then return rewards_core.api_admin_key_revoke(p);
    when 'admin.audit' then return rewards_core.api_admin_audit(p);
    when 'admin.purge_demo' then return rewards_core.api_admin_purge_demo(p);
    else raise exception 'That action is not available.';
  end case;
end $$;

create or replace function public.rewards_call(p_action text, p_args jsonb default '{}'::jsonb) returns jsonb
language sql set search_path = pg_catalog, public, pg_temp as $$
  select rewards_core.dispatch(p_action, p_args);
$$;
comment on function public.rewards_call(text, jsonb) is 'ZonicMe rewards: the one entry point for signed-in people (wallet, brand console, admin console). Runs with the caller''s rights; rewards_core.dispatch checks who is asking.';

-- ---------------------------------------------------------------------
-- App-facing API (server-to-server, HMAC-signed like the intake):
-- balance | eligibility | redeem | verify_redemption | fulfil_redemption
-- ---------------------------------------------------------------------
create or replace function rewards_core.api_signed(p_app text, p_ts text, p_sig text, p_body text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, rewards_core, extensions, pg_temp as $$
declare
  v jsonb; b jsonb; v_app text := lower(coalesce(p_app, ''));
  v_demo boolean; v_action text; v_hash text; v_points bigint;
  a public.reward_accounts%rowtype;
  rd public.reward_redemptions%rowtype;
  s jsonb; r jsonb; v_idem text;
begin
  if not rewards_core.is_service() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_body is null or octet_length(p_body) > 16384 then
    return jsonb_build_object('status', 'invalid', 'reason', 'payload_too_large', 'http', 413);
  end if;
  v := rewards_core.verify_signature(v_app, p_ts, p_sig, p_body);
  if not (v->>'ok')::boolean then
    perform rewards_core.note_intake(v_app, 'api_' || (v->>'reason'));
    return jsonb_build_object('status', 'unauthorized', 'http', 401);
  end if;
  begin b := p_body::jsonb; exception when others then b := null; end;
  if b is null or jsonb_typeof(b) <> 'object' then
    return jsonb_build_object('status', 'invalid', 'reason', 'invalid_json', 'http', 422);
  end if;
  if not exists (select 1 from public.reward_apps x where x.app_id = v_app and x.status = 'active') then
    return jsonb_build_object('status', 'declined', 'reason', 'app_not_active', 'http', 200);
  end if;
  v_demo := (v->>'is_demo')::boolean or coalesce((select x.is_demo from public.reward_apps x where x.app_id = v_app), false);
  v_action := coalesce(b->>'action', '');
  s := rewards_core.settings_public();
  if coalesce(b #>> '{identity,email_hash}', '') ~ '^[a-f0-9]{64}$' then v_hash := b #>> '{identity,email_hash}';
  else v_hash := rewards_core.email_hash(b #>> '{identity,email}'); end if;
  if v_hash is not null then
    select * into a from public.reward_accounts x where x.email_hash = v_hash and x.is_demo = v_demo;
  end if;
  v_points := rewards_core.as_int(b->'points');

  if v_action in ('balance', 'eligibility') then
    if v_hash is null then return jsonb_build_object('status', 'invalid', 'reason', 'identity', 'http', 422); end if;
    r := jsonb_build_object('status', 'ok', 'http', 200, 'exists', a.id is not null,
      'points', coalesce(a.points_balance, 0), 'gift_credit', coalesce(a.gift_credit_balance, 0),
      'total', coalesce(a.points_balance + a.gift_credit_balance, 0), 'account_status', coalesce(a.status, 'none')) || s;
    if v_action = 'eligibility' then
      if v_points is null or v_points < 1 then return jsonb_build_object('status', 'invalid', 'reason', 'points', 'http', 422); end if;
      r := r || jsonb_build_object('requested', v_points,
        'eligible', (s->>'redemption_enabled')::boolean and a.id is not null and a.status = 'active'
                    and v_points >= (s->>'min_redeem_points')::bigint and a.points_balance + a.gift_credit_balance >= v_points,
        'reason', case when not (s->>'redemption_enabled')::boolean then 'redemption_off'
                       when a.id is null then 'no_account' when a.status <> 'active' then 'account_on_hold'
                       when v_points < (s->>'min_redeem_points')::bigint then 'below_minimum'
                       when a.points_balance + a.gift_credit_balance < v_points then 'insufficient_points' else 'ok' end);
    end if;
    return r;

  elsif v_action = 'redeem' then
    v_idem := b->>'idempotency_key';
    if v_hash is null then return jsonb_build_object('status', 'invalid', 'reason', 'identity', 'http', 422); end if;
    if v_idem is null or char_length(v_idem) not between 8 and 120 then
      return jsonb_build_object('status', 'invalid', 'reason', 'idempotency_key', 'http', 422);
    end if;
    if a.id is null then return jsonb_build_object('status', 'declined', 'reason', 'no_account', 'http', 200); end if;
    begin
      r := rewards_core.do_redeem(a.id, v_points, v_app, left(b->>'note', 280), 'app', v_idem, null);
    exception when raise_exception then
      return jsonb_build_object('status', 'declined', 'reason', 'not_redeemable', 'message', sqlerrm, 'http', 200);
    end;
    select * into a from public.reward_accounts where id = a.id;
    return jsonb_build_object('status', 'ok', 'http', 200, 'redemption', r - 'account_id' - 'idempotency_key',
      'balance', jsonb_build_object('points', a.points_balance, 'gift_credit', a.gift_credit_balance, 'total', a.points_balance + a.gift_credit_balance));

  elsif v_action in ('verify_redemption', 'fulfil_redemption') then
    select * into rd from public.reward_redemptions x where x.code = upper(btrim(coalesce(b->>'code', ''))) and x.is_demo = v_demo
      for update;
    if not found then return jsonb_build_object('status', 'ok', 'http', 200, 'found', false); end if;
    r := jsonb_build_object('status', 'ok', 'http', 200, 'found', true,
      'identity_match', case when v_hash is null then null else a.id is not null and a.id = rd.account_id end,
      'redemption', jsonb_build_object('code', rd.code, 'points', rd.points, 'value_minor', rd.value_minor,
        'value_currency', rd.value_currency, 'status', rd.status, 'source_app', rd.source_app,
        'fulfilled_by_app', rd.fulfilled_by_app, 'fulfilled_at', rd.fulfilled_at, 'created_at', rd.created_at));
    if v_action = 'verify_redemption' then return r; end if;
    if rd.status = 'fulfilled' and rd.fulfilled_by_app = v_app then return r || jsonb_build_object('already_fulfilled', true); end if;
    if rd.status <> 'issued' then return r || jsonb_build_object('status', 'declined', 'reason', 'not_open'); end if;
    if rd.source_app is not null and rd.source_app <> v_app then return r || jsonb_build_object('status', 'declined', 'reason', 'for_another_app'); end if;
    if v_hash is not null and (a.id is null or a.id <> rd.account_id) then
      return r || jsonb_build_object('status', 'declined', 'reason', 'identity_mismatch');
    end if;
    update public.reward_redemptions set status = 'fulfilled', fulfilled_by_app = v_app, fulfilled_at = now() where id = rd.id returning * into rd;
    return r || jsonb_build_object('redemption', (r->'redemption') || jsonb_build_object('status', rd.status,
      'fulfilled_by_app', rd.fulfilled_by_app, 'fulfilled_at', rd.fulfilled_at));
  end if;
  return jsonb_build_object('status', 'invalid', 'reason', 'unknown_action', 'http', 422);
end $$;

create or replace function public.rewards_api_signed(p_app text, p_ts text, p_sig text, p_body text) returns jsonb
language sql set search_path = pg_catalog, public, pg_temp as $$
  select rewards_core.api_signed(p_app, p_ts, p_sig, p_body);
$$;
