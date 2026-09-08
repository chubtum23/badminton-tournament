-- v1.3: teams of two men and one woman with roles, public self sign-up, team descriptions.

-- ---------- columns ----------
alter table public.players add column gender text not null default 'male'
  check (gender in ('male','female'));

alter table public.team_players add column role text
  check (role in ('mixed1','mixed2','woman'));
create unique index team_players_role_unique on public.team_players (team_id, role)
  where role is not null;

alter table public.teams add column description text not null default ''
  check (length(description) <= 400);

-- Team names are compared case-insensitively everywhere, so the database enforces that too. The
-- `exists` checks in the sign-up functions stay for the friendly error; this closes the race.
create unique index teams_name_ci_unique on public.teams (tournament_id, lower(name));

alter table public.tournaments
  add column signup_open boolean not null default true,
  add column join_code text check (join_code is null or length(btrim(join_code)) between 3 and 30);

-- The public column grant is an explicit list, so the new column has to be added to it.
grant select (description) on public.teams to anon, authenticated;

-- ---------- hide join_code from anon and authenticated ----------
-- Same treatment as teams.edit_token: the code is a secret the sign-up form presents but never sees,
-- so the table-level select grant is replaced by an explicit column list that omits it. The
-- tournaments_read RLS policy is unchanged; this is a column privilege, not a row one.
revoke select on public.tournaments from anon, authenticated;
grant select (
  id, slug, name, sport, status, starts_at, venue, games_per_match, points_per_game, win_by_two,
  max_points, time_cap_minutes, play_all_games, game_labels, ko_games_per_match, ko_points_per_game,
  ko_win_by_two, ko_max_points, ko_time_cap_minutes, court_count, advance_per_pool, signup_open,
  created_at
) on public.tournaments to anon, authenticated;

-- ---------- backfill (local/test data only; hosted has no real teams yet) ----------
-- Teams that already have exactly three unrolled players get mixed1, mixed2, woman in name order,
-- and the third player becomes female so the roster validates.
do $$
declare t record; ids uuid[];
begin
  for t in
    select tp.team_id from public.team_players tp
    group by tp.team_id having count(*) = 3 and count(tp.role) = 0
  loop
    select array_agg(p.id order by p.name) into ids
      from public.team_players tp join public.players p on p.id = tp.player_id where tp.team_id = t.team_id;
    update public.team_players set role = 'mixed1' where team_id = t.team_id and player_id = ids[1];
    update public.team_players set role = 'mixed2' where team_id = t.team_id and player_id = ids[2];
    update public.team_players set role = 'woman'  where team_id = t.team_id and player_id = ids[3];
    update public.players set gender = 'female' where id = ids[3];
  end loop;
end $$;

-- ---------- roster writer (internal) ----------
-- Replaces a team's players with exactly the three named. Everything that writes a roster goes
-- through here so the rule (2 men + 1 woman, one per role) lives in one place.
create or replace function public.write_roster(p_team uuid, p_mixed1 text, p_mixed2 text, p_woman text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare t uuid; m1 text := btrim(coalesce(p_mixed1, '')); m2 text := btrim(coalesce(p_mixed2, '')); w text := btrim(coalesce(p_woman, '')); pid uuid;
begin
  select tournament_id into t from public.teams where id = p_team;
  if t is null then raise exception using errcode = 'P0001', message = 'invalid_input'; end if;
  if length(m1) not between 1 and 60 or length(m2) not between 1 and 60 or length(w) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  delete from public.players where id in (select player_id from public.team_players where team_id = p_team);
  insert into public.players (tournament_id, name, gender) values (t, m1, 'male') returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'mixed1');
  insert into public.players (tournament_id, name, gender) values (t, m2, 'male') returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'mixed2');
  insert into public.players (tournament_id, name, gender) values (t, w, 'female') returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'woman');
end; $$;

revoke execute on function public.write_roster(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.write_roster(uuid, text, text, text) to service_role;

-- ---------- public sign-up (the only anonymous write path) ----------
create or replace function public.sign_up_team(
  p_slug text, p_join_code text, p_name text, p_tagline text, p_colour text, p_description text,
  p_mixed1 text, p_mixed2 text, p_woman text
) returns text
language plpgsql volatile security definer set search_path = public as $$
declare tr public.tournaments%rowtype; nm text := btrim(coalesce(p_name, '')); team_id uuid; tok text;
begin
  select * into tr from public.tournaments where slug = p_slug;
  if tr.id is null or tr.status <> 'setup' or not tr.signup_open then
    raise exception using errcode = 'P0001', message = 'signup_closed';
  end if;
  if tr.join_code is not null and lower(btrim(coalesce(p_join_code, ''))) <> lower(btrim(tr.join_code)) then
    raise exception using errcode = 'P0001', message = 'bad_join_code';
  end if;
  if length(nm) not between 1 and 40 or length(coalesce(p_tagline, '')) > 80 or length(coalesce(p_description, '')) > 400
     or coalesce(p_colour, '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if exists (select 1 from public.teams where tournament_id = tr.id and lower(name) = lower(nm)) then
    raise exception using errcode = 'P0001', message = 'duplicate_name';
  end if;
  -- teams_name_ci_unique catches a concurrent sign-up that slipped past the check above. The only
  -- other unique constraint here is (tournament_id, edit_token), and those are 24 random
  -- characters, so any unique_violation on this insert is the name.
  begin
    insert into public.teams (tournament_id, name, tagline, colour, description)
      values (tr.id, nm, coalesce(p_tagline, ''), p_colour, coalesce(p_description, ''))
      returning id, edit_token into team_id, tok;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_name';
  end;
  perform public.write_roster(team_id, p_mixed1, p_mixed2, p_woman);
  return tok;
end; $$;

grant execute on function public.sign_up_team(text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

-- The join form has to know whether to show the code box. This answers that without leaking the code.
create or replace function public.signup_needs_code(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select join_code is not null from public.tournaments where slug = p_slug), false);
$$;

grant execute on function public.signup_needs_code(text) to anon, authenticated, service_role;

-- Organisers need to read the code back to share it. Like team_edit_tokens, this is the only way out.
create or replace function public.tournament_join_code(t uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare code text;
begin
  if not public.is_tournament_admin(t) then raise exception 'not_admin' using errcode = '42501'; end if;
  select join_code into code from public.tournaments where id = t;
  return code;
end; $$;

revoke execute on function public.tournament_join_code(uuid) from public, anon;
grant execute on function public.tournament_join_code(uuid) to authenticated, service_role;

-- ---------- organiser: add a team with its roster, or rewrite a roster ----------
create or replace function public.admin_add_team(p_tournament uuid, p_name text, p_mixed1 text, p_mixed2 text, p_woman text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, '')); team_id uuid;
begin
  if not public.is_tournament_admin(p_tournament) then raise exception 'not_admin' using errcode = '42501'; end if;
  if (select status from public.tournaments where id = p_tournament) <> 'setup' then raise exception using errcode = 'P0001', message = 'stale_state'; end if;
  if length(nm) not between 1 and 40 then raise exception using errcode = 'P0001', message = 'invalid_input'; end if;
  if exists (select 1 from public.teams where tournament_id = p_tournament and lower(name) = lower(nm)) then
    raise exception using errcode = 'P0001', message = 'duplicate_name';
  end if;
  -- Same race as in sign_up_team; see the note there on why unique_violation means the name.
  begin
    insert into public.teams (tournament_id, name) values (p_tournament, nm) returning id into team_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_name';
  end;
  perform public.write_roster(team_id, p_mixed1, p_mixed2, p_woman);
  return team_id;
end; $$;

create or replace function public.admin_set_roster(p_team uuid, p_mixed1 text, p_mixed2 text, p_woman text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare t uuid;
begin
  select tournament_id into t from public.teams where id = p_team;
  if t is null or not public.is_tournament_admin(t) then raise exception 'not_admin' using errcode = '42501'; end if;
  if (select status from public.tournaments where id = t) <> 'setup' then raise exception using errcode = 'P0001', message = 'stale_state'; end if;
  perform public.write_roster(p_team, p_mixed1, p_mixed2, p_woman);
end; $$;

revoke execute on function public.admin_add_team(uuid, text, text, text, text) from public, anon;
revoke execute on function public.admin_set_roster(uuid, text, text, text) from public, anon;
grant execute on function public.admin_add_team(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.admin_set_roster(uuid, text, text, text) to authenticated, service_role;

-- The free-text importer is replaced by the three-box form.
drop function if exists public.add_teams(uuid, jsonb);
