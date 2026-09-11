-- Pre-launch hardening: nothing an organiser does in their own tournament may reach into another.
--
-- Policies check the tournament of the row being written, but three links between rows were never
-- checked against each other, so an organiser of tournament A could point one of A's rows at B's
-- data and then have a security-definer function or the service role delete it:
--   * team_players could link A's team to B's player (write_roster/delete_team then deleted it),
--   * teams.pool_id could name B's pool (breaking B's set_pool_order count),
--   * teams.photo_path could name a file in B's folder (a photo replace then deleted B's file).

-- ---------- team_players: the player and the team must share a tournament ----------
create or replace function public.check_team_player_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select tournament_id from public.players where id = new.player_id)
     is distinct from (select tournament_id from public.teams where id = new.team_id) then
    raise exception using errcode = '23514', message = 'player and team belong to different tournaments';
  end if;
  return new;
end; $$;

create trigger team_players_same_tournament
  before insert or update on public.team_players
  for each row execute function public.check_team_player_tournament();

-- ---------- teams.pool_id: the pool must be in the team's tournament ----------
create or replace function public.check_team_pool_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pool_id is not null and
     (select tournament_id from public.pools where id = new.pool_id) is distinct from new.tournament_id then
    raise exception using errcode = '23514', message = 'pool belongs to a different tournament';
  end if;
  return new;
end; $$;

create trigger teams_pool_same_tournament
  before insert or update of pool_id, tournament_id on public.teams
  for each row execute function public.check_team_pool_tournament();

-- ---------- teams.photo_path: only files in the tournament's own folder ----------
-- NOT VALID so the push cannot fail on existing rows; every new write is still checked.
alter table public.teams add constraint teams_photo_path_own_folder
  check (photo_path is null or split_part(photo_path, '/', 1) = tournament_id::text) not valid;

-- ---------- player deletes stay inside the team's tournament ----------
create or replace function public.write_roster(p_team uuid, p_mixed1 text, p_mixed2 text, p_woman text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare t uuid; m1 text := btrim(coalesce(p_mixed1, '')); m2 text := btrim(coalesce(p_mixed2, '')); w text := btrim(coalesce(p_woman, '')); pid uuid;
begin
  select tournament_id into t from public.teams where id = p_team;
  if t is null then raise exception using errcode = 'P0001', message = 'invalid_input'; end if;
  if length(m1) not between 1 and 60 or length(m2) not between 1 and 60 or length(w) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  delete from public.players where tournament_id = t and id in (select player_id from public.team_players where team_id = p_team);
  insert into public.players (tournament_id, name, gender) values (t, m1, 'male') returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'mixed1');
  insert into public.players (tournament_id, name, gender) values (t, m2, 'male') returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'mixed2');
  insert into public.players (tournament_id, name, gender) values (t, w, 'female') returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'woman');
end; $$;

revoke execute on function public.write_roster(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.write_roster(uuid, text, text, text) to service_role;

create or replace function public.delete_team(p_team uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare t uuid;
begin
  select tournament_id into t from public.teams where id = p_team;
  if t is null or not public.is_tournament_admin(t) then raise exception 'not_admin' using errcode = '42501'; end if;
  if (select status from public.tournaments where id = t) <> 'setup' then raise exception 'stale_state'; end if;
  delete from public.players where tournament_id = t and id in (select player_id from public.team_players where team_id = p_team);
  delete from public.teams where id = p_team;
end; $$;

revoke execute on function public.delete_team(uuid) from public, anon;
grant execute on function public.delete_team(uuid) to authenticated, service_role;

-- ---------- no deleting a whole tournament through the API ----------
-- The app has no button for it and the delete cascades through every result; a stolen or
-- mistyped organiser session should not be able to do it. The dashboard can still delete one.
drop policy if exists tournaments_delete on public.tournaments;
