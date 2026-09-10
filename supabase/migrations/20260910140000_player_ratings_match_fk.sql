-- player_ratings reached `matches` only through its composite key into `games`, which is a real
-- relationship to Postgres but not one PostgREST can embed: `matches!inner(tournament_id)` needs a
-- foreign key that names `matches` directly, and without one every query using it fails with
-- PGRST200 — which took the whole public tournament bundle down, not just the Players page.
--
-- `games` and `score_submissions` both carry exactly this constraint for exactly this reason.
-- The composite key into `games` stays: it is what ties a rating to the game slot it was given for.
alter table public.player_ratings
  add constraint player_ratings_match_id_fkey
  foreign key (match_id) references public.matches(id) on delete cascade;
