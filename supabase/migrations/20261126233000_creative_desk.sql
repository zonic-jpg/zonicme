-- Creative Desk (applied live 2026-11-26 through the Supabase migration "creative_desk"). Additive only.
-- Tables: desk_runs (one row per assistant run), desk_items (drafts: story, creative, opportunity, improvement;
-- always born "pending_review"), desk_notebook (one row: focus, watchlist, lessons).
-- Guard trigger desk_items_guard: only a signed-in administrator can change a draft's status or note;
-- the reviewer stamp cannot be written directly. Row-level security: administrators only.
-- Function desk_scorecard(): approval counts and average confidence by kind, for auditing the assistant.
-- The full statement text is held in the project's migration history under that name.
select 1;
