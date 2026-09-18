-- Point-by-point scores, shared live.
--
-- The score sheet used to live only on the scorer's phone until Save. This table holds the sheet of
-- every game being scored right now, one row per game, so every other screen (organisers, teams,
-- spectators) can follow it rally by rally over realtime.
--
-- Any organiser can score a game, and any other organiser can pick up the same sheet and carry on.
-- Two devices tapping at once are kept honest by `rev`: a write names the revision it was based on,
-- and a write based on a stale revision is refused and handed the current sheet to adopt instead.

create table public.live_games (
  match_id uuid not null,
  game_no int not null,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- Players 0-1 are side A, 2-3 side B, as in lib/results/scoresheet.ts.
  server smallint not null check (server between 0 and 3),
  receiver smallint not null check (receiver between 0 and 3),
  -- One character per rally, the side that won it. A game is at most ~60 rallies.
  rallies text not null default '' check (rallies ~ '^[ab]{0,200}$'),
  rev int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (match_id, game_no),
  foreign key (match_id, game_no) references public.games(match_id, game_no) on delete cascade,
  check ((server < 2) <> (receiver < 2))
);
create index live_games_tournament_idx on public.live_games (tournament_id);

-- Anyone can watch. Nobody writes directly: every write goes through push_live_game() below.
alter table public.live_games enable row level security;
create policy live_games_read on public.live_games for select using (true);

alter publication supabase_realtime add table public.live_games;

-- ---------- the one way in ----------
-- Returns the sheet as it now stands: {applied, server, receiver, rallies, rev}, with applied false
-- when p_rev was stale (the caller adopts what came back), rev 0 when no sheet exists, and
-- {scored: true} once the game has a final score and the sheet is closed.
create or replace function public.push_live_game(p_match uuid, p_game int, p_server int, p_receiver int, p_rallies text, p_rev int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t uuid; scored boolean; cur public.live_games;
begin
  select m.tournament_id, g.score_a is not null into t, scored
    from public.games g join public.matches m on m.id = g.match_id
    where g.match_id = p_match and g.game_no = p_game;
  if t is null then raise exception using errcode = 'P0001', message = 'invalid_input'; end if;
  if not public.is_tournament_admin(t) then raise exception using errcode = '42501', message = 'not_admin'; end if;
  if scored then return jsonb_build_object('applied', false, 'scored', true); end if;

  if p_rev = 0 then
    insert into public.live_games (match_id, game_no, tournament_id, server, receiver, rallies, rev)
      values (p_match, p_game, t, p_server, p_receiver, p_rallies, 1)
      on conflict (match_id, game_no) do nothing
      returning * into cur;
  else
    update public.live_games
      set server = p_server, receiver = p_receiver, rallies = p_rallies, rev = rev + 1, updated_at = now()
      where match_id = p_match and game_no = p_game and rev = p_rev
      returning * into cur;
  end if;
  if cur.match_id is not null then
    return jsonb_build_object('applied', true, 'server', cur.server, 'receiver', cur.receiver, 'rallies', cur.rallies, 'rev', cur.rev);
  end if;

  select * into cur from public.live_games where match_id = p_match and game_no = p_game;
  if cur.match_id is null then return jsonb_build_object('applied', false, 'rev', 0); end if;
  return jsonb_build_object('applied', false, 'server', cur.server, 'receiver', cur.receiver, 'rallies', cur.rallies, 'rev', cur.rev);
end; $$;

revoke execute on function public.push_live_game(uuid, int, int, int, text, int) from public, anon;
grant execute on function public.push_live_game(uuid, int, int, int, text, int) to authenticated, service_role;

-- ---------- a sheet closes when its game gets (or loses) a final score ----------
-- Done here rather than in each action, because a score reaches games by several routes: the
-- organiser's Save, a confirmed team submission, a clear, a bracket rollback.
create or replace function public.drop_live_game() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.score_a is distinct from old.score_a or new.score_b is distinct from old.score_b then
    delete from public.live_games where match_id = new.match_id and game_no = new.game_no;
  end if;
  return new;
end; $$;

create trigger games_drop_live_game
  after update of score_a, score_b on public.games
  for each row execute function public.drop_live_game();
