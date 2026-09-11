-- One result-changing action at a time per tournament.
--
-- A result is written as a series of separate API calls (claim the meeting, write its games, move
-- the winner on), each planned from one read of the whole tournament. Two of those running at once
-- could each overwrite the next-round match from their own stale read — two quarter-finals finishing
-- together could drop a team from the semi-final — or both send a game to the same free court.
--
-- A short lease serialises them: an action takes the tournament's lock before it reads, and gives it
-- back when done. The lease expires by itself, so a request that dies midway blocks nobody for long.

create table public.tournament_locks (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  holder uuid not null,
  expires_at timestamptz not null
);
-- No policies: only the two functions below ever touch this table.
alter table public.tournament_locks enable row level security;

create or replace function public.try_result_lock(p_tournament uuid, p_holder uuid, p_ttl_ms int default 20000) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare got uuid;
begin
  -- Organisers take it through their own session; team submissions arrive with the service role.
  if not (public.is_tournament_admin(p_tournament) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  insert into public.tournament_locks as l (tournament_id, holder, expires_at)
    values (p_tournament, p_holder, clock_timestamp() + make_interval(secs => least(greatest(p_ttl_ms, 1000), 60000) / 1000.0))
  on conflict (tournament_id) do update set holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at < clock_timestamp() or l.holder = excluded.holder
  returning holder into got;
  return got is not null;
end; $$;

-- The holder is a random id only the taker knows, so releasing needs no further check.
create or replace function public.release_result_lock(p_tournament uuid, p_holder uuid) returns void
language sql volatile security definer set search_path = public as $$
  delete from public.tournament_locks where tournament_id = p_tournament and holder = p_holder;
$$;

revoke execute on function public.try_result_lock(uuid, uuid, int) from public, anon;
revoke execute on function public.release_result_lock(uuid, uuid) from public, anon;
grant execute on function public.try_result_lock(uuid, uuid, int) to authenticated, service_role;
grant execute on function public.release_result_lock(uuid, uuid) to authenticated, service_role;
