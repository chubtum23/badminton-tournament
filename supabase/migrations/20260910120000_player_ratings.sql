-- v1.4: the organiser rates every player out of 10 for each game they play.
--
-- Who played a game is not recorded here, because it is already known: a team is two men and one
-- woman with fixed roles, so the pair on court follows from the game number. This table only
-- carries the judgement.

create table public.player_ratings (
  match_id  uuid not null,
  game_no   int  not null,
  player_id uuid not null references public.players(id) on delete cascade,
  rating    numeric(3,1) not null check (rating >= 1 and rating <= 10),
  primary key (match_id, game_no, player_id),
  foreign key (match_id, game_no) references public.games(match_id, game_no) on delete cascade
);

-- The leaderboard groups by player; the primary key already covers reads by game.
create index player_ratings_player_idx on public.player_ratings (player_id);

alter table public.player_ratings enable row level security;

-- Same shape as games: no tournament_id of its own, so the admin check resolves through the match.
create policy player_ratings_read on public.player_ratings for select using (true);
create policy player_ratings_write on public.player_ratings for all to authenticated
  using (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)))
  with check (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)));
