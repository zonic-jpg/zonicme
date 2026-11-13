-- =====================================================================
-- ZonicMe Central Rewards - Phase 1 (3/6): wallet and brand console.
-- Everything a browser can reach goes through public.rewards_call ->
-- rewards_core.dispatch (next migration), which checks who is asking
-- before it does anything.
-- =====================================================================

-- a manager who has been taken off a brand loses access at once (the row is kept, stamped removed_at)
create or replace function rewards_core.is_brand_member(p_brand uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.reward_brand_members m
     where m.brand_id = p_brand and m.user_id = auth.uid() and m.removed_at is null
  );
$$;

create or replace function rewards_core.as_bool(v jsonb) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when lower(v #>> '{}') in ('true', 't', '1') then true
              when lower(v #>> '{}') in ('false', 'f', '0') then false end;
$$;

create or replace function rewards_core.need_super() returns void
language plpgsql set search_path = pg_catalog, rewards_core, pg_temp as $$
begin
  if not rewards_core.is_super() then
    raise exception 'Only the owner or a super admin can do this.';
  end if;
end $$;

create or replace function rewards_core.need_brand(p_brand uuid) returns public.reward_brands
language plpgsql set search_path = pg_catalog, public, rewards_core, pg_temp as $$
declare b public.reward_brands%rowtype;
begin
  select * into b from public.reward_brands where id = p_brand;
  if not found or not (rewards_core.is_admin() or rewards_core.is_brand_member(p_brand)) then
    raise exception 'You do not manage this brand.';
  end if;
  return b;
end $$;

create or replace function rewards_core.settings_public() returns jsonb
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'redemption_enabled', s.redemption_enabled and s.point_value_minor is not null,
    'point_value_minor', s.point_value_minor, 'value_currency', s.value_currency,
    'min_redeem_points', s.min_redeem_points, 'gifting_enabled', s.gifting_enabled,
    'gift_daily_limit_points', s.gift_daily_limit_points)
  from public.reward_settings s where s.id;
$$;

create or replace function rewards_core.account_json(a public.reward_accounts) returns jsonb
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('id', a.id, 'points_balance', a.points_balance, 'gift_credit_balance', a.gift_credit_balance,
    'total', a.points_balance + a.gift_credit_balance, 'lifetime_earned', a.lifetime_earned,
    'lifetime_redeemed', a.lifetime_redeemed, 'linked_applications', a.linked_applications, 'status', a.status,
    'currency', a.currency, 'claimed_at', a.claimed_at, 'created_at', a.created_at, 'is_demo', a.is_demo);
$$;

create or replace function rewards_core.account_label(p_account uuid) returns text
language sql stable set search_path = pg_catalog, public, auth, pg_temp as $$
  select case when a.account_type = 'brand' then 'Brand: ' || coalesce(b.name, '?')
              when u.email is not null then lower(u.email)
              else 'Not yet claimed (' || left(a.email_hash, 8) || ')' end
  from public.reward_accounts a
  left join auth.users u on u.id = a.user_id
  left join public.reward_brands b on b.id = a.brand_id
  where a.id = p_account;
$$;

-- The account is claimed the first time a ZonicMe user with that VERIFIED email asks for their wallet.
create or replace function rewards_core.claim_account(p_uid uuid) returns public.reward_accounts
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare u record; a public.reward_accounts%rowtype; v_hash text;
begin
  select * into a from public.reward_accounts where user_id = p_uid;
  if found then return a; end if;
  select id, email, email_confirmed_at into u from auth.users where id = p_uid;
  if not found or u.email is null or u.email_confirmed_at is null then return null; end if;
  v_hash := rewards_core.email_hash(u.email);
  if v_hash is null then return null; end if;
  insert into public.reward_accounts (account_type, email_hash) values ('user', v_hash) on conflict (email_hash) do nothing;
  select * into a from public.reward_accounts where email_hash = v_hash for update;
  if a.is_demo or (a.user_id is not null and a.user_id <> p_uid) then return null; end if;
  if a.user_id is null then
    update public.reward_accounts set user_id = p_uid, claimed_at = now(), updated_at = now() where id = a.id returning * into a;
    perform rewards_core.audit('account.claimed', 'account', a.id::text,
      jsonb_build_object('points_waiting', a.points_balance, 'gift_credit_waiting', a.gift_credit_balance));
  end if;
  return a;
end $$;

-- ---------------------------------------------------------------------
-- Wallet
-- ---------------------------------------------------------------------
create or replace function rewards_core.api_wallet(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  a public.reward_accounts%rowtype;
  s public.reward_settings%rowtype;
  v_apps jsonb; v_campaigns jsonb; v_rules jsonb; v_badges jsonb; v_brands integer; v_gifted bigint;
begin
  a := rewards_core.claim_account(v_uid);
  select * into s from public.reward_settings where id;
  select count(*) into v_brands from public.reward_brand_members m where m.user_id = v_uid and m.removed_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('app_id', x.app_id, 'name', x.name, 'status', x.status) order by x.phase, x.name), '[]'::jsonb)
    into v_apps from public.reward_apps x where not x.is_demo;
  if a.id is null then
    return jsonb_build_object('account', null, 'needs_verified_email', true, 'settings', rewards_core.settings_public(),
      'apps', v_apps, 'is_admin', rewards_core.is_admin(), 'brand_count', v_brands);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'brand', b.name,
           'applications', c.applications, 'ends_at', c.ends_at,
           'offers', (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'description', r.description) order by r.priority, r.created_at), '[]'::jsonb)
                        from public.reward_rules r
                       where r.campaign_id = c.id and r.is_current and r.active
                         and (r.starts_at is null or r.starts_at <= now()) and (r.ends_at is null or r.ends_at > now())))
         order by c.created_at desc), '[]'::jsonb)
    into v_campaigns
    from public.reward_campaigns c join public.reward_brands b on b.id = c.brand_id
   where c.status = 'active' and b.status = 'active' and c.is_demo = a.is_demo and c.spent_points < c.budget_points
     and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now());

  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'description', r.description, 'app_id', r.app_id, 'ends_at', r.ends_at)
           order by r.priority, r.created_at), '[]'::jsonb)
    into v_rules
    from public.reward_rules r
   where r.is_current and r.active and r.campaign_id is null and r.is_demo = a.is_demo
     and (r.starts_at is null or r.starts_at <= now()) and (r.ends_at is null or r.ends_at > now());

  select coalesce(jsonb_agg(jsonb_build_object('badge', g.badge, 'label', coalesce(g.label, g.badge), 'awarded_at', g.awarded_at)
           order by g.awarded_at desc), '[]'::jsonb)
    into v_badges from public.reward_badges g where g.account_id = a.id;

  select coalesce(-sum(l.amount), 0) into v_gifted from public.reward_ledger l
   where l.account_id = a.id and l.tx_type = 'gift_sent'
     and l.created_at >= rewards_core.period_start('day', now(), s.timezone);

  return jsonb_build_object('account', rewards_core.account_json(a), 'settings', rewards_core.settings_public(),
    'campaigns', v_campaigns, 'always_on', v_rules, 'badges', v_badges, 'apps', v_apps,
    'gifted_today', v_gifted, 'is_admin', rewards_core.is_admin(), 'brand_count', v_brands);
end $$;

create or replace function rewards_core.api_history(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  a public.reward_accounts%rowtype;
  v_limit integer := least(greatest(coalesce(rewards_core.as_int(p->'limit'), 30), 1), 100);
  v_before bigint := rewards_core.as_int(p->'before');
  v_items jsonb; v_next bigint;
begin
  select * into a from public.reward_accounts where user_id = auth.uid();
  if not found then return jsonb_build_object('items', '[]'::jsonb, 'next_before', null); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq desc), '[]'::jsonb), min(x.seq) into v_items, v_next from (
    select l.seq, l.tx_type, l.bucket, l.amount, l.balance_after, l.source_app, ap.name as app_name, l.created_at, l.expires_at,
           case when l.tx_type = 'adjustment' then l.reason end as reason,
           c.name as campaign, b.name as brand, r.name as rule, g.message as gift_message,
           case when l.tx_type = 'gift_sent' then g.recipient_hint when l.tx_type = 'gift_received' then g.sender_label end as counterparty,
           rd.code as redemption_code, rd.status as redemption_status
      from public.reward_ledger l
      left join public.reward_apps ap on ap.app_id = l.source_app
      left join public.reward_campaigns c on c.id = l.campaign_id
      left join public.reward_brands b on b.id = c.brand_id
      left join public.reward_rules r on r.id = l.rule_id
      left join public.reward_gifts g on g.id = l.gift_id
      left join public.reward_redemptions rd on rd.id = l.redemption_id
     where l.account_id = a.id and (v_before is null or l.seq < v_before)
     order by l.seq desc limit v_limit) x;
  return jsonb_build_object('items', v_items,
    'next_before', case when jsonb_array_length(v_items) = v_limit then v_next end);
end $$;

-- Redemption = ledger debit + a record an app can verify. No money moves here.
create or replace function rewards_core.do_redeem(p_account uuid, p_points bigint, p_app text, p_note text, p_by text,
  p_idem text, p_actor uuid) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, extensions, pg_temp as $$
declare
  s public.reward_settings%rowtype;
  a public.reward_accounts%rowtype;
  rd public.reward_redemptions%rowtype;
  v_gift bigint; v_pts bigint;
begin
  select * into s from public.reward_settings where id;
  if not s.redemption_enabled or s.point_value_minor is null then
    raise exception 'Redeeming points is not switched on yet.';
  end if;
  if p_points is null or p_points < 1 then raise exception 'Enter a whole number of points to redeem.'; end if;
  if p_points < s.min_redeem_points then
    raise exception 'The smallest amount you can redeem is % points.', s.min_redeem_points;
  end if;
  if p_app is not null and not exists (select 1 from public.reward_apps x where x.app_id = p_app and x.status = 'active') then
    raise exception 'That app is not taking redemptions yet.';
  end if;
  if char_length(coalesce(p_note, '')) > 280 then raise exception 'Keep the note under 280 characters.'; end if;

  select * into a from public.reward_accounts where id = p_account for update;
  if not found then raise exception 'That reward account does not exist.'; end if;
  if p_idem is not null then      -- checked under the account lock, so a retried request can never debit twice
    select * into rd from public.reward_redemptions x where x.source_app = p_app and x.idempotency_key = p_idem;
    if found then
      if rd.account_id <> a.id then raise exception 'That request reference was already used.'; end if;
      return to_jsonb(rd) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;
  if a.status <> 'active' then raise exception 'This rewards account is on hold. Please contact ZonicMe.'; end if;
  if a.points_balance + a.gift_credit_balance < p_points then
    raise exception 'You have % points available, which is not enough for that.', a.points_balance + a.gift_credit_balance;
  end if;
  v_gift := least(a.gift_credit_balance, p_points);   -- gifted credit is used first
  v_pts := p_points - v_gift;

  insert into public.reward_redemptions (code, account_id, points, from_gift_credit, from_points, point_value_minor, value_currency,
    value_minor, source_app, initiated_by, idempotency_key, status, fulfilled_by_app, fulfilled_at, note, is_demo)
  values ('ZR-' || upper(encode(gen_random_bytes(5), 'hex')), a.id, p_points, v_gift, v_pts, s.point_value_minor, s.value_currency,
    p_points * s.point_value_minor, p_app, p_by, p_idem, case when p_by = 'app' then 'fulfilled' else 'issued' end,
    case when p_by = 'app' then p_app end, case when p_by = 'app' then now() end, nullif(btrim(coalesce(p_note, '')), ''), a.is_demo)
  returning * into rd;
  if v_gift > 0 then
    perform rewards_core.post_ledger(jsonb_build_object('account_id', a.id, 'bucket', 'gift_credit', 'tx_type', 'redeem',
      'amount', -v_gift, 'source_app', p_app, 'redemption_id', rd.id, 'actor_user_id', p_actor));
  end if;
  if v_pts > 0 then
    perform rewards_core.post_ledger(jsonb_build_object('account_id', a.id, 'bucket', 'points', 'tx_type', 'redeem',
      'amount', -v_pts, 'source_app', p_app, 'redemption_id', rd.id, 'actor_user_id', p_actor));
  end if;
  return to_jsonb(rd);
end $$;

create or replace function rewards_core.api_redeem(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare a public.reward_accounts%rowtype; v jsonb;
begin
  a := rewards_core.claim_account(auth.uid());
  if a.id is null then raise exception 'Confirm your email address first, then your wallet will open.'; end if;
  v := rewards_core.do_redeem(a.id, rewards_core.as_int(p->'points'), nullif(p->>'app_id', ''), p->>'note', 'user', null, auth.uid());
  select * into a from public.reward_accounts where id = a.id;
  return jsonb_build_object('redemption', v, 'account', rewards_core.account_json(a));
end $$;

-- User -> user gift: comes out of the sender's earned points, lands as gift credit. Atomic; cannot overspend.
create or replace function rewards_core.api_gift(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.reward_settings%rowtype;
  me public.reward_accounts%rowtype;
  them public.reward_accounts%rowtype;
  v_hash text := rewards_core.email_hash(p->>'email');
  v_points bigint := rewards_core.as_int(p->'points');
  v_msg text := nullif(btrim(coalesce(p->>'message', '')), '');
  v_sent bigint; v_gift uuid; v_label text;
begin
  select * into s from public.reward_settings where id;
  if not s.gifting_enabled then raise exception 'Gifting is not switched on yet.'; end if;
  me := rewards_core.claim_account(v_uid);
  if me.id is null then raise exception 'Confirm your email address first, then your wallet will open.'; end if;
  if v_hash is null then raise exception 'Enter the email address of the person you want to gift.'; end if;
  if v_points is null or v_points < 1 then raise exception 'Enter a whole number of points to send.'; end if;
  if char_length(coalesce(v_msg, '')) > 280 then raise exception 'Keep the message under 280 characters.'; end if;
  if v_hash = me.email_hash then raise exception 'You cannot send a gift to yourself.'; end if;

  insert into public.reward_accounts (account_type, email_hash, is_demo) values ('user', v_hash, me.is_demo)
  on conflict (email_hash) do nothing;
  select * into them from public.reward_accounts where email_hash = v_hash;
  if them.id = me.id then raise exception 'You cannot send a gift to yourself.'; end if;
  -- lock both accounts in a fixed order so two people gifting each other can never deadlock
  perform 1 from public.reward_accounts x where x.id in (me.id, them.id) order by x.id for update;
  select * into me from public.reward_accounts where id = me.id;
  select * into them from public.reward_accounts where id = them.id;
  if me.status <> 'active' then raise exception 'This rewards account is on hold. Please contact ZonicMe.'; end if;
  if them.status <> 'active' or them.is_demo <> me.is_demo or them.account_type <> 'user' then
    raise exception 'That person cannot receive gifts right now.';
  end if;
  select coalesce(-sum(l.amount), 0) into v_sent from public.reward_ledger l
   where l.account_id = me.id and l.tx_type = 'gift_sent'
     and l.created_at >= rewards_core.period_start('day', now(), s.timezone);
  if v_sent + v_points > s.gift_daily_limit_points then
    raise exception 'You can gift up to % points a day, and you have % left today.', s.gift_daily_limit_points,
      greatest(s.gift_daily_limit_points - v_sent, 0);
  end if;
  if me.points_balance < v_points then
    raise exception 'You have % points you can gift, which is not enough for that.', me.points_balance;
  end if;

  select case when coalesce(pr.name, '') <> '' and position('@' in pr.name) = 0 then left(pr.name, 60)
              else rewards_core.mask_email(u.email) end into v_label
    from auth.users u left join public.profiles pr on pr.id = u.id where u.id = v_uid;
  insert into public.reward_gifts (gift_type, from_account_id, to_account_id, points, message, sender_label, recipient_hint, created_by, is_demo)
  values ('user_to_user', me.id, them.id, v_points, v_msg, coalesce(v_label, 'A ZonicMe member'), rewards_core.mask_email(p->>'email'), v_uid, me.is_demo)
  returning id into v_gift;
  perform rewards_core.post_ledger(jsonb_build_object('account_id', me.id, 'bucket', 'points', 'tx_type', 'gift_sent',
    'amount', -v_points, 'gift_id', v_gift, 'counterparty_account_id', them.id, 'actor_user_id', v_uid));
  perform rewards_core.post_ledger(jsonb_build_object('account_id', them.id, 'bucket', 'gift_credit', 'tx_type', 'gift_received',
    'amount', v_points, 'gift_id', v_gift, 'counterparty_account_id', me.id, 'actor_user_id', v_uid));
  select * into me from public.reward_accounts where id = me.id;
  return jsonb_build_object('gift_id', v_gift, 'points', v_points, 'recipient', rewards_core.mask_email(p->>'email'),
    'account', rewards_core.account_json(me));
end $$;

-- ---------------------------------------------------------------------
-- Rules (shared by the brand console and the admin console)
-- ---------------------------------------------------------------------
create or replace function rewards_core.save_rule(p jsonb, p_as_brand boolean) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  v_key uuid := rewards_core.safe_uuid(p->>'rule_key');
  cur public.reward_rules%rowtype;
  c public.reward_campaigns%rowtype;
  nw public.reward_rules%rowtype;
  v_campaign uuid := rewards_core.safe_uuid(p->>'campaign_id');
  v_scope text; v_owner text; v_app text; v_brand uuid; v_demo boolean := false;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_desc text := btrim(coalesce(p->>'description', ''));
  v_event text := nullif(lower(btrim(coalesce(p->>'event_type', ''))), '');
  v_priority integer; v_expiry integer; v_starts timestamptz; v_ends timestamptz;
begin
  if char_length(v_name) not between 2 and 120 then raise exception 'Give the rule a name (2 to 120 characters).'; end if;
  if char_length(v_desc) > 500 then raise exception 'Keep the description under 500 characters.'; end if;
  if v_key is not null then
    select * into cur from public.reward_rules where rule_key = v_key and is_current for update;
    if not found then raise exception 'That rule could not be found.'; end if;
    v_campaign := cur.campaign_id;      -- a rule never moves between campaigns
  end if;

  if v_campaign is not null then
    select * into c from public.reward_campaigns where id = v_campaign;
    if not found then raise exception 'That campaign could not be found.'; end if;
    if p_as_brand then perform rewards_core.need_brand(c.brand_id); else perform rewards_core.need_super(); end if;
    if c.status = 'ended' then raise exception 'This campaign has ended, so its rules can no longer change.'; end if;
    v_scope := 'campaign'; v_owner := 'brand'; v_brand := c.brand_id; v_demo := c.is_demo;
  else
    if p_as_brand then raise exception 'Choose the campaign this rule belongs to.'; end if;
    perform rewards_core.need_super();
    v_scope := coalesce(nullif(p->>'scope', ''), cur.scope, 'global');
    if v_scope not in ('global', 'application', 'brand') then raise exception 'Choose where this rule applies.'; end if;
    if v_scope = 'application' then
      v_app := p->>'app_id';
      if not exists (select 1 from public.reward_apps x where x.app_id = v_app) then
        raise exception 'Choose the app this rule applies to.';
      end if;
    elsif v_scope = 'brand' then
      v_brand := rewards_core.safe_uuid(p->>'brand_id');
      if not exists (select 1 from public.reward_brands x where x.id = v_brand) then
        raise exception 'Choose the brand this rule applies to.';
      end if;
    end if;
    v_owner := case when v_scope = 'application' then 'application' else 'platform' end;
    v_demo := coalesce(rewards_core.as_bool(p->'is_demo'), cur.is_demo, false);
  end if;

  perform rewards_core.validate_rule(p || jsonb_build_object('scope', v_scope));
  if v_event is not null and v_event !~ '^[a-z0-9_.:-]{2,64}$' then
    raise exception 'The event type can only use lower-case letters, numbers, dots, dashes and underscores.';
  end if;
  v_priority := coalesce(rewards_core.as_int(p->'priority')::integer, cur.priority, 100);
  if v_priority not between 0 and 10000 then raise exception 'Priority must be between 0 and 10000 (lower runs first).'; end if;
  v_expiry := rewards_core.as_int(p->'expiry_days')::integer;
  if v_expiry is not null and v_expiry not between 1 and 3650 then raise exception 'Points can expire after 1 to 3650 days.'; end if;
  v_starts := rewards_core.safe_ts(p->>'starts_at'); v_ends := rewards_core.safe_ts(p->>'ends_at');
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'The rule must end after it starts.';
  end if;

  if cur.id is not null then
    update public.reward_rules set is_current = false, superseded_at = now() where id = cur.id;
  end if;
  insert into public.reward_rules (rule_key, version, is_current, name, description, scope, owner_type, app_id, brand_id, campaign_id,
    event_type, conditions, action, config, caps, expiry_days, priority, stop_after, active, starts_at, ends_at, is_demo, created_by)
  values (coalesce(cur.rule_key, gen_random_uuid()), coalesce(cur.version, 0) + 1, true, v_name, v_desc, v_scope, v_owner, v_app, v_brand,
    v_campaign, v_event, coalesce(p->'conditions', '{}'::jsonb), p->>'action', coalesce(p->'config', '{}'::jsonb),
    coalesce(p->'caps', '[]'::jsonb), v_expiry, v_priority, coalesce(rewards_core.as_bool(p->'stop_after'), false),
    coalesce(rewards_core.as_bool(p->'active'), cur.active, false), v_starts, v_ends, v_demo, auth.uid())
  returning * into nw;
  perform rewards_core.audit('rule.saved', 'rule', nw.rule_key::text,
    jsonb_build_object('name', nw.name, 'version', nw.version, 'active', nw.active, 'scope', nw.scope, 'campaign_id', nw.campaign_id));
  return to_jsonb(nw);
end $$;

create or replace function rewards_core.set_rule_active(p jsonb, p_as_brand boolean) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare cur public.reward_rules%rowtype; v_on boolean := rewards_core.as_bool(p->'active');
begin
  if v_on is null then raise exception 'Say whether the rule should be on or off.'; end if;
  select * into cur from public.reward_rules where rule_key = rewards_core.safe_uuid(p->>'rule_key') and is_current for update;
  if not found then raise exception 'That rule could not be found.'; end if;
  if p_as_brand then
    if cur.campaign_id is null or cur.brand_id is null then raise exception 'You do not manage this rule.'; end if;
    perform rewards_core.need_brand(cur.brand_id);
  else
    perform rewards_core.need_super();
  end if;
  update public.reward_rules set active = v_on where id = cur.id returning * into cur;
  perform rewards_core.audit(case when v_on then 'rule.switched_on' else 'rule.switched_off' end, 'rule', cur.rule_key::text,
    jsonb_build_object('name', cur.name, 'version', cur.version));
  return to_jsonb(cur);
end $$;

-- ---------------------------------------------------------------------
-- Brand console
-- ---------------------------------------------------------------------
create or replace function rewards_core.api_brand_list(p jsonb) returns jsonb
language sql stable set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
  select jsonb_build_object('is_admin', rewards_core.is_admin(), 'brands',
    coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status, 'is_demo', b.is_demo)
      order by b.name), '[]'::jsonb))
  from public.reward_brands b
  where rewards_core.is_admin() or rewards_core.is_brand_member(b.id);
$$;

create or replace function rewards_core.api_brand_overview(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  b public.reward_brands%rowtype;
  v_campaigns jsonb; v_by_app jsonb; v_gifts jsonb; v_apps jsonb;
  v_earned bigint; v_gifted bigint; v_out bigint; v_budget bigint; v_spent bigint; v_earners bigint;
begin
  b := rewards_core.need_brand(rewards_core.safe_uuid(p->>'brand_id'));

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'applications', c.applications,
           'budget_points', c.budget_points, 'spent_points', c.spent_points, 'status', c.status, 'starts_at', c.starts_at,
           'ends_at', c.ends_at, 'decision_note', c.decision_note, 'approved_at', c.approved_at, 'is_demo', c.is_demo,
           'created_at', c.created_at,
           'earners', (select count(distinct l.account_id) from public.reward_ledger l where l.campaign_id = c.id),
           'rules', (select coalesce(jsonb_agg(jsonb_build_object('rule_key', r.rule_key, 'version', r.version, 'name', r.name,
                        'description', r.description, 'event_type', r.event_type, 'conditions', r.conditions, 'action', r.action,
                        'config', r.config, 'caps', r.caps, 'expiry_days', r.expiry_days, 'priority', r.priority,
                        'stop_after', r.stop_after, 'active', r.active, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
                        'awarded', (select coalesce(sum(l.amount), 0) from public.reward_ledger l where l.rule_key = r.rule_key and l.tx_type = 'earn'))
                      order by r.priority, r.created_at), '[]'::jsonb)
                       from public.reward_rules r where r.campaign_id = c.id and r.is_current))
         order by c.created_at desc), '[]'::jsonb),
         coalesce(sum(c.budget_points), 0), coalesce(sum(c.spent_points), 0)
    into v_campaigns, v_budget, v_spent
    from public.reward_campaigns c where c.brand_id = b.id;

  select coalesce(jsonb_agg(jsonb_build_object('app_id', x.source_app, 'name', coalesce(ap.name, x.source_app), 'earned', x.earned,
           'events', x.events, 'earners', x.earners) order by x.earned desc), '[]'::jsonb), coalesce(sum(x.earned), 0)
    into v_by_app, v_earned
    from (select l.source_app, sum(l.amount) as earned, count(distinct l.event_id) as events, count(distinct l.account_id) as earners
            from public.reward_ledger l join public.reward_campaigns c on c.id = l.campaign_id
           where c.brand_id = b.id and l.tx_type = 'earn' group by l.source_app) x
    left join public.reward_apps ap on ap.app_id = x.source_app;

  select coalesce(sum(g.points), 0) into v_gifted from public.reward_gifts g where g.brand_id = b.id;
  select coalesce(jsonb_agg(jsonb_build_object('points', g.points, 'recipient', g.recipient_hint, 'message', g.message,
           'campaign', c.name, 'created_at', g.created_at) order by g.created_at desc), '[]'::jsonb)
    into v_gifts
    from (select * from public.reward_gifts where brand_id = b.id order by created_at desc limit 20) g
    left join public.reward_campaigns c on c.id = g.campaign_id;

  -- Points this brand funded that people still hold. Points are not tagged once in a wallet, so this is a
  -- pro-rata estimate: each holder's current balance in proportion to what this brand contributed.
  select coalesce(sum(least(i.issued, floor((a.points_balance + a.gift_credit_balance)::numeric * i.issued / nullif(a.lifetime_earned, 0)))), 0)::bigint,
         count(*)
    into v_out, v_earners
    from (select l.account_id, sum(l.amount) as issued
            from public.reward_ledger l join public.reward_campaigns c on c.id = l.campaign_id
           where c.brand_id = b.id and l.tx_type in ('earn', 'gift_received') group by l.account_id) i
    join public.reward_accounts a on a.id = i.account_id;

  select coalesce(jsonb_agg(jsonb_build_object('app_id', x.app_id, 'name', x.name) order by x.phase, x.name), '[]'::jsonb)
    into v_apps from public.reward_apps x where x.status = 'active' and x.is_demo = b.is_demo;

  return jsonb_build_object(
    'brand', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status, 'is_demo', b.is_demo),
    'campaigns', v_campaigns, 'apps', v_apps, 'recent_gifts', v_gifts,
    'stats', jsonb_build_object('budget_total', v_budget, 'budget_spent', v_spent, 'earned_total', v_earned,
      'gifted_total', v_gifted, 'issued_total', v_earned + v_gifted, 'people_reached', v_earners,
      'outstanding_estimate', v_out, 'redeemed_estimate', greatest(v_earned + v_gifted - v_out, 0), 'by_app', v_by_app),
    'settings', rewards_core.settings_public());
end $$;

create or replace function rewards_core.api_brand_campaign_save(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  b public.reward_brands%rowtype;
  c public.reward_campaigns%rowtype;
  v_id uuid := rewards_core.safe_uuid(p->>'id');
  v_name text := btrim(coalesce(p->>'name', ''));
  v_desc text := btrim(coalesce(p->>'description', ''));
  v_apps text[]; v_budget bigint := rewards_core.as_int(p->'budget_points');
  v_starts timestamptz := rewards_core.safe_ts(p->>'starts_at');
  v_ends timestamptz := rewards_core.safe_ts(p->>'ends_at');
  v_submit boolean := coalesce(rewards_core.as_bool(p->'submit'), false);
  v_status text;
begin
  if v_id is not null then
    select * into c from public.reward_campaigns where id = v_id for update;
    if not found then raise exception 'That campaign could not be found.'; end if;
    b := rewards_core.need_brand(c.brand_id);
  else
    b := rewards_core.need_brand(rewards_core.safe_uuid(p->>'brand_id'));
  end if;
  if b.status <> 'active' then raise exception 'This brand is suspended, so its campaigns cannot change.'; end if;
  if c.status = 'ended' then raise exception 'This campaign has ended and can no longer change.'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'Give the campaign a name (2 to 100 characters).'; end if;
  if char_length(v_desc) > 500 then raise exception 'Keep the description under 500 characters.'; end if;
  if jsonb_typeof(p->'applications') <> 'array' or jsonb_array_length(p->'applications') = 0 then
    raise exception 'Choose at least one app for this campaign.';
  end if;
  select array_agg(distinct x order by x) into v_apps from jsonb_array_elements_text(p->'applications') x;
  if exists (select 1 from unnest(v_apps) x where not exists (
      select 1 from public.reward_apps ap where ap.app_id = x and ap.status = 'active' and ap.is_demo = b.is_demo)) then
    raise exception 'One of the chosen apps is not taking reward events yet.';
  end if;
  if v_budget is null or v_budget not between 1 and 1000000000000 then
    raise exception 'Enter the campaign budget as a whole number of points.';
  end if;
  if v_budget < coalesce(c.spent_points, 0) then
    raise exception 'The budget cannot be lower than the % points already awarded.', c.spent_points;
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'The campaign must end after it starts.';
  end if;

  if c.id is null then
    insert into public.reward_campaigns (brand_id, name, description, applications, budget_points, status, starts_at, ends_at, is_demo, created_by)
    values (b.id, v_name, v_desc, v_apps, v_budget, case when v_submit then 'pending' else 'draft' end, v_starts, v_ends, b.is_demo, auth.uid())
    returning * into c;
    perform rewards_core.audit('campaign.created', 'campaign', c.id::text,
      jsonb_build_object('name', c.name, 'budget_points', c.budget_points, 'applications', c.applications, 'status', c.status));
  else
    v_status := c.status;
    -- a bigger budget or a different set of apps on an approved campaign goes back for approval (unless a super admin made the change)
    if c.status in ('active', 'paused') and (v_budget > c.budget_points or v_apps <> c.applications) and not rewards_core.is_super() then
      v_status := 'pending';
    elsif c.status in ('draft', 'rejected') and v_submit then
      v_status := 'pending';
    elsif c.status = 'rejected' then
      v_status := 'draft';
    end if;
    update public.reward_campaigns set name = v_name, description = v_desc, applications = v_apps, budget_points = v_budget,
      starts_at = v_starts, ends_at = v_ends, status = v_status, updated_at = now()
     where id = c.id returning * into c;
    perform rewards_core.audit('campaign.updated', 'campaign', c.id::text,
      jsonb_build_object('name', c.name, 'budget_points', c.budget_points, 'applications', c.applications, 'status', c.status));
  end if;
  return to_jsonb(c);
end $$;

create or replace function rewards_core.api_brand_campaign_status(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare c public.reward_campaigns%rowtype; v_to text := p->>'status'; ok boolean;
begin
  select * into c from public.reward_campaigns where id = rewards_core.safe_uuid(p->>'campaign_id') for update;
  if not found then raise exception 'That campaign could not be found.'; end if;
  perform rewards_core.need_brand(c.brand_id);
  ok := case
    when c.status in ('draft', 'rejected') and v_to = 'pending' then true     -- send for approval
    when c.status = 'pending' and v_to = 'draft' then true                    -- withdraw
    when c.status = 'active' and v_to = 'paused' then true
    when c.status = 'paused' and v_to = 'active' and c.approved_at is not null then true
    when c.status <> 'ended' and v_to = 'ended' then true
    else false end;
  if not ok then raise exception 'That change is not available for a campaign that is %.', c.status; end if;
  update public.reward_campaigns set status = v_to, updated_at = now() where id = c.id returning * into c;
  perform rewards_core.audit('campaign.status', 'campaign', c.id::text, jsonb_build_object('name', c.name, 'status', c.status));
  return to_jsonb(c);
end $$;

-- Build a test event from the simple fields the consoles collect.
create or replace function rewards_core.build_test_event(p jsonb) returns jsonb
language sql stable set search_path = pg_catalog, rewards_core, pg_temp as $$
  select jsonb_build_object(
    'event_type', coalesce(nullif(lower(btrim(p->>'event_type')), ''), 'purchase_completed'),
    'identity', jsonb_build_object('email', coalesce(nullif(btrim(p->>'email'), ''), 'dry-run@zonicme.invalid'), 'email_verified', true),
    'payload', jsonb_strip_nulls(jsonb_build_object(
      'amount', case when coalesce(p->>'amount', '') ~ '^[0-9]{1,13}(\.[0-9]{1,6})?$' then (p->>'amount')::numeric end,
      'currency', nullif(p->>'currency', ''), 'sku', nullif(p->>'sku', ''), 'category', nullif(p->>'category', ''),
      'brand_id', nullif(p->>'brand_ref', ''),
      'metadata', case when jsonb_typeof(p->'metadata') = 'object' then p->'metadata' end)));
$$;

create or replace function rewards_core.api_brand_dry_run(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare c public.reward_campaigns%rowtype; r jsonb; v_own jsonb; v_points bigint; v_credit bigint;
begin
  select * into c from public.reward_campaigns where id = rewards_core.safe_uuid(p->>'campaign_id');
  if not found then raise exception 'Choose a campaign to test.'; end if;
  perform rewards_core.need_brand(c.brand_id);
  if coalesce(p->>'amount', '') <> '' and (p->>'amount') !~ '^[0-9]{1,13}(\.[0-9]{1,6})?$' then
    raise exception 'Enter the amount as a number, for example 15000.';
  end if;
  r := rewards_core.process_event(coalesce(p->>'app_id', ''), rewards_core.build_test_event(p),
    jsonb_build_object('dry_run', true, 'is_demo', c.is_demo, 'assume_campaign', c.id, 'at', p->>'at'));
  if r->>'status' = 'invalid' and r->>'reason' = 'unknown_app' then raise exception 'Choose the app the test event comes from.'; end if;
  if r->>'status' <> 'accepted' then raise exception 'That test event could not be evaluated. Check the details and try again.'; end if;
  -- a brand only ever sees what its own rules did
  select coalesce(jsonb_agg(t), '[]'::jsonb),
         coalesce(sum((t->>'points')::bigint) filter (where t->>'outcome' = 'awarded' and t->>'bucket' = 'points'), 0),
         coalesce(sum((t->>'points')::bigint) filter (where t->>'outcome' = 'awarded' and t->>'bucket' = 'gift_credit'), 0)
    into v_own, v_points, v_credit
    from jsonb_array_elements(r->'trace') t where t->>'brand_id' = c.brand_id::text;
  return jsonb_build_object('dry_run', true, 'points_awarded', v_points, 'gift_credit_awarded', v_credit, 'steps', v_own,
    'in_app_list', (p->>'app_id') = any(c.applications), 'budget_left', c.budget_points - c.spent_points);
end $$;

-- Brand -> user one-off gift, paid for out of an approved campaign budget.
create or replace function rewards_core.api_brand_gift(p jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, auth, pg_temp as $$
declare
  c public.reward_campaigns%rowtype;
  b public.reward_brands%rowtype;
  them public.reward_accounts%rowtype;
  v_from uuid;
  v_hash text := rewards_core.email_hash(p->>'email');
  v_points bigint := rewards_core.as_int(p->'points');
  v_msg text := nullif(btrim(coalesce(p->>'message', '')), '');
  v_gift uuid;
begin
  select * into c from public.reward_campaigns where id = rewards_core.safe_uuid(p->>'campaign_id');
  if not found then raise exception 'Choose the campaign that pays for this gift.'; end if;
  b := rewards_core.need_brand(c.brand_id);
  if v_hash is null then raise exception 'Enter the email address of the person you want to gift.'; end if;
  if v_points is null or v_points < 1 then raise exception 'Enter a whole number of points to send.'; end if;
  if char_length(coalesce(v_msg, '')) > 280 then raise exception 'Keep the message under 280 characters.'; end if;

  insert into public.reward_accounts (account_type, email_hash, is_demo) values ('user', v_hash, c.is_demo)
  on conflict (email_hash) do nothing;
  select * into them from public.reward_accounts where email_hash = v_hash for update;   -- account first, then campaign
  select * into c from public.reward_campaigns where id = c.id for update;
  if b.status <> 'active' or c.status <> 'active' or (c.starts_at is not null and c.starts_at > now())
     or (c.ends_at is not null and c.ends_at <= now()) then
    raise exception 'Gifts can only be sent from a campaign that is approved and running.';
  end if;
  if them.status <> 'active' or them.is_demo <> c.is_demo or them.account_type <> 'user' then
    raise exception 'That person cannot receive gifts right now.';
  end if;
  if c.budget_points - c.spent_points < v_points then
    raise exception 'This campaign has % points left in its budget, which is not enough for that.', c.budget_points - c.spent_points;
  end if;
  insert into public.reward_accounts (account_type, brand_id, is_demo) values ('brand', b.id, b.is_demo)
  on conflict (brand_id) do nothing;
  select id into v_from from public.reward_accounts where brand_id = b.id;

  insert into public.reward_gifts (gift_type, from_account_id, to_account_id, brand_id, campaign_id, points, message, sender_label,
    recipient_hint, created_by, is_demo)
  values ('brand_to_user', v_from, them.id, b.id, c.id, v_points, v_msg, b.name, rewards_core.mask_email(p->>'email'), auth.uid(), c.is_demo)
  returning id into v_gift;
  perform rewards_core.post_ledger(jsonb_build_object('account_id', them.id, 'bucket', 'gift_credit', 'tx_type', 'gift_received',
    'amount', v_points, 'gift_id', v_gift, 'campaign_id', c.id, 'counterparty_account_id', v_from, 'actor_user_id', auth.uid()));
  update public.reward_campaigns set spent_points = spent_points + v_points, updated_at = now() where id = c.id;
  perform rewards_core.audit('brand.gift', 'campaign', c.id::text,
    jsonb_build_object('brand', b.name, 'points', v_points, 'recipient', rewards_core.mask_email(p->>'email')));
  return jsonb_build_object('gift_id', v_gift, 'points', v_points, 'recipient', rewards_core.mask_email(p->>'email'),
    'budget_left', c.budget_points - c.spent_points - v_points);
end $$;
