-- v1.6: a photo gallery per tournament, read from a shared Google Drive folder.
--
-- The photos stay in Drive: the organiser uploads there, shares the folder "anyone with the link",
-- and pastes the link in. The site copies the folder's listing into these tables (a sync), which is
-- what lets the organiser arrange things in ways Drive cannot: albums renamed, reordered and hidden,
-- photos put in any order, starred as highlights or hidden. Images are served by Google; nothing
-- here holds a byte of a photo.

alter table public.tournaments
  add column gallery_folder_id text check (gallery_folder_id is null or gallery_folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  add column gallery_synced_at timestamptz;
grant select (gallery_folder_id, gallery_synced_at) on public.tournaments to anon, authenticated;

-- One per subfolder of the shared folder (and one for photos sitting loose in the folder itself).
create table public.gallery_albums (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  drive_folder_id text not null,
  drive_name text not null check (length(drive_name) between 1 and 300),
  -- The organiser's own name for it; null shows the Drive folder's name.
  title text check (title is null or length(title) between 1 and 80),
  sort_order int not null default 0,
  hidden boolean not null default false,
  unique (tournament_id, drive_folder_id)
);

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  album_id uuid not null references public.gallery_albums(id) on delete cascade,
  drive_file_id text not null,
  name text not null check (length(name) between 1 and 300),
  -- 'raw' is a camera RAW with no JPEG beside it: Drive renders it to a JPEG for viewing and download.
  kind text not null check (kind in ('jpeg', 'raw')),
  -- The RAW file shot alongside a JPEG, offered as a second download.
  raw_file_id text,
  width int not null check (width > 0),
  height int not null check (height > 0),
  -- Null until the organiser arranges the album; nulls sort last, by name (camera numbering is
  -- shot order), so photos added later land at the end of an arranged album.
  sort_order int,
  highlight boolean not null default false,
  hidden boolean not null default false,
  unique (tournament_id, drive_file_id)
);

create index gallery_photos_album_order on public.gallery_photos (album_id, sort_order, name);

-- Albums and photos must belong to the same tournament.
create or replace function public.gallery_photo_same_tournament() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.gallery_albums a where a.id = new.album_id and a.tournament_id = new.tournament_id) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  return new;
end $$;
create trigger gallery_photo_same_tournament before insert or update of album_id, tournament_id on public.gallery_photos
  for each row execute function public.gallery_photo_same_tournament();

alter table public.gallery_albums enable row level security;
alter table public.gallery_photos enable row level security;
create policy gallery_albums_read on public.gallery_albums for select using (true);
create policy gallery_albums_write on public.gallery_albums for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));
create policy gallery_photos_read on public.gallery_photos for select using (true);
create policy gallery_photos_write on public.gallery_photos for all to authenticated
  using (public.is_tournament_admin(tournament_id)) with check (public.is_tournament_admin(tournament_id));

-- Arranging writes a whole album's order in one statement rather than one update per photo.
create or replace function public.gallery_reorder(p_album uuid, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.gallery_photos p set sort_order = o.ord::int - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id and p.album_id = p_album;
end $$;
grant execute on function public.gallery_reorder(uuid, uuid[]) to authenticated;

-- The same for albums within a tournament.
create or replace function public.gallery_reorder_albums(p_tournament uuid, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.gallery_albums a set sort_order = o.ord::int - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where a.id = o.id and a.tournament_id = p_tournament;
end $$;
grant execute on function public.gallery_reorder_albums(uuid, uuid[]) to authenticated;

-- Each album with its photo counts and cover (its first visible photo in the arranged order), in
-- one round trip rather than a count per album.
create or replace function public.gallery_album_summary(p_tournament uuid)
returns table (album_id uuid, visible_count int, total_count int, cover_file_id text, cover_width int, cover_height int)
language sql stable security invoker set search_path = public as $$
  select a.id,
         (select count(*)::int from public.gallery_photos p where p.album_id = a.id and not p.hidden),
         (select count(*)::int from public.gallery_photos p where p.album_id = a.id),
         c.drive_file_id, c.width, c.height
    from public.gallery_albums a
    left join lateral (
      select p.drive_file_id, p.width, p.height from public.gallery_photos p
       where p.album_id = a.id and not p.hidden
       order by p.sort_order nulls last, p.name, p.id limit 1
    ) c on true
   where a.tournament_id = p_tournament;
$$;
grant execute on function public.gallery_album_summary(uuid) to anon, authenticated;
