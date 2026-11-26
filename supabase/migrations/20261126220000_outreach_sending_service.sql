-- Outreach sending service (applied live 2026-11-26). Additive only.
-- delivery follow-up columns; pg_cron + pg_net; a private scheduler secret (generated in the
-- database, never shown); a default sender on the verified sending domain; a job every 10 minutes
-- that calls the outreach-send function. Sending stays switched off until an administrator turns it on.
alter table public.outreach_leads
  add column if not exists delivery_state text,
  add column if not exists delivery_checked_at timestamptz;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists outreach_private;
create table if not exists outreach_private.config (key text primary key, value text not null);
insert into outreach_private.config (key, value)
  values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
create or replace function public.outreach_cron_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.role() = 'service_role'
     and exists (select 1 from outreach_private.config c where c.key = 'cron_secret' and c.value = p_secret);
$$;
update public.outreach_settings
   set from_name = coalesce(from_name, 'ZonicMe Partnerships'),
       from_email = coalesce(from_email, 'partnerships@zonicme.com.ng'),
       reply_to = coalesce(reply_to, 'info@zonicme.com.ng'),
       updated_at = now()
 where id = 1;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'outreach-send') then
    perform cron.schedule('outreach-send', '*/10 * * * *', $job$
      select net.http_post(
        url := 'https://qdhlbplzdblcvvaaluwu.supabase.co/functions/v1/outreach-send',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from outreach_private.config where key = 'cron_secret')),
        body := '{"op":"run"}'::jsonb,
        timeout_milliseconds := 55000);
    $job$);
  end if;
end $$;
