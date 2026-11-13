-- =====================================================================
-- ZonicMe Rewards: this app reports trusted events to the ZonicMe hub,
-- server to server. Additive. Nothing here can fail or slow the app:
-- sending is asynchronous (pg_net) and every step swallows its own errors.
-- The signing secret lives in a private schema that the API roles cannot
-- reach; it is agreed with the hub by key exchange and is never displayed.
-- =====================================================================
create schema if not exists zonic_rewards;
comment on schema zonic_rewards is 'ZonicMe Rewards event reporting. Private: not exposed through the API, no access for anon/authenticated.';

create table if not exists zonic_rewards.link (
  id boolean primary key default true check (id),
  app_id text not null,
  intake_url text not null,
  enabled boolean not null default false,
  secret text,
  dh_private text,
  fingerprint text,
  updated_at timestamptz not null default now()
);
alter table zonic_rewards.link enable row level security;
insert into zonic_rewards.link (app_id, intake_url)
values ('myyanga', 'https://qdhlbplzdblcvvaaluwu.supabase.co/functions/v1/rewards-ingest')
on conflict (id) do nothing;

-- ---- key exchange helpers (same arithmetic as the hub: RFC 3526 group 14, generator 2) ----
create or replace function zonic_rewards.hex2num(p text) returns numeric
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare n numeric := 0; i integer; h text := lower(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
begin
  if h !~ '^[0-9a-f]+$' or length(h) > 1024 then raise exception 'Not a hexadecimal number.'; end if;
  for i in 1..length(h) loop
    n := n * 16 + (position(substr(h, i, 1) in '0123456789abcdef') - 1);
  end loop;
  return n;
end $$;

create or replace function zonic_rewards.num2hex(n numeric, p_len integer default 0) returns text
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

create or replace function zonic_rewards.modpow(b numeric, e numeric, m numeric) returns numeric
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

create or replace function zonic_rewards.dh_prime() returns numeric
language sql immutable set search_path = pg_catalog, zonic_rewards, pg_temp as $$
  select zonic_rewards.hex2num(
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' ||
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' ||
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' ||
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' ||
    '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' ||
    '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' ||
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' ||
    '3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF');
$$;

-- step 1 (database administrators only): returns this side's PUBLIC value; the private half stays in the link table
create or replace function zonic_rewards.dh_begin() returns text
language plpgsql set search_path = pg_catalog, zonic_rewards, extensions, pg_temp as $$
declare v_priv text := encode(gen_random_bytes(32), 'hex');
begin
  update zonic_rewards.link set dh_private = v_priv, updated_at = now() where id;
  return zonic_rewards.num2hex(zonic_rewards.modpow(2, zonic_rewards.hex2num(v_priv), zonic_rewards.dh_prime()), 512);
end $$;

-- step 2: give it the hub's public value; stores the derived secret, switches reporting on, returns only a fingerprint
create or replace function zonic_rewards.dh_finish(p_peer_public text) returns text
language plpgsql set search_path = pg_catalog, zonic_rewards, extensions, pg_temp as $$
declare l zonic_rewards.link%rowtype; v_peer numeric; v_p numeric := zonic_rewards.dh_prime(); v_secret text; v_fp text;
begin
  select * into l from zonic_rewards.link where id for update;
  if l.dh_private is null then raise exception 'No key exchange is waiting.'; end if;
  v_peer := zonic_rewards.hex2num(p_peer_public);
  if v_peer < 2 or v_peer > v_p - 2 then raise exception 'That public value is not valid.'; end if;
  v_secret := encode(sha256(decode(zonic_rewards.num2hex(zonic_rewards.modpow(v_peer, zonic_rewards.hex2num(l.dh_private), v_p), 512), 'hex')), 'hex');
  v_fp := left(encode(sha256(convert_to('zonic-rewards-fingerprint:' || v_secret, 'UTF8')), 'hex'), 16);
  update zonic_rewards.link set secret = v_secret, dh_private = null, fingerprint = v_fp, enabled = true, updated_at = now() where id;
  return v_fp;
end $$;

-- Queues one signed event for the hub. Never raises: a problem here must not touch the app's own work.
-- Only the person's email HASH leaves this database (same convention as the hub: sha256 of the trimmed, lower-cased email).
create or replace function zonic_rewards.emit(p_event_id text, p_event_type text, p_email text, p_verified boolean,
  p_amount numeric, p_payload jsonb, p_occurred_at timestamptz) returns void
language plpgsql security definer set search_path = pg_catalog, zonic_rewards, extensions, pg_temp as $$
declare l zonic_rewards.link%rowtype; v_body jsonb; v_ts text; v_sig text;
begin
  select * into l from zonic_rewards.link where id;
  if not found or not l.enabled or l.secret is null or p_email is null or position('@' in p_email) < 2 then return; end if;
  v_body := jsonb_build_object(
    'event_id', p_event_id, 'event_type', p_event_type, 'source_app', l.app_id,
    'occurred_at', coalesce(p_occurred_at, now()),
    'identity', jsonb_build_object(
      'email_hash', encode(sha256(convert_to(lower(btrim(p_email, E' \t\n\r')), 'UTF8')), 'hex'),
      'email_verified', coalesce(p_verified, false)),
    'payload', coalesce(p_payload, '{}'::jsonb)
               || case when p_amount is not null and p_amount >= 0 then jsonb_build_object('amount', p_amount) else '{}'::jsonb end);
  v_ts := floor(extract(epoch from clock_timestamp()))::bigint::text;
  -- signature = hex( HMAC-SHA256( secret, app + "." + unix time + "." + exact body text ) ); pg_net sends body::text unchanged
  v_sig := encode(hmac(convert_to(l.app_id || '.' || v_ts || '.' || v_body::text, 'UTF8'), convert_to(l.secret, 'UTF8'), 'sha256'), 'hex');
  perform net.http_post(
    url := l.intake_url, body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-zonic-app', l.app_id,
                                  'x-zonic-timestamp', v_ts, 'x-zonic-signature', v_sig),
    timeout_milliseconds := 8000);
exception when others then
  raise log 'zonic_rewards: an event was not sent (%).', sqlstate;
end $$;

-- MyYangaX: a retail order becomes paid. Sent once per order; only for signed-in buyers whose email is confirmed.
create or replace function zonic_rewards.tg_retail_order_paid() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, zonic_rewards, pg_temp as $$
declare v_email text; v_ok boolean;
begin
  begin
    if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') and new.user_id is not null then
      select u.email, u.email_confirmed_at is not null into v_email, v_ok from auth.users u where u.id = new.user_id;
      if coalesce(v_ok, false) then
        perform zonic_rewards.emit('retail_order:' || new.id, 'order_paid', v_email, true, new.subtotal_ngn::numeric,
          jsonb_build_object('currency', coalesce(new.currency, 'NGN'), 'category', 'retail_order',
                             'metadata', jsonb_build_object('reference', new.reference)), now());
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace trigger zonic_rewards_order_paid
  after insert or update of status on public.retail_orders
  for each row execute function zonic_rewards.tg_retail_order_paid();
