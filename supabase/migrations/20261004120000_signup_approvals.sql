-- ZonicMe sign-up rules (applied to production 2026-10-08).
-- Owner = VERIFIED email oadeagbo@gmail.com. No shared password anywhere. profiles.roles can only be
-- changed by the verified owner. Approvals toggle (default OFF) holds ONLY admin/tester sign-ups.

create or replace function public.founding_owner_email() returns text language sql immutable as $$ select 'oadeagbo@gmail.com'::text $$;
create or replace function public.is_founding_owner(_uid uuid) returns boolean language sql stable security definer set search_path to 'public','auth' as $$
  select exists (select 1 from auth.users u where u.id = _uid and lower(u.email) = public.founding_owner_email() and u.email_confirmed_at is not null);
$$;
create or replace function public.is_owner_or_super() returns boolean language sql stable security definer set search_path to 'public','auth' as $$
  select auth.uid() is not null and public.is_founding_owner(auth.uid());
$$;
revoke all on function public.is_founding_owner(uuid), public.is_owner_or_super() from public, anon;
grant execute on function public.is_founding_owner(uuid), public.is_owner_or_super() to authenticated;

create or replace function public.grant_owner_roles(_uid uuid) returns void language plpgsql security definer set search_path to 'public','auth' as $$
begin
  if not public.is_founding_owner(_uid) then return; end if;
  insert into public.profiles (id, email, name, roles)
    select u.id, lower(u.email), coalesce(u.raw_user_meta_data->>'name', u.email), array['owner','super_admin'] from auth.users u where u.id = _uid
  on conflict (id) do update set roles = (select array(select distinct unnest(coalesce(public.profiles.roles,'{}'::text[]) || array['owner','super_admin'])));
end; $$;
revoke all on function public.grant_owner_roles(uuid) from public, anon, authenticated;

create or replace function public.handle_new_zonicme_user() returns trigger language plpgsql security definer set search_path to 'public','auth' as $$
begin
  insert into public.profiles (id, email, name, roles)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', new.email), array[]::text[])
  on conflict (id) do nothing;
  if lower(new.email) = public.founding_owner_email() and new.email_confirmed_at is not null then
    perform public.grant_owner_roles(new.id);
  end if;
  return new;
end; $$;

create or replace function public.on_auth_user_owner_roles() returns trigger language plpgsql security definer set search_path to 'public','auth' as $$
begin
  if lower(new.email) = public.founding_owner_email() and new.email_confirmed_at is not null then
    perform public.grant_owner_roles(new.id);
  end if;
  return new;
end; $$;
revoke all on function public.on_auth_user_owner_roles() from public, anon, authenticated;
create or replace trigger on_auth_user_owner_roles after update of email_confirmed_at, email on auth.users for each row execute function public.on_auth_user_owner_roles();

create or replace function public.profiles_guard_roles() returns trigger language plpgsql security definer set search_path to 'public','auth' as $$
begin
  if tg_op = 'UPDATE' then
    if new.roles is distinct from old.roles and auth.uid() is not null and not public.is_founding_owner(auth.uid()) then
      raise exception 'Only the owner can change roles';
    end if;
    if new.email is distinct from old.email and auth.uid() is not null then
      new.email := old.email;
    end if;
  end if;
  return new;
end; $$;
create or replace trigger profiles_guard_roles before update on public.profiles for each row execute function public.profiles_guard_roles();
alter policy profiles_self_insert on public.profiles with check (auth.uid() = id and coalesce(cardinality(roles),0) = 0);

create table if not exists public.signup_policy (
  id boolean primary key default true check (id),
  require_approvals boolean not null default false,
  require_approvals_since timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.signup_policy (id) values (true) on conflict do nothing;
alter table public.signup_policy enable row level security;

create table if not exists public.signup_approvals (
  user_id uuid primary key,
  email text not null,
  requested_role text not null default 'member' check (requested_role in ('member','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  granted_role text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  notified_at timestamptz,
  admin_requested_at timestamptz,
  admin_notified_at timestamptz
);
alter table public.signup_approvals enable row level security;
create policy signup_approvals_read on public.signup_approvals for select using (user_id = auth.uid() or public.is_owner_or_super());

create or replace function public._apply_member_role(_user_id uuid, _role text) returns void language plpgsql security definer set search_path to 'public','auth' as $f$
begin
  if _role = 'admin' then
    update public.profiles set roles = (select array(select distinct unnest(coalesce(roles,'{}'::text[]) || array['admin']))) where id = _user_id;
  else
    update public.profiles set roles = array_remove(coalesce(roles,'{}'::text[]), 'admin') where id = _user_id;
  end if;
end $f$;
revoke all on function public._apply_member_role(uuid,text) from public, anon, authenticated;

create or replace function public.register_signup(_requested_role text default 'member') returns jsonb language plpgsql security definer set search_path to 'public','auth' as $f$
declare
  v_uid uuid := auth.uid(); v_email text;
  v_role text := lower(trim(coalesce(nullif(_requested_role, ''), 'member')));
  v_req boolean; v_since timestamptz; v_created timestamptz;
  v_row public.signup_approvals%rowtype;
begin
  if v_uid is null then raise exception 'Sign-in required'; end if;
  if v_role not in ('member','admin') then v_role := 'member'; end if;
  select lower(coalesce(email, '')), created_at into v_email, v_created from auth.users where id = v_uid;
  if public.is_founding_owner(v_uid) then
    perform public.grant_owner_roles(v_uid);
    insert into public.signup_approvals (user_id, email, requested_role, status, granted_role, decided_at)
    values (v_uid, v_email, 'member', 'approved', 'admin', now())
    on conflict (user_id) do update set status = 'approved', granted_role = 'admin';
    return jsonb_build_object('status', 'approved', 'role', 'admin', 'owner', true);
  end if;
  select * into v_row from public.signup_approvals where user_id = v_uid;
  if found then
    return jsonb_build_object('status', v_row.status, 'role', coalesce(v_row.granted_role, v_row.requested_role));
  end if;
  select require_approvals, require_approvals_since into v_req, v_since from public.signup_policy where id;
  if v_role <> 'admin' or coalesce(v_req, false) = false or (v_since is not null and v_created < v_since) then
    insert into public.signup_approvals (user_id, email, requested_role, status, granted_role, decided_at)
    values (v_uid, v_email, v_role, 'approved', 'member', now()) on conflict (user_id) do nothing;
    return jsonb_build_object('status', 'approved', 'role', 'member');
  end if;
  insert into public.signup_approvals (user_id, email, requested_role, status)
  values (v_uid, v_email, v_role, 'pending') on conflict (user_id) do nothing;
  return jsonb_build_object('status', 'pending', 'role', v_role);
end $f$;

create or replace function public.request_admin_access() returns jsonb language plpgsql security definer set search_path to 'public','auth' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign-in required'; end if;
  if exists (select 1 from public.profiles where id = v_uid and roles && array['admin','super_admin','owner']) then return jsonb_build_object('status', 'already_admin'); end if;
  perform public.register_signup('admin');
  update public.signup_approvals
     set admin_requested_at = coalesce(admin_requested_at, now()),
         requested_role = case when status = 'pending' then 'admin' else requested_role end
   where user_id = v_uid;
  return jsonb_build_object('status', 'requested');
end $f$;

create or replace function public.set_require_approvals(_on boolean) returns jsonb language plpgsql security definer set search_path to 'public','auth' as $f$
begin
  if not public.is_owner_or_super() then raise exception 'Only the owner can change approval settings'; end if;
  update public.signup_policy
     set require_approvals = coalesce(_on, false),
         require_approvals_since = case when coalesce(_on, false) then now() else null end,
         updated_at = now(), updated_by = auth.uid()
   where id;
  if not coalesce(_on, false) then
    update public.signup_approvals set status = 'approved', granted_role = coalesce(granted_role, 'member'),
           decided_at = now(), decided_by = auth.uid() where status = 'pending';
  end if;
  return jsonb_build_object('ok', true, 'require_approvals', coalesce(_on, false));
end $f$;

create or replace function public.decide_signup(_user_id uuid, _decision text, _role text default 'member') returns jsonb language plpgsql security definer set search_path to 'public','auth' as $f$
declare
  v_role text := lower(trim(coalesce(nullif(_role, ''), 'member')));
  v_decision text := lower(trim(coalesce(_decision, '')));
begin
  if not public.is_owner_or_super() then raise exception 'Only the owner can approve or reject accounts'; end if;
  if v_decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  if v_role not in ('member','admin') then raise exception 'Role must be member or admin'; end if;
  if public.is_founding_owner(_user_id) then raise exception 'The owner account cannot be changed'; end if;
  if v_decision = 'reject' then
    update public.signup_approvals set status = 'rejected', decided_at = now(), decided_by = auth.uid() where user_id = _user_id;
    if not found then raise exception 'No signup found for that account'; end if;
    perform public._apply_member_role(_user_id, 'member');
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  update public.signup_approvals set status = 'approved', granted_role = v_role, decided_at = now(), decided_by = auth.uid() where user_id = _user_id;
  if not found then raise exception 'No signup found for that account'; end if;
  perform public._apply_member_role(_user_id, v_role);
  return jsonb_build_object('ok', true, 'status', 'approved', 'role', v_role);
end $f$;

create or replace function public.set_member_role(_user_id uuid, _role text) returns jsonb language plpgsql security definer set search_path to 'public','auth' as $f$
declare v_role text := lower(trim(coalesce(nullif(_role, ''), 'member')));
begin
  if not public.is_owner_or_super() then raise exception 'Only the owner can change roles'; end if;
  if v_role not in ('member','admin') then raise exception 'Role must be member or admin'; end if;
  if public.is_founding_owner(_user_id) then raise exception 'The owner account cannot be changed'; end if;
  insert into public.signup_approvals (user_id, email, requested_role, status, granted_role, decided_at, decided_by)
  select u.id, lower(coalesce(u.email, '')), 'member', 'approved', v_role, now(), auth.uid() from auth.users u where u.id = _user_id
  on conflict (user_id) do update set status = 'approved', granted_role = v_role, decided_at = now(), decided_by = auth.uid();
  if not found then raise exception 'No such account'; end if;
  perform public._apply_member_role(_user_id, v_role);
  return jsonb_build_object('ok', true, 'role', v_role);
end $f$;

create or replace function public.list_signup_approvals() returns jsonb language plpgsql stable security definer set search_path to 'public','auth' as $f$
begin
  if not public.is_owner_or_super() then raise exception 'Only the owner can view signup approvals'; end if;
  return jsonb_build_object(
    'require_approvals', coalesce((select require_approvals from public.signup_policy where id), false),
    'pending', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('is_admin', false) order by s.requested_at desc)
        from public.signup_approvals s where s.status = 'pending'), '[]'::jsonb),
    'admin_requests', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('is_admin', false) order by s.admin_requested_at desc)
        from public.signup_approvals s
       where s.status = 'approved' and s.admin_requested_at is not null
         and not exists (select 1 from public.profiles p where p.id = s.user_id and p.roles && array['admin','super_admin','owner'])), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(x.m order by x.requested_at desc) from (
        select to_jsonb(s) || jsonb_build_object(
                 'is_admin', exists (select 1 from public.profiles p where p.id = s.user_id and p.roles && array['admin','super_admin','owner']),
                 'is_owner', lower(s.email) = public.founding_owner_email()) as m, s.requested_at
          from public.signup_approvals s where s.status = 'approved' order by s.requested_at desc limit 200) x), '[]'::jsonb),
    'rejected', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('is_admin', false) order by s.decided_at desc)
        from (select * from public.signup_approvals where status = 'rejected' order by decided_at desc nulls last limit 50) s), '[]'::jsonb)
  );
end $f$;

revoke all on function public.register_signup(text), public.request_admin_access(), public.list_signup_approvals(), public.decide_signup(uuid,text,text), public.set_member_role(uuid,text), public.set_require_approvals(boolean) from public, anon;
grant execute on function public.register_signup(text), public.request_admin_access(), public.list_signup_approvals(), public.decide_signup(uuid,text,text), public.set_member_role(uuid,text), public.set_require_approvals(boolean) to authenticated;

