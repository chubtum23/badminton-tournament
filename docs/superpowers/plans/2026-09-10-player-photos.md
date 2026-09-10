# Player photos implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each of a team's three players carry an optional photo, uploaded in the same submit as their name, shown as a circle ringed in the team's colour.

**Architecture:** The browser crops and resizes to a 512x512 JPEG before upload, so the server never decodes an image. Photos land in a public Supabase Storage bucket under random paths, written only by the service role. `write_roster` takes the three paths as parameters — the caller decides which photo belongs to which slot, because the database cannot tell a rename from a replacement.

**Tech Stack:** Next.js 15 server actions, Supabase Storage + Postgres, canvas API, vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-player-photos-design.md`

## Global Constraints

- Bounds, verbatim: picked file over `15 MB` or under `2 KB` rejected; decoded image rejected if either side is under `96 px`; accepted pick types `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`; stored object 512x512 JPEG quality `0.82`, rejected server-side above `400 KB` or if the bytes do not start `FF D8 FF`.
- Object path: `<tournament_id>/<32 hex chars>.jpg`. Never reuse a path.
- Photos are optional everywhere. A team that uploads nothing signs up exactly as it does today.
- Storage writes are service-role only. `anon` and `authenticated` get no insert/update/delete on `storage.objects`.
- The design system is zero-radius; the avatar circle is the deliberate exception. Everything else uses the existing tokens in `src/components/ui.ts`.
- Tests are vitest (`npm run test -w @tournament/web`). No new e2e spec.

---

### Task 1: Schema, bucket and the roster function

**Files:**
- Create: `supabase/migrations/20260910160000_player_photos.sql`
- Modify: `apps/web/src/lib/db/types.ts:70-75`, `apps/web/src/lib/db/queries.ts:109`

**Interfaces:**
- Produces: `players.photo_path text | null`; `write_roster(uuid, text, text, text, text, text, text)`; `sign_up_team(...9 existing args..., p_photo1, p_photo2, p_photow)`; `admin_add_team` and `admin_set_roster` each with the same three appended; `PlayerRow.photo_path: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- v1.5: an optional photo per player, stored in the player-photos bucket.

alter table public.players add column photo_path text
  check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.jpg$');

-- Public read so a plain <img> works; every write is service-role, which bypasses RLS. No policy
-- is added to storage.objects, so anon and authenticated can do nothing but read through the
-- public endpoint. The size and type limits here are the last backstop behind the server action.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', true, 409600, array['image/jpeg'])
on conflict (id) do nothing;

-- The signature changes, so the old one is dropped rather than left as an overload.
drop function if exists public.write_roster(uuid, text, text, text);

-- The three paths are parameters, not something this function works out for itself. It cannot
-- tell a rename from a replacement, and swapMixed moves a person between roles; the caller knows
-- which photo belongs to which slot and says so.
create or replace function public.write_roster(
  p_team uuid, p_mixed1 text, p_mixed2 text, p_woman text,
  p_photo1 text default null, p_photo2 text default null, p_photow text default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
declare t uuid; m1 text := btrim(coalesce(p_mixed1, '')); m2 text := btrim(coalesce(p_mixed2, '')); w text := btrim(coalesce(p_woman, '')); pid uuid;
begin
  select tournament_id into t from public.teams where id = p_team;
  if t is null then raise exception using errcode = 'P0001', message = 'invalid_input'; end if;
  if length(m1) not between 1 and 60 or length(m2) not between 1 and 60 or length(w) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  delete from public.players where id in (select player_id from public.team_players where team_id = p_team);
  insert into public.players (tournament_id, name, gender, photo_path) values (t, m1, 'male', p_photo1) returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'mixed1');
  insert into public.players (tournament_id, name, gender, photo_path) values (t, m2, 'male', p_photo2) returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'mixed2');
  insert into public.players (tournament_id, name, gender, photo_path) values (t, w, 'female', p_photow) returning id into pid;
  insert into public.team_players (team_id, player_id, role) values (p_team, pid, 'woman');
end; $$;

revoke execute on function public.write_roster(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.write_roster(uuid, text, text, text, text, text, text) to service_role;
```

Then, in the same file, redefine the three callers so they forward the paths. Copy each body verbatim from `supabase/migrations/20260908120000_team_signup.sql`, changing only the signature and the `perform public.write_roster(...)` line:

```sql
drop function if exists public.sign_up_team(text, text, text, text, text, text, text, text, text);

create or replace function public.sign_up_team(
  p_slug text, p_join_code text, p_name text, p_tagline text, p_colour text, p_description text,
  p_mixed1 text, p_mixed2 text, p_woman text,
  p_photo1 text default null, p_photo2 text default null, p_photow text default null
) returns text
language plpgsql volatile security definer set search_path = public as $$
-- Body unchanged from 20260908120000 except its final statement, which becomes:
--   perform public.write_roster(team_id, p_mixed1, p_mixed2, p_woman, p_photo1, p_photo2, p_photow);
$$;

revoke execute on function public.sign_up_team(text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_up_team(text, text, text, text, text, text, text, text, text, text, text, text) to service_role;
```

Do the same for `admin_add_team` and `admin_set_roster`: append `p_photo1 text default null, p_photo2 text default null, p_photow text default null`, drop each at its old signature first, keep the existing `is_tournament_admin` and `status = 'setup'` checks exactly as they are, and re-grant each to `authenticated, service_role`.

- [ ] **Step 2: Apply it and check the bucket**

```bash
npx supabase db reset
npx supabase db query "select id, public, file_size_limit from storage.buckets where id = 'player-photos'"
```
Expected: one row, `public = t`, `file_size_limit = 409600`. A reset wipes the local admin user, so re-run `npm run seed:admin -w @tournament/web` afterwards.

- [ ] **Step 3: Carry the column into the app's types**

`apps/web/src/lib/db/types.ts`, in `PlayerRow`:

```ts
  photo_path: string | null;
```

`apps/web/src/lib/db/queries.ts:109`, widen the select:

```ts
    await sb.from('team_players').select('team_id, role, players(id, tournament_id, name, gender, photo_path)').in('team_id', teams.map((t) => t.id)),
```

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck -w @tournament/web
git add supabase/migrations apps/web/src/lib/db
git commit -m "feat(db): give players an optional photo path and a bucket to hold it"
```
Expected: clean. The existing `write_roster` callers in `actions/participant.ts` still compile, because the new parameters have defaults.

---

### Task 2: The pure photo rules

**Files:**
- Create: `apps/web/src/lib/photos/rules.ts`, `apps/web/src/lib/photos/rules.test.ts`

**Interfaces:**
- Produces: `PICK_LIMITS`, `STORED`, `checkPickedFile(file: { size: number; type: string }): string | null`, `checkStoredBytes(bytes: Uint8Array): string | null`, `squareCrop(w: number, h: number): { x: number; y: number; size: number }`, `photoPath(tournamentId: string, random?: () => string): string`, `publicPhotoUrl(path: string): string`, `initialsOf(name: string): string`, `inkOn(hex: string): '#FFFFFF' | '#1A1B2E'`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { checkPickedFile, checkStoredBytes, squareCrop, photoPath, initialsOf, inkOn } from './rules';

const jpeg = (n: number) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff], 0); return b; };

describe('checkPickedFile', () => {
  it('accepts an ordinary phone photo', () => expect(checkPickedFile({ size: 4_000_000, type: 'image/jpeg' })).toBeNull());
  it('accepts heic, which iPhones sometimes hand over', () => expect(checkPickedFile({ size: 4_000_000, type: 'image/heic' })).toBeNull());
  it('rejects over 15 MB', () => expect(checkPickedFile({ size: 15 * 1024 * 1024 + 1, type: 'image/jpeg' })).toMatch(/too large/i));
  it('rejects under 2 KB', () => expect(checkPickedFile({ size: 1024, type: 'image/jpeg' })).toMatch(/too small/i));
  it('rejects a video dressed as a profile picture', () => expect(checkPickedFile({ size: 100_000, type: 'video/mp4' })).toMatch(/JPEG, PNG/));
});

describe('checkStoredBytes', () => {
  it('accepts a small jpeg', () => expect(checkStoredBytes(jpeg(80_000))).toBeNull());
  it('rejects over 400 KB', () => expect(checkStoredBytes(jpeg(400 * 1024 + 1))).toMatch(/too large/i));
  it('rejects bytes that are not a jpeg', () => expect(checkStoredBytes(new Uint8Array([0x89, 0x50, 0x4e]))).toMatch(/not a JPEG/));
});

describe('squareCrop', () => {
  it('takes the middle of a landscape photo', () => expect(squareCrop(400, 300)).toEqual({ x: 50, y: 0, size: 300 }));
  it('takes the middle of a portrait photo', () => expect(squareCrop(300, 400)).toEqual({ x: 0, y: 50, size: 300 }));
  it('leaves a square alone', () => expect(squareCrop(300, 300)).toEqual({ x: 0, y: 0, size: 300 }));
});

describe('photoPath', () => {
  it('puts a random name under the tournament', () => {
    expect(photoPath('0b1c2d3e-4f56-4789-8abc-def012345678', () => 'a'.repeat(32)))
      .toBe(`0b1c2d3e-4f56-4789-8abc-def012345678/${'a'.repeat(32)}.jpg`);
  });
});

describe('initialsOf', () => {
  it('takes both ends of a full name', () => expect(initialsOf('Priya Raman')).toBe('PR'));
  it('takes one letter from a single name', () => expect(initialsOf('Priya')).toBe('P'));
  it('skips the middle name', () => expect(initialsOf('Alex John Chen')).toBe('AC'));
  it('never comes back empty', () => expect(initialsOf('   ')).toBe('?'));
});

describe('inkOn', () => {
  it('is white on the club navy', () => expect(inkOn('#2B3390')).toBe('#FFFFFF'));
  it('is dark on a pale colour', () => expect(inkOn('#FFE94A')).toBe('#1A1B2E'));
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -w @tournament/web -- src/lib/photos/rules.test.ts
```
Expected: FAIL, cannot resolve `./rules`.

- [ ] **Step 3: Write `rules.ts`**

```ts
/**
 * Everything about a photo that is a rule rather than a mechanism. Shared by the browser, which
 * checks before doing the work, and the server, which cannot trust that the browser did.
 */
export const PICK_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  minBytes: 2 * 1024,
  minSide: 96,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
} as const;

/** What the resize step is asked to produce. */
export const STORED = { side: 512, quality: 0.82, maxBytes: 400 * 1024 } as const;

/** The sentence to show the player, or null if the file is fine. */
export function checkPickedFile(file: { size: number; type: string }): string | null {
  if (!PICK_LIMITS.types.includes(file.type as typeof PICK_LIMITS.types[number])) {
    return 'That has to be a JPEG, PNG, WEBP or HEIC photo';
  }
  if (file.size > PICK_LIMITS.maxBytes) return 'That photo is too large; 15 MB is the limit';
  if (file.size < PICK_LIMITS.minBytes) return 'That file is too small to be a photo';
  return null;
}

/**
 * The server's own check on what arrived. The browser does the resizing, so this is the only thing
 * between a hand-rolled POST and an arbitrary file sitting in a public bucket.
 */
export function checkStoredBytes(bytes: Uint8Array): string | null {
  if (bytes.length > STORED.maxBytes) return 'Photo too large';
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return 'Photo is not a JPEG';
  return null;
}

/** The largest centred square inside w x h. */
export function squareCrop(w: number, h: number): { x: number; y: number; size: number } {
  const size = Math.min(w, h);
  return { x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size };
}

/** 32 random hex characters under the tournament's folder. Never reused, so a CDN cannot go stale. */
export function photoPath(tournamentId: string, random: () => string = randomHex32): string {
  return `${tournamentId}/${random()}.jpg`;
}

function randomHex32(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function publicPhotoUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/player-photos/${path}`;
}

/** First and last initial: the fallback avatar's whole content, so it never comes back empty. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * White reads well on the club navy, but a team may pick anything, including a pale yellow that
 * would leave white initials invisible. Relative luminance decides which way to go.
 */
export function inkOn(hex: string): '#FFFFFF' | '#1A1B2E' {
  const v = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(v(0)) + 0.7152 * lin(v(1)) + 0.0722 * lin(v(2));
  return l > 0.45 ? '#1A1B2E' : '#FFFFFF';
}
```

- [ ] **Step 4: Run the tests**

```bash
npm run test -w @tournament/web -- src/lib/photos/rules.test.ts
```
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photos
git commit -m "feat(web): the rules a player photo has to satisfy, and the initials behind it"
```

---

### Task 3: The avatar and the picker

**Files:**
- Create: `apps/web/src/lib/photos/resize.ts`, `apps/web/src/components/PlayerAvatar.tsx`, `apps/web/src/components/PhotoField.tsx`
- Modify: `apps/web/src/components/RosterFields.tsx`, `apps/web/src/components/JoinForm.tsx`

**Interfaces:**
- Consumes: everything from `@/lib/photos/rules`.
- Produces: `resizeToSquareJpeg(file: File): Promise<Blob>`; `<PlayerAvatar name colour path size />`; `<PhotoField role name colour currentPath />`, which renders a hidden `photo_<role>` (the path already stored, emptied on remove) and a file input `photo_<role>_file` holding a newly resized blob.

- [ ] **Step 1: Write `resize.ts`**

```ts
'use client';
import { PICK_LIMITS, STORED, squareCrop } from './rules';

/**
 * Decode, crop to a centred square, draw at 512 and re-encode as JPEG. Done here rather than on
 * the server so a 10 MB photo never crosses the wire and the server never decodes anything.
 *
 * HEIC is decoded by the browser or not at all: Safari can, Chrome and Firefox cannot. A failed
 * decode rejects with a sentence the field shows. Bundling a WASM decoder is not worth ~500 KB
 * for a case iOS mostly avoids by converting to JPEG as the file is picked.
 */
export async function resizeToSquareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    if (img.naturalWidth < PICK_LIMITS.minSide || img.naturalHeight < PICK_LIMITS.minSide) {
      throw new Error(`That photo is too small; ${PICK_LIMITS.minSide} pixels is the minimum`);
    }
    const { x, y, size } = squareCrop(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = STORED.side;
    canvas.height = STORED.side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read that photo');
    ctx.drawImage(img, x, y, size, size, 0, 0, STORED.side, STORED.side);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', STORED.quality));
    if (!blob) throw new Error('Could not read that photo');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This device cannot read that photo format; try another photo'));
    img.src = url;
  });
}
```

- [ ] **Step 2: Write `PlayerAvatar.tsx`**

```tsx
import { initialsOf, inkOn, publicPhotoUrl } from '@/lib/photos/rules';

/**
 * A player's face, or their initials when there is no photo. The only circle in a zero-radius
 * design system, deliberately: a profile picture reads as one, and the team colour ringing it
 * ties a player back to their team at a glance.
 *
 * A plain <img> rather than next/image, for the same reason as ClubLogo: these are already 512px
 * JPEGs of about 80 KB served from Supabase's CDN, so the optimisation pipeline adds a hop and
 * buys nothing.
 */
export function PlayerAvatar({ name, colour, path, size = 40 }: {
  name: string; colour: string; path: string | null; size?: number;
}) {
  const box = { width: size, height: size, borderColor: colour };
  if (!path) {
    return (
      <span aria-hidden style={{ ...box, background: colour, color: inkOn(colour), fontSize: Math.round(size * 0.36) }}
        className="inline-flex shrink-0 items-center justify-center rounded-full border-[3px] font-display font-black leading-none">
        {initialsOf(name)}
      </span>
    );
  }
  return (
    <img src={publicPhotoUrl(path)} alt="" loading="lazy" style={box}
      className="inline-block shrink-0 rounded-full border-[3px] bg-line-soft object-cover" />
  );
}
```

- [ ] **Step 3: Write `PhotoField.tsx`**

```tsx
'use client';
import { useRef, useState } from 'react';
import { checkPickedFile } from '@/lib/photos/rules';
import { resizeToSquareJpeg } from '@/lib/photos/resize';
import { PlayerAvatar } from './PlayerAvatar';
import { ui } from './ui';

/**
 * One player's photo, beside their name box. Everything happens in the browser: the picked file is
 * checked, cropped square and re-encoded to about 80 KB before the form is ever submitted, so the
 * sign-up POST carries three small JPEGs rather than three phone photos.
 *
 * `photo_<role>` carries the path already stored, emptied when the player removes it;
 * `photo_<role>_file` carries a new blob. The server takes the file when there is one, the path
 * otherwise.
 */
export function PhotoField({ role, name, colour, currentPath }: {
  role: 'mixed1' | 'mixed2' | 'woman'; name: string; colour: string; currentPath: string | null;
}) {
  const [path, setPath] = useState(currentPath);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const problem = checkPickedFile(file);
    if (problem) { e.target.value = ''; setError(problem); return; }
    setError(null);
    setBusy(true);
    try {
      const blob = await resizeToSquareJpeg(file);
      // The resized blob replaces the picked file in the input, so the form posts ~80 KB rather
      // than the original. DataTransfer is the only way to write a FileList.
      const dt = new DataTransfer();
      dt.items.add(new File([blob], `${role}.jpg`, { type: 'image/jpeg' }));
      if (fileInput.current) fileInput.current.files = dt.files;
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    } catch (err) {
      if (fileInput.current) fileInput.current.value = '';
      setError(err instanceof Error ? err.message : 'Could not read that photo');
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (fileInput.current) fileInput.current.value = '';
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setPath(null);
    setError(null);
  }

  const has = preview !== null || path !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {preview
        ? <img src={preview} alt="" style={{ width: 44, height: 44, borderColor: colour }} className="inline-block shrink-0 rounded-full border-[3px] object-cover" />
        : <PlayerAvatar name={name} colour={colour} path={path} size={44} />}
      <input ref={fileInput} type="file" name={`photo_${role}_file`} accept="image/*" className="hidden" onChange={pick} />
      <input type="hidden" name={`photo_${role}`} value={path ?? ''} />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={ui.tiny}>
        {busy ? 'Working…' : has ? 'Change photo' : 'Add photo'}
      </button>
      {has && <button type="button" onClick={remove} className={ui.tiny}>Remove</button>}
      {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Put the field under each name box**

`RosterFields.tsx` gains `'use client'` at the top (it now holds state through `PhotoField`) and two new props:

```tsx
export function RosterFields({ defaults, photos, colour = '#2B3390', disabled = false, big = false }: {
  defaults?: { mixed1?: string; mixed2?: string; woman?: string };
  /** The path already stored per role, so an edit shows what is there rather than an empty picker. */
  photos?: { mixed1?: string | null; mixed2?: string | null; woman?: string | null };
  /** Rings the photo and fills the initials fallback. */
  colour?: string;
  disabled?: boolean;
  big?: boolean;
}) {
```

Inside the existing `.map`, after the `<input>` and still inside the `<label>`:

```tsx
          {!disabled && <PhotoField role={key} name={defaults?.[key] ?? ''} colour={colour} currentPath={photos?.[key] ?? null} />}
```

Extend the help line to end with `Photos are optional.`

- [ ] **Step 5: Let the sign-up form's colour reach the rings**

In `JoinForm.tsx`, hold the colour in state so picking one updates the three avatars live:

```tsx
  const [colour, setColour] = useState('#2B3390');
```

Give the colour input `value={colour} onChange={(e) => setColour(e.target.value)}` in place of its `defaultValue`, and pass `colour={colour}` to `<RosterFields big />`.

- [ ] **Step 6: Typecheck, build and commit**

```bash
npm run typecheck -w @tournament/web && npm run build -w @tournament/web
git add apps/web/src
git commit -m "feat(web): a photo picker beside each player, cropped square in the browser"
```
Expected: both clean, and the form still submits with no picker touched.

---

### Task 4: Uploading, and the sign-up path

**Files:**
- Create: `apps/web/src/lib/photos/storage.ts`, `apps/web/src/integration/photos.integration.test.ts`
- Modify: `apps/web/src/lib/teams/roster.ts`, `apps/web/src/actions/signup.ts`

**Interfaces:**
- Consumes: `checkStoredBytes`, `photoPath`.
- Produces: `uploadPhoto(sb, tournamentId, file): Promise<string | null>`, `deletePhotos(sb, paths): Promise<void>`, `ROSTER_ROLES`, `RosterRole`, `photoBlobsFrom(fd): Record<RosterRole, File | null>`, `keptPathsFrom(fd): Record<RosterRole, string | null>`.

- [ ] **Step 1: Write `storage.ts`**

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkStoredBytes, photoPath } from './rules';

const BUCKET = 'player-photos';

/**
 * Uploads one already-resized JPEG and returns its path, or null if it could not be stored.
 *
 * Null rather than a throw, because a photo is optional and losing a whole sign-up to a storage
 * timeout would be the worse failure. The caller carries on without that photo.
 */
export async function uploadPhoto(sb: SupabaseClient, tournamentId: string, file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkStoredBytes(bytes);
  if (problem) { console.warn('photo rejected', { tournamentId, problem }); return null; }
  const path = photoPath(tournamentId);
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (up.error) { console.error('photo upload failed', { tournamentId, message: up.error.message }); return null; }
  return path;
}

/** Best-effort: an unreferenced object is harmless, where a failed row update would not be. */
export async function deletePhotos(sb: SupabaseClient, paths: readonly string[]): Promise<void> {
  const targets = paths.filter(Boolean);
  if (targets.length === 0) return;
  const del = await sb.storage.from(BUCKET).remove([...targets]);
  if (del.error) console.warn('photo delete failed', { message: del.error.message });
}
```

- [ ] **Step 2: Read the photo fields in `roster.ts`**

```ts
export const ROSTER_ROLES = ['mixed1', 'mixed2', 'woman'] as const;
export type RosterRole = typeof ROSTER_ROLES[number];

/** A newly resized blob per role, where the picker put one. */
export function photoBlobsFrom(fd: FormData): Record<RosterRole, File | null> {
  const out: Record<RosterRole, File | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    const v = fd.get(`photo_${role}_file`);
    out[role] = v instanceof File && v.size > 0 ? v : null;
  }
  return out;
}

/** The path the form says is already stored for each role; empty means the player removed it. */
export function keptPathsFrom(fd: FormData): Record<RosterRole, string | null> {
  const out: Record<RosterRole, string | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    const v = String(fd.get(`photo_${role}`) ?? '').trim();
    out[role] = v === '' ? null : v;
  }
  return out;
}
```

Replace the two existing `['mixed1', 'mixed2', 'woman'] as const` literals in this file with `ROSTER_ROLES`.

- [ ] **Step 3: Upload before signing up**

In `apps/web/src/actions/signup.ts`, replace everything from `const sb = createServiceSupabase();` to the `if (res.error)` block with:

```ts
  const sb = createServiceSupabase();
  // The object path needs the tournament id, and this read also fails fast on an unknown slug.
  const t = await sb.from('tournaments').select('id').eq('slug', slug).maybeSingle();
  if (t.error || !t.data) return fail('invalid_input', 'Unknown tournament');
  const blobs = photoBlobsFrom(formData);
  const photos: Record<RosterRole, string | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    const blob = blobs[role];
    if (blob) photos[role] = await uploadPhoto(sb, t.data.id, blob);
  }
  const res = await sb.rpc('sign_up_team', {
    p_slug: slug, p_join_code: v.joinCode === '' ? null : v.joinCode, p_name: v.name, p_tagline: v.tagline,
    p_colour: v.colour, p_description: v.description, p_mixed1: v.mixed1, p_mixed2: v.mixed2, p_woman: v.woman,
    p_photo1: photos.mixed1, p_photo2: photos.mixed2, p_photow: photos.woman,
  });
  if (res.error) {
    // The team was never created, so nothing references these objects.
    await deletePhotos(sb, Object.values(photos).filter((p): p is string => p !== null));
    return fail('invalid_input', rosterErrorMessage(res.error.message));
  }
```

An upload that fails leaves that role null and the sign-up goes through; the team page's picker is how they try again, so nothing further is needed here.

- [ ] **Step 4: Write the integration test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = Boolean(url && serviceKey && anonKey);

/** A real, tiny JPEG: SOI, a comment segment, EOI. Enough to pass the magic-number check. */
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x41, 0x42, 0xff, 0xd9]);

describe.skipIf(!enabled)('player photos', () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let tournamentId: string;
  const slug = `photos-${Date.now().toString(36)}`;
  const path = () => `${tournamentId}/${'ab'.repeat(16)}.jpg`;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const email = `admin-${slug}@example.com`;
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const admin = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await admin.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'Photo test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;
  });

  it('anon cannot write to the bucket', async () => {
    const up = await anon.storage.from('player-photos').upload(`${tournamentId}/${'cd'.repeat(16)}.jpg`, jpegBytes, { contentType: 'image/jpeg' });
    expect(up.error).not.toBeNull();
  });

  it('signs a team up with one photo and two without', async () => {
    const up = await service.storage.from('player-photos').upload(path(), jpegBytes, { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    const res = await service.rpc('sign_up_team', {
      p_slug: slug, p_join_code: null, p_name: 'Photo Team', p_tagline: '', p_colour: '#2B3390',
      p_description: '', p_mixed1: 'Alex', p_mixed2: 'Ben', p_woman: 'Priya',
      p_photo1: path(), p_photo2: null, p_photow: null,
    });
    expect(res.error).toBeNull();
    const rows = await service.from('players').select('name, photo_path').eq('tournament_id', tournamentId);
    expect(rows.data).toEqual(expect.arrayContaining([
      { name: 'Alex', photo_path: path() },
      { name: 'Ben', photo_path: null },
    ]));
  });

  it('refuses a path that is not shaped like one of ours', async () => {
    const bad = await service.from('players').update({ photo_path: '../secrets.jpg' })
      .eq('tournament_id', tournamentId).eq('name', 'Ben').select('id');
    expect(bad.error).not.toBeNull();
  });

  it('keeps a photo with its player when a swap moves them between roles', async () => {
    const team = await service.from('teams').select('id').eq('tournament_id', tournamentId).single();
    // swapMixed passes the paths swapped along with the names, so Alex keeps his face at Mixed #2.
    const res = await service.rpc('write_roster', {
      p_team: team.data!.id, p_mixed1: 'Ben', p_mixed2: 'Alex', p_woman: 'Priya',
      p_photo1: null, p_photo2: path(), p_photow: null,
    });
    expect(res.error).toBeNull();
    const alex = await service.from('players').select('photo_path').eq('tournament_id', tournamentId).eq('name', 'Alex').single();
    expect(alex.data!.photo_path).toBe(path());
  });
});
```

- [ ] **Step 5: Run it**

```bash
npm run test -w @tournament/web -- src/integration/photos.integration.test.ts
```
Expected: PASS, 4 tests. If they all skip, the local Supabase env vars are not loaded — `npx supabase start` and check `apps/web/.env.local`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): upload a player's photo as part of signing the team up"
```

---

### Task 5: Showing them, editing them, removing them

**Files:**
- Modify: `apps/web/src/components/TeamDirectory.tsx`, `apps/web/src/app/t/[slug]/team/page.tsx`, `apps/web/src/actions/participant.ts`, `apps/web/src/actions/teams.ts`, `apps/web/src/components/TeamsAdmin.tsx`

**Interfaces:**
- Consumes: `PlayerAvatar`, `uploadPhoto`, `deletePhotos`, `photoBlobsFrom`, `keptPathsFrom`, `ROSTER_ROLES`, `RosterRole`.
- Produces: `removePlayerPhoto(slug: string, playerId: string): Promise<ActionResult>`.

- [ ] **Step 1: Put the avatar in the directory**

In `TeamDirectory.tsx`, inside the roster `<li>`, wrap the existing name block so the avatar sits before it:

```tsx
                              <span className="flex min-w-0 items-center gap-3">
                                <PlayerAvatar name={p.name} colour={team.colour} path={p.photo_path} size={40} />
                                <span className="min-w-0">
                                  {/* the existing name and role lines, unchanged */}
                                </span>
                              </span>
```

- [ ] **Step 2: Photos on the team edit page**

In `app/t/[slug]/team/page.tsx`, beside the existing roster helper, add:

```tsx
  const pathOf = (r: RosterRole) => mine?.players.find((p) => p.role === r)?.photo_path ?? null;
```

(using whatever that page already calls the current team's row) and pass both new props to the roster form's `RosterFields`:

```tsx
              <RosterFields
                defaults={{ mixed1: byRole('mixed1'), mixed2: byRole('mixed2'), woman: byRole('woman') }}
                photos={{ mixed1: pathOf('mixed1'), mixed2: pathOf('mixed2'), woman: pathOf('woman') }}
                colour={me.team.colour}
              />
```

- [ ] **Step 3: Handle photos in `updateMyRoster`**

In `actions/participant.ts`, between the roster parse and the RPC:

```ts
  const sb = createServiceSupabase();
  const team = (await listTeamsWithPlayers(sb, me.tournament.id)).find((t) => t.id === me.team.id);
  const held = new Set((team?.players ?? []).map((p) => p.photo_path).filter((p): p is string => p !== null));
  const kept = keptPathsFrom(formData);
  const blobs = photoBlobsFrom(formData);
  const photos: Record<RosterRole, string | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    // A kept path has to be one this team already holds. Without this check a crafted form could
    // point a player at any object in the bucket.
    const keep = kept[role] !== null && held.has(kept[role]!) ? kept[role] : null;
    const blob = blobs[role];
    photos[role] = blob ? (await uploadPhoto(sb, me.tournament.id, blob)) ?? keep : keep;
  }
  const res = await sb.rpc('write_roster', {
    p_team: me.team.id, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman,
    p_photo1: photos.mixed1, p_photo2: photos.mixed2, p_photow: photos.woman,
  });
  if (res.error) return fail('invalid_input', rosterErrorMessage(res.error.message));
  // Whatever the team held and no longer references is now unreachable.
  const still = new Set(Object.values(photos).filter((p): p is string => p !== null));
  await deletePhotos(sb, [...held].filter((p) => !still.has(p)));
```

- [ ] **Step 4: Keep photos with the people in `swapMixed`**

Same file. `swapMixed` already reads the team; add a path lookup beside `by` and pass the paths swapped, so a photo follows its player rather than staying on the slot:

```ts
  const pathBy = (role: RosterRole) => team?.players.find((p) => p.role === role)?.photo_path ?? null;
  const res = await sb.rpc('write_roster', {
    p_team: me.team.id, p_mixed1: by('mixed2'), p_mixed2: by('mixed1'), p_woman: by('woman'),
    p_photo1: pathBy('mixed2'), p_photo2: pathBy('mixed1'), p_photow: pathBy('woman'),
  });
```

- [ ] **Step 5: Give the organiser a way to take one down**

In `actions/teams.ts`, add an action following the authorisation pattern the neighbouring actions in that file already use (read the file first — match how they resolve the tournament and check `is_tournament_admin` rather than introducing a second style):

```ts
/** The only moderation there is: sign-up is public, so an organiser can take a photo down. */
export async function removePlayerPhoto(slug: string, playerId: string): Promise<ActionResult> {
  const svc = createServiceSupabase();
  const row = await svc.from('players').select('id, tournament_id, photo_path').eq('id', playerId).maybeSingle();
  if (row.error || !row.data) return fail('invalid_input', 'Unknown player');
  // ...the file's existing admin check against row.data.tournament_id, returning fail('not_admin', ...)
  const upd = await svc.from('players').update({ photo_path: null }).eq('id', playerId);
  if (upd.error) return fail('stale_state', 'Could not remove the photo');
  if (row.data.photo_path) await deletePhotos(svc, [row.data.photo_path]);
  revalidateTournament(slug);
  return ok(undefined);
}
```

- [ ] **Step 6: Show it in the admin Teams page**

In `TeamsAdmin.tsx`, add a wrapper beside the existing `roster` one:

```tsx
  async function dropPhoto(fd: FormData) { 'use server'; redirectWithMsg(here, await removePlayerPhoto(slug, String(fd.get('playerId'))), 'Photo removed'); }
```

and, in each team's expanded panel under the roster fields, a row per player who has one:

```tsx
                        {x.players.filter((p) => p.photo_path).map((p) => (
                          <form key={p.id} action={dropPhoto} className="flex items-center gap-3">
                            <input type="hidden" name="playerId" value={p.id} />
                            <PlayerAvatar name={p.name} colour={x.colour} path={p.photo_path} size={32} />
                            <span className="text-sm font-bold">{p.name}</span>
                            <SubmitButton confirmMessage={`Remove ${p.name}'s photo?`} className={ui.tiny}>Remove photo</SubmitButton>
                          </form>
                        ))}
```

- [ ] **Step 7: Verify the whole thing**

```bash
npm run typecheck -w @tournament/web
npm run test -w @tournament/web
npm run build -w @tournament/web
npm run e2e -w @tournament/web
```
Expected: all clean. `e2e/signup.spec.ts` passing untouched is the real assurance that photos stayed optional. Then sign a team up locally with one photo and check it appears on the Teams tab, ringed in the team's colour, with initials beside it for the two who skipped.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): show player photos, and let a team or the organiser change them"
```
