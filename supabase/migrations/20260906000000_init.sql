-- Schema for the tournament app. Rules live in @tournament/core; this file only stores state.
create extension if not exists pgcrypto;

-- ---------- helpers ----------
create or replace function public.new_team_token() returns text
language sql volatile as $$
  select substr(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '/', '_'), '+', '-'), 1, 24);
$$;

-- ---------- tables ----------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (length(name) between 1 and 80),
  sport text not null default 'badminton',
  status text not null default 'setup' check (status in ('setup','pools','knockout','finished')),
  games_per_match int not null default 3,
  points_per_game int not null default 15,
  win_by_two boolean not null default true,
  max_points int default 21,
  court_count int not null default 2 check (court_count between 1 and 50),
  advance_per_pool int not null default 2 check (advance_per_pool between 1 and 8),
  created_at timestamptz not null default now()
);

create table public.tournament_admins (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (tournament_id, user_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null check (length(name) between 1 and 60)
);

create table public.pools (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  position int not null,
  locked boolean not null default false,
  unique (tournament_id, position)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  tagline text not null default '' check (length(tagline) <= 80),
  colour text not null default '#2563eb' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  seed int check (seed is null or seed between 1 and 64),
  edit_token text not null default public.new_team_token(),
  pool_id uuid references public.pools(id) on delete set null,
  pool_order int not null default 0,
  unique (tournament_id, edit_token)
);

create table public.team_players (
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (team_id, player_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage text not null check (stage in ('pool','knockout')),
  pool_id uuid references public.pools(id) on delete cascade,
  round int,
  slot int not null,
  team_a_id uuid references public.teams(id) on delete set null,
  team_b_id uuid references public.teams(id) on delete set null,
  court int,
  status text not null default 'pending'
    check (status in ('pending','ready','live','submitted','disputed','done')),
  winner_id uuid references public.teams(id) on delete set null,
  next_match_id uuid references public.matches(id) on delete set null,
  next_match_side text check (next_match_side in ('a','b')),
  check ((stage = 'pool' and pool_id is not null and round is null)
      or (stage = 'knockout' and pool_id is null and round is not null))
);
create index matches_tournament_idx on public.matches (tournament_id, stage, status);

create table public.games (
  match_id uuid not null references public.matches(id) on delete cascade,
  game_no int not null check (game_no between 1 and 9),
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  primary key (match_id, game_no)
);

create table public.score_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  submitted_by text not null check (submitted_by in ('admin','team_a','team_b')),
  games jsonb not null,
  created_at timestamptz not null default now()
);
create index score_submissions_match_idx on public.score_submissions (match_id, created_at desc);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- admin check ----------
create or replace function public.is_tournament_admin(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_admins where tournament_id = t and user_id = auth.uid()
  );
$$;

-- Called from RLS policies; must remain executable by all API roles.
grant execute on function public.is_tournament_admin(uuid) to anon, authenticated, service_role;

-- ---------- RLS ----------
alter table public.tournaments enable row level security;
alter table public.tournament_admins enable row level security;
alter table public.players enable row level security;
alter table public.pools enable row level security;
alter table public.teams enable row level security;
alter table public.team_players enable row level security;
alter table public.matches enable row level security;
alter table public.games enable row level security;
alter table public.score_submissions enable row level security;
alter table public.announcements enable row level security;

-- tournaments: anyone reads; any signed-in user may create; only admins change
create policy tournaments_read on public.tournaments for select using (true);
create policy tournaments_insert on public.tournaments for insert to authenticated with check (true);
create policy tournaments_update on public.tournaments for update to authenticated
  using (public.is_tournament_admin(id)) with check (public.is_tournament_admin(id));
create policy tournaments_delete on public.tournaments for delete to authenticated
  using (public.is_tournament_admin(id));

-- tournament_admins: you see your own rows; you may add yourself
create policy admins_read on public.tournament_admins for select to authenticated using (user_id = auth.uid());
create policy admins_insert on public.tournament_admins for insert to authenticated with check (user_id = auth.uid());

-- tables keyed by tournament_id: public read, admin write
create policy players_read on public.players for select using (true);
create policy players_write on public.players for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));

create policy pools_read on public.pools for select using (true);
create policy pools_write on public.pools for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));

create policy teams_read on public.teams for select using (true);
create policy teams_write on public.teams for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));

create policy matches_read on public.matches for select using (true);
create policy matches_write on public.matches for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));

create policy announcements_read on public.announcements for select using (true);
create policy announcements_write on public.announcements for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));

-- tables without tournament_id: resolve through the parent
create policy team_players_read on public.team_players for select using (true);
create policy team_players_write on public.team_players for all to authenticated
  using (public.is_tournament_admin((select tournament_id from public.teams where id = team_id)))
  with check (public.is_tournament_admin((select tournament_id from public.teams where id = team_id)));

create policy games_read on public.games for select using (true);
create policy games_write on public.games for all to authenticated
  using (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)))
  with check (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)));

-- score_submissions: public read now; participant writes arrive in plan 3 via service role
create policy submissions_read on public.score_submissions for select using (true);
create policy submissions_admin_write on public.score_submissions for all to authenticated
  using (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)))
  with check (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)));

-- ---------- hide edit_token from anon and authenticated ----------
revoke select on public.teams from anon, authenticated;
grant select (id, tournament_id, name, tagline, colour, seed, pool_id, pool_order)
  on public.teams to anon, authenticated;

-- admins fetch tokens through a checked function
create or replace function public.team_edit_tokens(t uuid)
returns table (team_id uuid, edit_token text)
language sql stable security definer set search_path = public as $$
  select id, edit_token from public.teams
  where tournament_id = t and public.is_tournament_admin(t);
$$;

create or replace function public.regenerate_team_token(team uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  t uuid;
  tok text;
begin
  select tournament_id into t from public.teams where id = team;
  if t is null or not public.is_tournament_admin(t) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  tok := public.new_team_token();
  update public.teams set edit_token = tok where id = team;
  return tok;
end;
$$;

revoke execute on function public.team_edit_tokens(uuid) from public, anon;
revoke execute on function public.regenerate_team_token(uuid) from public, anon;
grant execute on function public.team_edit_tokens(uuid) to authenticated, service_role;
grant execute on function public.regenerate_team_token(uuid) to authenticated, service_role;
