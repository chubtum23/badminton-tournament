-- Undoes 20260910140000. That migration added player_ratings.match_id -> matches(id) so PostgREST
-- could embed `matches` directly, but it also gave player_ratings a foreign key into `games` AND one
-- into `matches`, which is precisely the shape of a junction table. PostgREST then saw two ways to
-- embed `matches` from `games` -- the direct games_match_id_fkey and a many-to-many through
-- player_ratings -- and refused with PGRST201, breaking listGames and every page that calls it.
--
-- The composite key into `games` is the honest relationship: a rating belongs to a game slot, and a
-- game slot belongs to a match. listPlayerRatings now embeds through games to reach the tournament.
alter table public.player_ratings drop constraint player_ratings_match_id_fkey;
