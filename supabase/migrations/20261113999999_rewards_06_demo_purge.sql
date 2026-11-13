-- =====================================================================
-- ZonicMe Central Rewards - Phase 1 (6/6): clearing demo data
-- Kept on its own because it is the one routine in the rewards set that
-- takes rows out. It removes ONLY rows marked is_demo; real data is never
-- touched (the ledger and account guards allow removal of demo rows only,
-- and only while this routine is running).
-- =====================================================================
create or replace function rewards_core.purge_demo() returns jsonb
language plpgsql set search_path = pg_catalog, public, rewards_core, pg_temp as $$
declare n_ledger bigint; n_events bigint; n_accounts bigint; n_rules bigint; n_campaigns bigint; n_brands bigint; n_apps bigint;
begin
  perform set_config('rewards.demo_purge', 'on', true);
  delete from public.reward_ledger where is_demo; get diagnostics n_ledger = row_count;
  delete from public.reward_badges where is_demo;
  delete from public.reward_gifts where is_demo;
  delete from public.reward_redemptions where is_demo;
  delete from public.reward_events where is_demo; get diagnostics n_events = row_count;
  delete from public.reward_accounts where is_demo; get diagnostics n_accounts = row_count;
  delete from public.reward_rules where is_demo; get diagnostics n_rules = row_count;
  delete from public.reward_campaigns where is_demo; get diagnostics n_campaigns = row_count;
  delete from public.reward_brands where is_demo; get diagnostics n_brands = row_count;
  delete from rewards_core.app_keys where is_demo or app_id in (select app_id from public.reward_apps where is_demo);
  delete from public.reward_brand_app_links where app_id in (select app_id from public.reward_apps where is_demo);
  delete from public.reward_intake_stats where app_id in (select app_id from public.reward_apps where is_demo);
  delete from public.reward_apps where is_demo; get diagnostics n_apps = row_count;
  perform set_config('rewards.demo_purge', 'off', true);
  return jsonb_build_object('ledger', n_ledger, 'events', n_events, 'accounts', n_accounts, 'rules', n_rules,
    'campaigns', n_campaigns, 'brands', n_brands, 'apps', n_apps);
end $$;
