-- =====================================================================
-- ZonicMe Central Rewards - Phase 1 (5/6): starter platform rules.
-- Every rule below is saved SWITCHED OFF. Nothing is awarded until the
-- owner switches a rule on in the Rewards admin console (Rules tab).
-- Safe to run again: a rule is only added if one with its name is not there.
-- =====================================================================
do $$
declare r jsonb;
begin
  for r in select value from jsonb_array_elements($rules$[
    {"name": "Starter rule: MyYangaX - 1 point for every 100 naira spent",
     "description": "Earn points on every paid MyYangaX order. Up to 5,000 points per order.",
     "scope": "application", "app_id": "myyanga", "event_type": "order_paid", "action": "award_points",
     "config": {"bps": 100, "max_points": 5000}, "conditions": {},
     "caps": [{"per": "user", "period": "day", "points": 20000}], "priority": 100},
    {"name": "Starter rule: MyAfriArt - 1 point for every 200 naira spent",
     "description": "Earn points when you pay for an artwork or an auction win on MyAfriArt. Up to 20,000 points per purchase.",
     "scope": "application", "app_id": "myafriart", "event_type": null, "action": "award_points",
     "config": {"bps": 50, "max_points": 20000},
     "conditions": {"all": [{"field": "event_type", "op": "in", "value": ["artwork_purchase_paid", "auction_settlement_paid"]}]},
     "caps": [{"per": "user", "period": "day", "points": 50000}], "priority": 100},
    {"name": "Starter rule: AdSpot - 10 points for each completed review",
     "description": "Earn points each time you complete an ad review on AdSpot. Up to 20 reviews a day count.",
     "scope": "application", "app_id": "adspot", "event_type": "review_completed", "action": "award_points",
     "config": {"points": 10}, "conditions": {},
     "caps": [{"per": "user", "period": "day", "count": 20}], "priority": 100},
    {"name": "Starter rule: Welcome bonus - 100 points on your first purchase",
     "description": "A one-time thank you the first time you pay for something in a ZonicMe app.",
     "scope": "global", "app_id": null, "event_type": null, "action": "award_points",
     "config": {"points": 100},
     "conditions": {"all": [{"field": "event_type", "op": "in", "value": ["order_paid", "artwork_purchase_paid", "auction_settlement_paid"]}]},
     "caps": [{"per": "user", "period": "total", "count": 1}], "priority": 200}
  ]$rules$::jsonb) loop
    perform rewards_core.validate_rule(r);
    if not exists (select 1 from public.reward_rules x where x.name = r->>'name') then
      insert into public.reward_rules (name, description, scope, owner_type, app_id, event_type, conditions, action, config, caps, priority, active, is_demo)
      values (r->>'name', r->>'description', r->>'scope',
              case when r->>'scope' = 'application' then 'application' else 'platform' end,
              r->>'app_id', r->>'event_type', r->'conditions', r->>'action', r->'config', r->'caps', (r->>'priority')::integer, false, false);
    end if;
  end loop;
end $$;
