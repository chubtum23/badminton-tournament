-- v1.5.1: one photo per team, not one per player.
--
-- The previous migration hung a photo off every player, which read as a profile picture on an
-- account that does not exist: sign-up is anonymous and a player row is recreated from scratch
-- every time a roster is edited. A team is the thing that persists and the thing people recognise,
-- so the photo belongs to it. The bucket, the path shape and the 400 KB limit are unchanged.

alter table public.teams add column photo_path text
  check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.jpg$');

-- teams is one of the two tables whose select grant is an explicit column list rather than the
-- whole table (the edit_token has to stay hidden), so a new column has to be named here or the
-- public pages cannot read it.
grant select (photo_path) on public.teams to anon, authenticated;

-- Anything already uploaded under the per-player design moves up to the team rather than being
-- dropped with the column: a team takes the first photo among its players, in playing order. The
-- object itself does not move — the path is the same, and the bucket is unchanged.
update public.teams t set photo_path = (
  select p.photo_path
    from public.team_players tp
    join public.players p on p.id = tp.player_id
   where tp.team_id = t.id and p.photo_path is not null
   order by case tp.role when 'mixed1' then 1 when 'mixed2' then 2 else 3 end
   limit 1
)
where t.photo_path is null;

alter table public.players drop column photo_path;

-- ---------- back to a roster function that only knows about names ----------
drop function if exists public.write_roster(uuid, text, text, text, text, text, text);

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

-- ---------- sign-up takes one photo, and it goes on the team ----------
drop function if exists public.sign_up_team(text, text, text, text, text, text, text, text, text, text, text, text);

create or replace function public.sign_up_team(
  p_slug text, p_join_code text, p_name text, p_tagline text, p_colour text, p_description text,
  p_mixed1 text, p_mixed2 text, p_woman text, p_photo text default null
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
    insert into public.teams (tournament_id, name, tagline, colour, description, photo_path)
      values (tr.id, nm, coalesce(p_tagline, ''), p_colour, coalesce(p_description, ''), p_photo)
      returning id, edit_token into team_id, tok;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_name';
  end;
  perform public.write_roster(team_id, p_mixed1, p_mixed2, p_woman);
  return tok;
end; $$;

-- The only rate limiter for sign-ups lives in the app tier (the server action), and the anon key
-- ships in the browser bundle, so a function anon could execute directly would be a free loop for
-- unbounded team creation and join-code guessing. The server action calls this with the service
-- role after rate limiting and validating; the function still re-checks everything itself.
revoke execute on function public.sign_up_team(text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_up_team(text, text, text, text, text, text, text, text, text, text) to service_role;

-- ---------- the two organiser functions go back to their pre-photo shapes ----------
drop function if exists public.admin_add_team(uuid, text, text, text, text, text, text, text);

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

drop function if exists public.admin_set_roster(uuid, text, text, text, text, text, text);

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
