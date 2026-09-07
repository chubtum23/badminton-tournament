-- Scheduling moves from the meeting down to the individual game: each game goes to its own
-- court and runs its own clock. A game row now exists from the moment its match is created,
-- so it can be scheduled before anyone has played it, which is why the scores are nullable.
alter table public.games
  alter column score_a drop not null,
  alter column score_b drop not null,
  add column court int,
  add column started_at timestamptz,
  add column paused_at timestamptz,
  add column paused_ms bigint not null default 0 check (paused_ms >= 0);

alter table public.matches
  drop column court,
  drop column started_at,
  drop column paused_at,
  drop column paused_ms;

alter table public.tournaments
  add column play_all_games boolean not null default true,
  add column game_labels text[] not null default array['Mixed doubles #1', 'Mixed doubles #2', 'Men''s doubles'],
  alter column games_per_match set default 3;

-- Give every match that already exists its full set of game slots.
insert into public.games (match_id, game_no)
select m.id, s.n
from public.matches m
join public.tournaments t on t.id = m.tournament_id
cross join lateral generate_series(1, t.games_per_match) as s(n)
on conflict (match_id, game_no) do nothing;
