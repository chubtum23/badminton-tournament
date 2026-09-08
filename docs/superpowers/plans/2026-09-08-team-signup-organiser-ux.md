# Team Sign-up, Rosters and Organiser UX (Plan 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams of exactly two men and one woman sign themselves up through a public link, every game on a meeting card names the pair playing it, and the organiser's admin area becomes a checklist hub with focused pages.

**Architecture:** Roster rules (`validateRoster`, `pairFor`, `pairSlotForGame`) and the cross-pool leaderboard live in `@tournament/core` as pure functions. One migration adds `players.gender`, `team_players.role`, `teams.description`, `tournaments.signup_open` / `join_code`, and four security-definer functions that write a roster atomically (`write_roster` internal, `sign_up_team` for anonymous visitors, `admin_add_team` / `admin_set_roster` for organisers). The web app gets a `/t/[slug]/join` page, a rewritten Teams admin page, split Event / Rules pages, a hub at `/admin/[slug]`, renamed Standings / Draw routes, and pool tabs plus Ready / Finished sections on Matches.

**Tech Stack:** npm workspaces; `packages/tournament-core` (TypeScript, Vitest); `apps/web` (Next.js 15.5 App Router, React 19 server actions, Tailwind, Supabase with `@supabase/ssr`, Vitest integration tests against the local Supabase stack, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-08-team-signup-and-organiser-ux-design.md` sections 0–4, 6, 7. Section 5 (public Teams page, public leaderboard, draw tree) is plan 7.

**Deviations from the spec, decided while planning (the spec text is updated in Task 10):**
- Spec §2.4 names an `update_team_roster(p_token, …)` function. Instead the participant's roster edits go through the service-role client after the existing cookie check (`currentParticipant`), calling the internal `write_roster` function — exactly how profile edits already work. There is therefore no second anonymous write path at all; `sign_up_team` is the only one.
- Spec §2.4 says organiser edits use "the ordinary authenticated RLS path". Writing three players and three links row by row can leave a half-written roster, so organisers use `admin_add_team` and `admin_set_roster` (security definer, admin-checked) which wrap the same `write_roster`.

## Global Constraints

- Roster rule: **exactly three players**, roles `mixed1`, `mixed2`, `woman` each exactly once; `mixed1` and `mixed2` are `male`, `woman` is `female`. Men's doubles is always `mixed1` + `mixed2`.
- Game → pair mapping is **by game number**: 1 → `mixed1`, 2 → `mixed2`, 3 and above → `mens`. Never by label text.
- Sign-up form boxes are labelled exactly **"Man playing Mixed #1"**, **"Man playing Mixed #2"**, **"Woman"**. Nobody types a gender.
- `signup_open` defaults `true`; `lockPools` sets it `false`; unlock does not reopen it.
- `join_code` is optional (null), 3–30 characters when set, compared **trimmed and case-insensitively**, never sent to the browser.
- Team name unique per tournament **case-insensitively**; 1–40 chars. Player names 1–60. Tagline ≤ 80. Description ≤ 400. Colour `#rrggbb`.
- Sign-up rate limit: **10 attempts per minute per client**, its own limiter bucket `signup:<clientKey>`.
- `teams.edit_token` is never readable by anon or authenticated clients; `sign_up_team` returns it once to its caller only.
- Function error messages, mapped by the app: `signup_closed`, `bad_join_code`, `duplicate_name`, `invalid_input`, `stale_state`, `not_admin` (the last with errcode `42501`).
- Admin nav is exactly **Home · Teams · Matches · Standings · Draw · Announcements**. Old `/admin/[slug]/pools` and `/admin/[slug]/bracket` redirect.
- Hub tiles in order: **1. Event details, 2. Rules, 3. Teams, 4. Pools and draw**, each with a Done / To do / Locked pill as in spec §4.2.
- UI conventions: one primary dark button per form, labelled with a verb; destructive buttons red with `confirmMessage`; helper text under fields; inputs at least 44 px tall (`p-3 text-base`).
- Migrations are append-only and named `supabase/migrations/20260908120000_team_signup.sql`.
- Existing tests must keep passing: core `npm test -w @tournament/core`, web `npm test -w @tournament/web`, `npm run typecheck -w @tournament/web`, Playwright `npm run e2e -w @tournament/web`.

---

## File map

**Create**
- `packages/tournament-core/src/roster.ts`, `roster.test.ts` — roster types and rules
- `packages/tournament-core/src/leaderboard.ts`, `leaderboard.test.ts` — `overallLeaderboard`
- `supabase/migrations/20260908120000_team_signup.sql`
- `apps/web/src/lib/teams/roster.ts`, `roster.test.ts` — form parsing, `rosterOf`, `pairNames`, error mapping
- `apps/web/src/lib/admin/hub.ts`, `hub.test.ts` — tile summaries and status line
- `apps/web/src/components/ui.ts` — shared class strings
- `apps/web/src/components/CopyButton.tsx`
- `apps/web/src/components/JoinForm.tsx`
- `apps/web/src/components/RosterFields.tsx`
- `apps/web/src/actions/signup.ts`
- `apps/web/src/app/t/[slug]/join/page.tsx`
- `apps/web/src/app/admin/[slug]/event/page.tsx`, `rules/page.tsx`, `teams/page.tsx`, `standings/page.tsx` (moved from `pools`), `draw/page.tsx` (moved from `bracket`)
- `apps/web/src/integration/signup.integration.test.ts`
- `apps/web/e2e/signup.spec.ts`

**Modify**
- `packages/tournament-core/src/index.ts`
- `apps/web/src/lib/db/types.ts`, `queries.ts`
- `apps/web/src/lib/participant/profile.ts`, `profile.test.ts`
- `apps/web/src/actions/teams.ts`, `participant.ts`, `pools.ts`, `tournaments.ts`, `revalidate.ts`
- `apps/web/src/app/t/[slug]/team/[token]/route.ts`, `team/page.tsx`, `layout.tsx`, `page.tsx`
- `apps/web/src/app/admin/[slug]/layout.tsx`, `page.tsx`, `matches/page.tsx`, `pools/page.tsx` (becomes redirect), `bracket/page.tsx` (becomes redirect)
- `apps/web/src/components/TeamsAdmin.tsx`, `GameLine.tsx`, `NowPlaying.tsx`
- `apps/web/e2e/tournament.spec.ts`, `participant.spec.ts`, `club-format.spec.ts`
- `apps/web/README.md`, spec document

**Delete**
- `apps/web/src/lib/teams/parse.ts`, `parse.test.ts`

---

### Task 1: Core roster rules

**Files:**
- Create: `packages/tournament-core/src/roster.ts`
- Create: `packages/tournament-core/src/roster.test.ts`
- Modify: `packages/tournament-core/src/index.ts`

**Interfaces:**
- Produces: `Gender`, `RosterRole`, `RosterPlayer`, `PairSlot`, `ROSTER_ROLES`, `validateRoster(players)`, `pairFor(players, slot)`, `pairSlotForGame(gameNo)`, `PAIR_SLOT_LABEL`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/tournament-core/src/roster.test.ts
import { describe, it, expect } from 'vitest';
import { pairFor, pairSlotForGame, validateRoster, type RosterPlayer } from './roster';

const alex: RosterPlayer = { id: 'p1', name: 'Alex', gender: 'male', role: 'mixed1' };
const ben: RosterPlayer = { id: 'p2', name: 'Ben', gender: 'male', role: 'mixed2' };
const priya: RosterPlayer = { id: 'p3', name: 'Priya', gender: 'female', role: 'woman' };
const full = [alex, ben, priya];

describe('validateRoster', () => {
  it('accepts two men and one woman with distinct roles', () => {
    expect(validateRoster(full)).toEqual({ ok: true });
  });
  it('rejects fewer than three players', () => {
    expect(validateRoster([alex, priya])).toEqual({ ok: false, reason: 'a team needs exactly 3 players' });
  });
  it('rejects four players', () => {
    expect(validateRoster([...full, { id: 'p4', name: 'Dee', gender: 'female', role: null }]))
      .toEqual({ ok: false, reason: 'a team needs exactly 3 players' });
  });
  it('rejects a missing role', () => {
    expect(validateRoster([alex, { ...ben, role: null }, priya])).toEqual({ ok: false, reason: 'every player needs a role' });
  });
  it('rejects a duplicated role', () => {
    expect(validateRoster([alex, { ...ben, role: 'mixed1' }, priya])).toEqual({ ok: false, reason: 'roles mixed1, mixed2 and woman must each appear once' });
  });
  it('rejects a woman in a mixed slot', () => {
    expect(validateRoster([alex, { ...ben, gender: 'female' }, priya])).toEqual({ ok: false, reason: 'the two mixed players must be men' });
  });
  it('rejects a man in the woman slot', () => {
    expect(validateRoster([alex, ben, { ...priya, gender: 'male' }])).toEqual({ ok: false, reason: 'the woman slot must be a woman' });
  });
});

describe('pairFor', () => {
  it('mixed1 is the mixed1 man with the woman', () => expect(pairFor(full, 'mixed1')).toEqual([alex, priya]));
  it('mixed2 is the mixed2 man with the woman', () => expect(pairFor(full, 'mixed2')).toEqual([ben, priya]));
  it('mens is the two men, mixed1 first', () => expect(pairFor(full, 'mens')).toEqual([alex, ben]));
  it('is null for an incomplete roster', () => expect(pairFor([alex, priya], 'mens')).toBeNull());
  it('is null when roles are missing even with three players', () => expect(pairFor([alex, { ...ben, role: null }, priya], 'mixed2')).toBeNull());
});

describe('pairSlotForGame', () => {
  it('maps games 1, 2, 3 to mixed1, mixed2, mens', () => {
    expect([1, 2, 3].map(pairSlotForGame)).toEqual(['mixed1', 'mixed2', 'mens']);
  });
  it('sends any later game to the men', () => {
    expect(pairSlotForGame(4)).toBe('mens');
    expect(pairSlotForGame(9)).toBe('mens');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/roster.test.ts -w @tournament/core` (or `cd packages/tournament-core && npx vitest run src/roster.test.ts`)
Expected: FAIL — cannot find module `./roster`.

- [ ] **Step 3: Implement**

```ts
// packages/tournament-core/src/roster.ts
export type Gender = 'male' | 'female';
export type RosterRole = 'mixed1' | 'mixed2' | 'woman';
export const ROSTER_ROLES: readonly RosterRole[] = ['mixed1', 'mixed2', 'woman'];

export interface RosterPlayer {
  id: string;
  name: string;
  gender: Gender;
  /** null while the organiser has not assigned this player (legacy rows). */
  role: RosterRole | null;
}

/** Which pair of a team plays a given game. */
export type PairSlot = 'mixed1' | 'mixed2' | 'mens';

export const PAIR_SLOT_LABEL: Record<PairSlot, string> = {
  mixed1: 'Mixed #1 pair', mixed2: 'Mixed #2 pair', mens: 'the two men',
};

/**
 * The club format: exactly two men and one woman. The woman plays both mixed games, the two men
 * play the men's doubles together, so a team is complete when each role appears once with the
 * right gender behind it.
 */
export function validateRoster(players: readonly RosterPlayer[]): { ok: true } | { ok: false; reason: string } {
  if (players.length !== 3) return { ok: false, reason: 'a team needs exactly 3 players' };
  if (players.some((p) => p.role === null)) return { ok: false, reason: 'every player needs a role' };
  const roles = new Set(players.map((p) => p.role));
  if (roles.size !== 3) return { ok: false, reason: 'roles mixed1, mixed2 and woman must each appear once' };
  const men = players.filter((p) => p.role === 'mixed1' || p.role === 'mixed2');
  if (men.some((p) => p.gender !== 'male')) return { ok: false, reason: 'the two mixed players must be men' };
  const woman = players.find((p) => p.role === 'woman')!;
  if (woman.gender !== 'female') return { ok: false, reason: 'the woman slot must be a woman' };
  return { ok: true };
}

/** The two players of a team who play `slot`, or null when the roster is not complete. */
export function pairFor(players: readonly RosterPlayer[], slot: PairSlot): [RosterPlayer, RosterPlayer] | null {
  if (!validateRoster(players).ok) return null;
  const byRole = (r: RosterRole) => players.find((p) => p.role === r)!;
  if (slot === 'mixed1') return [byRole('mixed1'), byRole('woman')];
  if (slot === 'mixed2') return [byRole('mixed2'), byRole('woman')];
  return [byRole('mixed1'), byRole('mixed2')];
}

/**
 * Fixed by position, not by the game's name, so renaming "Mixed doubles #1" changes nothing.
 * Any game past the third defaults to the men's doubles pair.
 */
export function pairSlotForGame(gameNo: number): PairSlot {
  return gameNo === 1 ? 'mixed1' : gameNo === 2 ? 'mixed2' : 'mens';
}
```

Add to `packages/tournament-core/src/index.ts`:

```ts
export * from './roster';
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @tournament/core`
Expected: PASS, previous 100 tests plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/tournament-core/src/roster.ts packages/tournament-core/src/roster.test.ts packages/tournament-core/src/index.ts
git commit -m "feat(core): roster roles, validation and pair lookup"
```

---

### Task 2: Core overall leaderboard

**Files:**
- Create: `packages/tournament-core/src/leaderboard.ts`
- Create: `packages/tournament-core/src/leaderboard.test.ts`
- Modify: `packages/tournament-core/src/index.ts`

**Interfaces:**
- Consumes: `StandingRow` from `./standings`.
- Produces: `LeaderboardRow`, `overallLeaderboard(pools, withdrawnIds?)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/tournament-core/src/leaderboard.test.ts
import { describe, it, expect } from 'vitest';
import { overallLeaderboard } from './leaderboard';
import type { StandingRow } from './standings';

function row(teamId: string, points: number, gamesWon = 0, pointDiff = 0): StandingRow {
  return { teamId, name: teamId, played: 3, won: points, lost: 3 - points, points, gamesWon, gamesLost: 9 - gamesWon, pointsFor: 0, pointsAgainst: 0, pointDiff, tieUnresolved: false };
}

describe('overallLeaderboard', () => {
  it('merges pools and orders by points, games won, point difference, name', () => {
    const out = overallLeaderboard([
      { poolName: 'Pool A', rows: [row('b', 2, 5, 3), row('a', 1, 4, -3)] },
      { poolName: 'Pool B', rows: [row('d', 2, 6, 1), row('c', 2, 5, 3)] },
    ]);
    expect(out.map((r) => r.teamId)).toEqual(['d', 'b', 'c', 'a']);
    expect(out.map((r) => r.poolName)).toEqual(['Pool B', 'Pool A', 'Pool B', 'Pool A']);
  });
  it('gives equal keys the same rank and skips no numbers (dense)', () => {
    const out = overallLeaderboard([{ poolName: 'A', rows: [row('x', 2, 4, 2), row('y', 2, 4, 2), row('z', 0)] }]);
    expect(out.map((r) => r.overallRank)).toEqual([1, 1, 2]);
  });
  it('puts withdrawn teams last with their points intact', () => {
    const out = overallLeaderboard([{ poolName: 'A', rows: [row('w', 3), row('v', 1)] }], ['w']);
    expect(out.map((r) => r.teamId)).toEqual(['v', 'w']);
    expect(out[1]!.points).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/tournament-core && npx vitest run src/leaderboard.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// packages/tournament-core/src/leaderboard.ts
import type { StandingRow } from './standings';

export interface LeaderboardRow extends StandingRow {
  poolName: string;
  /** Dense rank: equal keys share a number and the next distinct key takes the next number. */
  overallRank: number;
}

const key = (r: StandingRow) => [r.points, r.gamesWon, r.pointDiff] as const;

function compare(a: StandingRow, b: StandingRow): number {
  const ka = key(a), kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
  return a.name.localeCompare(b.name);
}

/**
 * Every team of every pool in one table, pool-stage points only (it takes pool standings as its
 * input, so knockout results cannot leak in). Withdrawn teams keep their numbers but sort last.
 */
export function overallLeaderboard(
  pools: readonly { poolName: string; rows: readonly StandingRow[] }[],
  withdrawnIds: readonly string[] = [],
): LeaderboardRow[] {
  const withdrawn = new Set(withdrawnIds);
  const all = pools.flatMap((p) => p.rows.map((r) => ({ ...r, poolName: p.poolName })));
  const active = all.filter((r) => !withdrawn.has(r.teamId)).sort(compare);
  const out = all.filter((r) => withdrawn.has(r.teamId)).sort(compare);
  // Dense ranks compare the numeric keys only: two teams level on everything share a number even
  // though `compare` breaks their order by name. A withdrawn team never shares a rank.
  const sameKey = (p: StandingRow, q: StandingRow) => key(p).every((v, n) => v === key(q)[n]);
  const ranked: LeaderboardRow[] = [];
  let rank = 0;
  for (const [i, r] of [...active, ...out].entries()) {
    const prev = ranked[i - 1];
    const same = prev !== undefined && sameKey(prev, r) && !withdrawn.has(r.teamId) && !withdrawn.has(prev.teamId);
    if (!same) rank += 1;
    ranked.push({ ...r, overallRank: rank });
  }
  return ranked;
}
```

Add to `index.ts`: `export * from './leaderboard';`

- [ ] **Step 4: Run the tests**

Run: `npm test -w @tournament/core` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tournament-core/src/leaderboard.ts packages/tournament-core/src/leaderboard.test.ts packages/tournament-core/src/index.ts
git commit -m "feat(core): overall leaderboard across pools"
```

---

### Task 3: Migration — genders, roles, sign-up columns and roster functions

**Files:**
- Create: `supabase/migrations/20260908120000_team_signup.sql`
- Create: `apps/web/src/integration/signup.integration.test.ts`
- Modify: `apps/web/src/lib/db/types.ts` (columns the tests select)

**Interfaces:**
- Produces DB functions: `sign_up_team(p_slug, p_join_code, p_name, p_tagline, p_colour, p_description, p_mixed1, p_mixed2, p_woman) returns text`; `write_roster(p_team, p_mixed1, p_mixed2, p_woman) returns void` (service_role only); `admin_add_team(p_tournament, p_name, p_mixed1, p_mixed2, p_woman) returns uuid`; `admin_set_roster(p_team, p_mixed1, p_mixed2, p_woman) returns void`. Drops `add_teams`.
- Produces columns: `players.gender`, `team_players.role`, `teams.description`, `tournaments.signup_open`, `tournaments.join_code`.

- [ ] **Step 1: Update the row types**

In `apps/web/src/lib/db/types.ts`:

```ts
// TournamentRow: add after advance_per_pool
  /** Teams may still sign themselves up through /t/[slug]/join. lockPools turns this off. */
  signup_open: boolean;
  /** Optional code the sign-up form must present; null = none. Never sent to the browser. */
  join_code: string | null;

// TeamRow: add after colour
  description: string;

// and
export const TEAM_PUBLIC_COLUMNS = 'id, tournament_id, name, tagline, colour, description, seed, pool_id, pool_order, withdrawn, pool_rank_override';

// PlayerRow
export interface PlayerRow {
  id: string;
  tournament_id: string;
  name: string;
  gender: 'male' | 'female';
}

/** A player as linked to a team, with the role the link carries. */
export interface RosterPlayerRow extends PlayerRow {
  role: 'mixed1' | 'mixed2' | 'woman' | null;
}
```

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/web/src/integration/signup.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const roster = { p_mixed1: 'Alex', p_mixed2: 'Ben', p_woman: 'Priya' };
const profile = { p_tagline: 'smash', p_colour: '#dc2626', p_description: 'We like shuttles' };

describe.skipIf(!enabled)('team sign-up', () => {
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournamentId: string;
  const slug = `signup-${Date.now().toString(36)}`;

  beforeAll(async () => {
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const email = `admin-${slug}@example.com`, password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    admin = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await admin.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'Sign-up test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;
  });

  const signUp = (name: string, extra: Record<string, unknown> = {}) =>
    anon.rpc('sign_up_team', { p_slug: slug, p_join_code: null, p_name: name, ...profile, ...roster, ...extra });

  it('creates the team, three players with genders and roles, and returns the token once', async () => {
    const res = await signUp('Smashers');
    expect(res.error).toBeNull();
    expect(res.data).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const team = await service.from('teams').select('id, edit_token, description').eq('tournament_id', tournamentId).eq('name', 'Smashers').single();
    expect(team.data!.edit_token).toBe(res.data);
    expect(team.data!.description).toBe('We like shuttles');
    const links = await service.from('team_players').select('role, players(name, gender)').eq('team_id', team.data!.id);
    const got = (links.data as unknown as Array<{ role: string; players: { name: string; gender: string } }>)
      .map((l) => `${l.role}:${l.players.name}:${l.players.gender}`).sort();
    expect(got).toEqual(['mixed1:Alex:male', 'mixed2:Ben:male', 'woman:Priya:female']);
  });

  it('anon still cannot read the token afterwards', async () => {
    const res = await anon.from('teams').select('id, edit_token').eq('tournament_id', tournamentId);
    expect(res.error?.message ?? '').toMatch(/permission denied/i);
  });

  it('refuses a duplicate name, case-insensitively', async () => {
    const res = await signUp('SMASHERS');
    expect(res.error?.message).toBe('duplicate_name');
  });

  it('refuses a wrong join code once one is set, and accepts it trimmed and any case', async () => {
    await service.from('tournaments').update({ join_code: 'Club2026' }).eq('id', tournamentId);
    const bad = await signUp('Late Birds', { p_join_code: 'nope' });
    expect(bad.error?.message).toBe('bad_join_code');
    const good = await signUp('Late Birds', { p_join_code: '  club2026 ' });
    expect(good.error).toBeNull();
    await service.from('tournaments').update({ join_code: null }).eq('id', tournamentId);
  });

  it('refuses a blank player name', async () => {
    const res = await signUp('Blanks', { p_woman: '   ' });
    expect(res.error?.message).toBe('invalid_input');
  });

  it('refuses when sign-ups are closed and when the tournament has left setup', async () => {
    await service.from('tournaments').update({ signup_open: false }).eq('id', tournamentId);
    expect((await signUp('Closed Out')).error?.message).toBe('signup_closed');
    await service.from('tournaments').update({ signup_open: true, status: 'pools' }).eq('id', tournamentId);
    expect((await signUp('Too Late')).error?.message).toBe('signup_closed');
    await service.from('tournaments').update({ status: 'setup' }).eq('id', tournamentId);
  });

  it('anon cannot call write_roster or the admin functions', async () => {
    const team = await service.from('teams').select('id').eq('tournament_id', tournamentId).limit(1).single();
    expect((await anon.rpc('write_roster', { p_team: team.data!.id, ...roster })).error).not.toBeNull();
    expect((await anon.rpc('admin_set_roster', { p_team: team.data!.id, ...roster })).error).not.toBeNull();
    expect((await anon.rpc('admin_add_team', { p_tournament: tournamentId, p_name: 'Nope', ...roster })).error).not.toBeNull();
  });

  it('admin_add_team and admin_set_roster write a complete roster in one go', async () => {
    const added = await admin.rpc('admin_add_team', { p_tournament: tournamentId, p_name: 'Organiser Made', ...roster });
    expect(added.error).toBeNull();
    const set = await admin.rpc('admin_set_roster', { p_team: added.data as string, p_mixed1: 'Ben', p_mixed2: 'Alex', p_woman: 'Priya' });
    expect(set.error).toBeNull();
    const links = await service.from('team_players').select('role, players(name)').eq('team_id', added.data as string);
    const got = (links.data as unknown as Array<{ role: string; players: { name: string } }>).map((l) => `${l.role}:${l.players.name}`).sort();
    expect(got).toEqual(['mixed1:Ben', 'mixed2:Alex', 'woman:Priya']);
    const players = await service.from('players').select('id').eq('tournament_id', tournamentId);
    // 3 teams signed up here (Smashers, Late Birds, Organiser Made) → 9 players; a re-set must not leak the old three.
    expect(players.data).toHaveLength(9);
  });

  it('the old add_teams function is gone', async () => {
    const res = await admin.rpc('add_teams', { p_tournament: tournamentId, p_teams: [] });
    expect(res.error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @tournament/web -- src/integration/signup.integration.test.ts`
Expected: FAIL — `Could not find the function public.sign_up_team`.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20260908120000_team_signup.sql
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

alter table public.tournaments
  add column signup_open boolean not null default true,
  add column join_code text check (join_code is null or length(join_code) between 3 and 30);

-- The public column grant is an explicit list, so the new column has to be added to it.
grant select (description) on public.teams to anon, authenticated;

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
  insert into public.teams (tournament_id, name, tagline, colour, description)
    values (tr.id, nm, coalesce(p_tagline, ''), p_colour, coalesce(p_description, ''))
    returning id, edit_token into team_id, tok;
  perform public.write_roster(team_id, p_mixed1, p_mixed2, p_woman);
  return tok;
end; $$;

grant execute on function public.sign_up_team(text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

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
  insert into public.teams (tournament_id, name) values (p_tournament, nm) returning id into team_id;
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
```

- [ ] **Step 5: Apply locally and run the integration tests**

```bash
npx supabase db reset
npm run seed:admin -w @tournament/web
npm test -w @tournament/web -- src/integration/signup.integration.test.ts
```

Expected: PASS. If `JWT issued at future` appears, run `docker restart $(docker ps --format '{{.Names}}' | grep supabase_auth)` and retry.

Then run the whole web suite: `npm test -w @tournament/web`. The `rls.integration.test.ts` suite still passes (it inserts a team without players, which is allowed). `npm run typecheck -w @tournament/web` will now fail in `actions/teams.ts` (`add_teams` still referenced) — that is fixed in Task 5; do not fix it here.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260908120000_team_signup.sql apps/web/src/integration/signup.integration.test.ts apps/web/src/lib/db/types.ts
git commit -m "feat(db): roster roles and genders, team sign-up function, join code"
```

---

### Task 4: Web roster helpers, queries and form parsing

**Files:**
- Create: `apps/web/src/lib/teams/roster.ts`, `apps/web/src/lib/teams/roster.test.ts`
- Modify: `apps/web/src/lib/db/queries.ts` (`listTeamsWithPlayers`, `TeamWithPlayers`, bundle)
- Modify: `apps/web/src/lib/participant/profile.ts`, `profile.test.ts` (description)
- Delete: `apps/web/src/lib/teams/parse.ts`, `apps/web/src/lib/teams/parse.test.ts`

**Interfaces:**
- Produces: `rosterOf(team)`, `pairNames(team, gameNo)`, `parseRosterForm(fd)`, `parseSignupForm(fd)`, `rosterErrorMessage(dbMessage)`, `ROSTER_FIELD_LABELS`.
- `TeamWithPlayers.players` becomes `RosterPlayerRow[]`.
- `parseProfileForm` returns `{ name, tagline, colour, description }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/teams/roster.test.ts
import { describe, it, expect } from 'vitest';
import { pairNames, parseRosterForm, parseSignupForm, rosterErrorMessage, rosterOf } from './roster';
import type { TeamWithPlayers } from '@/lib/db/queries';

const team: TeamWithPlayers = {
  id: 't1', tournament_id: 'x', name: 'Smashers', tagline: '', colour: '#2563eb', description: '', seed: null,
  pool_id: null, pool_order: 0, withdrawn: false, pool_rank_override: null,
  players: [
    { id: 'p1', tournament_id: 'x', name: 'Alex', gender: 'male', role: 'mixed1' },
    { id: 'p2', tournament_id: 'x', name: 'Ben', gender: 'male', role: 'mixed2' },
    { id: 'p3', tournament_id: 'x', name: 'Priya', gender: 'female', role: 'woman' },
  ],
};

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe('pairNames', () => {
  it('names the pair for each game number', () => {
    expect(pairNames(team, 1)).toBe('Alex & Priya');
    expect(pairNames(team, 2)).toBe('Ben & Priya');
    expect(pairNames(team, 3)).toBe('Alex & Ben');
  });
  it('is null for an incomplete roster', () => {
    expect(pairNames({ ...team, players: team.players.slice(0, 2) }, 1)).toBeNull();
  });
  it('rosterOf maps rows to the core shape', () => {
    expect(rosterOf(team)[0]).toEqual({ id: 'p1', name: 'Alex', gender: 'male', role: 'mixed1' });
  });
});

describe('parseRosterForm', () => {
  it('trims the three names', () => {
    expect(parseRosterForm(fd({ mixed1: ' Alex ', mixed2: 'Ben', woman: 'Priya' })))
      .toEqual({ ok: true, value: { mixed1: 'Alex', mixed2: 'Ben', woman: 'Priya' } });
  });
  it('requires every box', () => {
    const r = parseRosterForm(fd({ mixed1: 'Alex', mixed2: '', woman: 'Priya' }));
    expect(r).toEqual({ ok: false, problems: ['Man playing Mixed #2 is required'] });
  });
  it('caps names at 60 characters', () => {
    const r = parseRosterForm(fd({ mixed1: 'a'.repeat(61), mixed2: 'Ben', woman: 'Priya' }));
    expect(r).toEqual({ ok: false, problems: ['Man playing Mixed #1 must be at most 60 characters'] });
  });
});

describe('parseSignupForm', () => {
  it('combines profile, roster and join code', () => {
    const r = parseSignupForm(fd({ name: 'Smashers', tagline: '', colour: '#DC2626', description: 'hi', mixed1: 'Alex', mixed2: 'Ben', woman: 'Priya', joinCode: ' club ' }));
    expect(r).toEqual({ ok: true, value: { name: 'Smashers', tagline: '', colour: '#dc2626', description: 'hi', mixed1: 'Alex', mixed2: 'Ben', woman: 'Priya', joinCode: 'club' } });
  });
  it('reports profile and roster problems together', () => {
    const r = parseSignupForm(fd({ name: '', colour: '#dc2626', mixed1: 'Alex', mixed2: 'Ben', woman: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['name must be 1-40 characters', 'Woman is required']);
  });
});

describe('rosterErrorMessage', () => {
  it('maps the database codes to sentences', () => {
    expect(rosterErrorMessage('duplicate_name')).toBe('That team name is already taken in this tournament');
    expect(rosterErrorMessage('bad_join_code')).toBe('That join code is not right');
    expect(rosterErrorMessage('signup_closed')).toBe('Sign-ups are closed');
    expect(rosterErrorMessage('invalid_input')).toBe('Check the names and try again');
    expect(rosterErrorMessage('stale_state')).toBe('The draw is locked, so teams cannot change');
    expect(rosterErrorMessage('something else')).toBe('something else');
  });
});
```

Update `apps/web/src/lib/participant/profile.test.ts`: every expected `value` gains `description: ''` (or the given description), and add:

```ts
  it('caps the description at 400 characters', () => {
    const f = new FormData(); f.set('name', 'A'); f.set('colour', '#123456'); f.set('description', 'x'.repeat(401));
    expect(parseProfileForm(f)).toEqual({ ok: false, problems: ['description must be at most 400 characters'] });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @tournament/web -- src/lib/teams/roster.test.ts src/lib/participant/profile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/lib/participant/profile.ts`:

```ts
export interface ProfileInput { name: string; tagline: string; colour: string; description: string }

export function parseProfileForm(fd: FormData): { ok: true; value: ProfileInput } | { ok: false; problems: string[] } {
  const name = String(fd.get('name') ?? '').trim();
  const tagline = String(fd.get('tagline') ?? '').trim();
  const colour = String(fd.get('colour') ?? '').trim().toLowerCase();
  const description = String(fd.get('description') ?? '').trim();
  const problems: string[] = [];
  if (name.length < 1 || name.length > 40) problems.push('name must be 1-40 characters');
  if (tagline.length > 80) problems.push('tagline must be at most 80 characters');
  if (!/^#[0-9a-f]{6}$/.test(colour)) problems.push('colour must look like #1a2b3c');
  if (description.length > 400) problems.push('description must be at most 400 characters');
  return problems.length ? { ok: false, problems } : { ok: true, value: { name, tagline, colour, description } };
}
```

`apps/web/src/lib/teams/roster.ts`:

```ts
import { pairFor, pairSlotForGame, type RosterPlayer } from '@tournament/core';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { parseProfileForm, type ProfileInput } from '@/lib/participant/profile';

export interface RosterInput { mixed1: string; mixed2: string; woman: string }
export interface SignupInput extends ProfileInput, RosterInput { joinCode: string }

/** The three sign-up boxes, in form order. The box decides the player's gender and role. */
export const ROSTER_FIELD_LABELS: Record<keyof RosterInput, string> = {
  mixed1: 'Man playing Mixed #1', mixed2: 'Man playing Mixed #2', woman: 'Woman',
};

export function rosterOf(team: Pick<TeamWithPlayers, 'players'>): RosterPlayer[] {
  return team.players.map((p) => ({ id: p.id, name: p.name, gender: p.gender, role: p.role }));
}

/** "Alex & Priya" for the pair of `team` that plays game `gameNo`; null while the roster is incomplete. */
export function pairNames(team: Pick<TeamWithPlayers, 'players'>, gameNo: number): string | null {
  const pair = pairFor(rosterOf(team), pairSlotForGame(gameNo));
  return pair ? `${pair[0].name} & ${pair[1].name}` : null;
}

export function parseRosterForm(fd: FormData): { ok: true; value: RosterInput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const value = { mixed1: '', mixed2: '', woman: '' };
  for (const key of ['mixed1', 'mixed2', 'woman'] as const) {
    const v = String(fd.get(key) ?? '').trim();
    if (v.length === 0) problems.push(`${ROSTER_FIELD_LABELS[key]} is required`);
    else if (v.length > 60) problems.push(`${ROSTER_FIELD_LABELS[key]} must be at most 60 characters`);
    value[key] = v;
  }
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

export function parseSignupForm(fd: FormData): { ok: true; value: SignupInput } | { ok: false; problems: string[] } {
  const profile = parseProfileForm(fd);
  const roster = parseRosterForm(fd);
  const problems = [...(profile.ok ? [] : profile.problems), ...(roster.ok ? [] : roster.problems)];
  if (!profile.ok || !roster.ok) return { ok: false, problems };
  return { ok: true, value: { ...profile.value, ...roster.value, joinCode: String(fd.get('joinCode') ?? '').trim() } };
}

const MESSAGES: Record<string, string> = {
  duplicate_name: 'That team name is already taken in this tournament',
  bad_join_code: 'That join code is not right',
  signup_closed: 'Sign-ups are closed',
  invalid_input: 'Check the names and try again',
  stale_state: 'The draw is locked, so teams cannot change',
};

/** The sentence for a roster function's raised message; anything unknown is passed through. */
export function rosterErrorMessage(dbMessage: string): string {
  return MESSAGES[dbMessage] ?? dbMessage;
}
```

`apps/web/src/lib/db/queries.ts` — replace `TeamWithPlayers` and `listTeamsWithPlayers`, and make the bundle carry rosters:

```ts
import type { AnnouncementRow, GameRow, MatchRow, PoolRow, RosterPlayerRow, SubmissionRow, TeamRow, TournamentRow } from './types';

export interface TeamWithPlayers extends TeamRow {
  players: RosterPlayerRow[];
}

export async function listTeamsWithPlayers(sb: SupabaseClient, tournamentId: string): Promise<TeamWithPlayers[]> {
  const teams = await listTeams(sb, tournamentId);
  if (teams.length === 0) return [];
  const links = must(
    await sb.from('team_players').select('team_id, role, players(id, tournament_id, name, gender)').in('team_id', teams.map((t) => t.id)),
    'team_players',
  ) as unknown as Array<{ team_id: string; role: RosterPlayerRow['role']; players: Omit<RosterPlayerRow, 'role'> | null }>;
  const byTeam = new Map<string, RosterPlayerRow[]>();
  for (const l of links) if (l.players) (byTeam.get(l.team_id) ?? byTeam.set(l.team_id, []).get(l.team_id)!).push({ ...l.players, role: l.role });
  return teams.map((t) => ({ ...t, players: byTeam.get(t.id) ?? [] }));
}
```

In `TournamentBundle` change `teams: TeamRow[]` to `teams: TeamWithPlayers[]` and in `loadTournamentBundle` call `listTeamsWithPlayers(sb, tournament.id)` instead of `listTeams`. (Every consumer typed `TeamRow[]` still compiles because `TeamWithPlayers extends TeamRow`.)

Delete `apps/web/src/lib/teams/parse.ts` and `parse.test.ts`:

```bash
git rm apps/web/src/lib/teams/parse.ts apps/web/src/lib/teams/parse.test.ts
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @tournament/web -- src/lib` — Expected: PASS. (`typecheck` still fails in `actions/teams.ts` until Task 5.)

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/lib
git commit -m "feat(web): roster helpers, pair names and sign-up form parsing"
```

---

### Task 5: Team actions — sign-up, participant roster, organiser roster, lock guard

**Files:**
- Create: `apps/web/src/actions/signup.ts`
- Modify: `apps/web/src/actions/teams.ts`, `apps/web/src/actions/participant.ts`, `apps/web/src/actions/pools.ts`
- Modify: `apps/web/src/actions/errors.ts` (add `'rate_limited'`)

**Interfaces:**
- Produces: `signUpTeam(slug, formData): ActionResult<{ token: string }>`; `addTeam(slug, formData)`, `setRoster(slug, teamId, formData)`, `setSignupOpen(slug, open)`, `setJoinCode(slug, code)`; `updateMyRoster(slug, formData)`, `swapMixed(slug)`; `lockPools` refuses `incomplete_roster` and closes sign-ups.
- Removes: `addTeams`.

- [ ] **Step 1: Errors**

In `apps/web/src/actions/errors.ts` add `'rate_limited' | 'incomplete_roster'` to `ActionError`.

- [ ] **Step 2: Sign-up action**

```ts
// apps/web/src/actions/signup.ts
'use server';
import { headers } from 'next/headers';
import { createServerSupabase } from '@/lib/supabase/server';
import { clientKeyFrom } from '@/lib/participant/clientKey';
import { allow } from '@/lib/participant/rateLimit';
import { parseSignupForm, rosterErrorMessage } from '@/lib/teams/roster';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';

export const SIGNUP_LIMIT = 10;
export const SIGNUP_WINDOW_MS = 60_000;

/**
 * The public sign-up. Every check that matters (open, code, unique name, roster rule) is repeated
 * inside sign_up_team, which is the only function an anonymous caller can execute that writes.
 * The token comes back once; the caller turns it into the httpOnly cookie via the one-time link.
 */
export async function signUpTeam(slug: string, formData: FormData): Promise<ActionResult<{ token: string }>> {
  const key = `signup:${clientKeyFrom(await headers())}`;
  if (!allow(key, SIGNUP_LIMIT, SIGNUP_WINDOW_MS)) return fail('rate_limited', 'Too many attempts. Try again in a minute.');
  const parsed = parseSignupForm(formData);
  if (!parsed.ok) return fail('invalid_input', parsed.problems.join('; '));
  const v = parsed.value;
  const sb = await createServerSupabase();
  const res = await sb.rpc('sign_up_team', {
    p_slug: slug, p_join_code: v.joinCode === '' ? null : v.joinCode, p_name: v.name, p_tagline: v.tagline,
    p_colour: v.colour, p_description: v.description, p_mixed1: v.mixed1, p_mixed2: v.mixed2, p_woman: v.woman,
  });
  if (res.error) return fail('invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok({ token: String(res.data) });
}
```

- [ ] **Step 3: Organiser actions**

In `apps/web/src/actions/teams.ts` remove `addTeams` and the `parseTeamLines` import; add:

```ts
import { parseRosterForm, rosterErrorMessage } from '@/lib/teams/roster';

/** One team with its three players, written atomically by admin_add_team. */
export async function addTeam(slug: string, formData: FormData): Promise<ActionResult<{ teamId: string }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Teams can only be added during setup');
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 40) return fail('invalid_input', 'Team name must be 1-40 characters');
  const roster = parseRosterForm(formData);
  if (!roster.ok) return fail('invalid_input', roster.problems.join('; '));
  const res = await ctx.sb.rpc('admin_add_team', { p_tournament: ctx.tournament.id, p_name: name, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman });
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok({ teamId: String(res.data) });
}

/** Rewrites a team's three players (organiser). */
export async function setRoster(slug: string, teamId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Rosters are locked once the pools are');
  const roster = parseRosterForm(formData);
  if (!roster.ok) return fail('invalid_input', roster.problems.join('; '));
  const res = await ctx.sb.rpc('admin_set_roster', { p_team: teamId, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman });
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok(undefined);
}

export async function setSignupOpen(slug: string, open: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (open && ctx.tournament.status !== 'setup') return fail('stale_state', 'Sign-ups can only be open during setup');
  const upd = await ctx.sb.from('tournaments').update({ signup_open: open }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

/** Blank clears the code. */
export async function setJoinCode(slug: string, code: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const trimmed = code.trim();
  if (trimmed !== '' && (trimmed.length < 3 || trimmed.length > 30)) return fail('invalid_input', 'Join code must be 3-30 characters, or blank for none');
  const upd = await ctx.sb.from('tournaments').update({ join_code: trimmed === '' ? null : trimmed }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}
```

- [ ] **Step 4: Participant actions**

In `apps/web/src/actions/participant.ts` add (the service client is already imported):

```ts
import { parseRosterForm, rosterErrorMessage, rosterOf } from '@/lib/teams/roster';
import { listTeamsWithPlayers } from '@/lib/db/queries';

/** A team edits its own three players until the pools lock. */
export async function updateMyRoster(slug: string, formData: FormData): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  if (me.tournament.status !== 'setup') return fail('stale_state', 'The draw is locked, so players cannot change. Ask the organiser if someone is injured.');
  const roster = parseRosterForm(formData);
  if (!roster.ok) return fail('invalid_input', roster.problems.join('; '));
  const sb = createServiceSupabase();
  const res = await sb.rpc('write_roster', { p_team: me.team.id, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman });
  if (res.error) return fail('invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok(undefined);
}

/** Swaps which man plays Mixed #1; the men's doubles pair is unchanged. */
export async function swapMixed(slug: string): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  if (me.tournament.status !== 'setup') return fail('stale_state', 'The draw is locked, so players cannot change. Ask the organiser if someone is injured.');
  const sb = createServiceSupabase();
  const team = (await listTeamsWithPlayers(sb, me.tournament.id)).find((t) => t.id === me.team.id);
  const players = team ? rosterOf(team) : [];
  const by = (role: 'mixed1' | 'mixed2' | 'woman') => players.find((p) => p.role === role)?.name;
  if (!by('mixed1') || !by('mixed2') || !by('woman')) return fail('invalid_input', 'Fill in all three players first');
  const res = await sb.rpc('write_roster', { p_team: me.team.id, p_mixed1: by('mixed2'), p_mixed2: by('mixed1'), p_woman: by('woman') });
  if (res.error) return fail('invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok(undefined);
}
```

`updateMyTeam` already writes `parsed.value`, which now includes `description`; nothing else to change there.

- [ ] **Step 5: lockPools guard**

In `apps/web/src/actions/pools.ts`:

```ts
import { validateRoster } from '@tournament/core';
import { listMatches, listPools, listTeams, listTeamsWithPlayers } from '@/lib/db/queries';
import { rosterOf } from '@/lib/teams/roster';
```

In `lockPools`, replace `listTeams(ctx.sb, ctx.tournament.id)` with `listTeamsWithPlayers(ctx.sb, ctx.tournament.id)` and, right after the `fewerThanAdvance` check, add:

```ts
  // Every meeting names the pair on court, so a team without its three players cannot be drawn.
  const incomplete = teams.filter((t) => !t.withdrawn && !validateRoster(rosterOf(t)).ok).map((t) => t.name);
  if (incomplete.length) return fail('incomplete_roster', `These teams do not have two men and one woman yet: ${incomplete.join(', ')}`);
```

Change the claim update to also close sign-ups:

```ts
  const claim = await ctx.sb.from('tournaments').update({ status: 'pools', signup_open: false })
```

- [ ] **Step 6: Typecheck and unit tests**

Run: `npm run typecheck -w @tournament/web`
Expected: errors only in `components/TeamsAdmin.tsx` (imports `addTeams`) — that file is rewritten in Task 7. To keep the tree compiling for this task's commit, replace the `addTeams` import and the `add` handler in `TeamsAdmin.tsx` with a temporary form that posts to `addTeam` using four inputs `name`, `mixed1`, `mixed2`, `woman` (any layout). Then typecheck must be clean.

Run: `npm test -w @tournament/web` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/actions apps/web/src/components/TeamsAdmin.tsx
git commit -m "feat(web): sign-up, roster and join-code actions; lock refuses incomplete rosters"
```

---

### Task 6: Join page, welcome banner and participant roster editing

**Files:**
- Create: `apps/web/src/components/ui.ts`, `RosterFields.tsx`, `JoinForm.tsx`, `CopyButton.tsx`
- Create: `apps/web/src/app/t/[slug]/join/page.tsx`
- Modify: `apps/web/src/app/t/[slug]/team/[token]/route.ts`, `team/page.tsx`, `layout.tsx`

**Interfaces:**
- Consumes: `signUpTeam`, `updateMyRoster`, `swapMixed`, `parseSignupForm` labels, `currentParticipant`, `cookieName`.
- Produces: `ui` class constants used by every later page: `ui.label`, `ui.help`, `ui.field`, `ui.primary`, `ui.secondary`, `ui.danger`, `ui.card`.

- [ ] **Step 1: Shared class strings**

```ts
// apps/web/src/components/ui.ts
/** One place for the organiser-friendly sizes: big labels, 44px inputs, one dark button per form. */
export const ui = {
  card: 'rounded-xl border bg-white p-5 md:p-6',
  h2: 'text-lg font-semibold',
  label: 'block text-base font-medium text-slate-800',
  help: 'mt-1 text-sm text-slate-600',
  field: 'mt-1 w-full rounded-lg border p-3 text-base',
  primary: 'rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white hover:bg-slate-700',
  secondary: 'rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50',
  danger: 'rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50',
  pillDone: 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800',
  pillTodo: 'rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800',
  pillLocked: 'rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700',
} as const;
```

- [ ] **Step 2: Roster fields and copy button**

```tsx
// apps/web/src/components/RosterFields.tsx
import { ROSTER_FIELD_LABELS } from '@/lib/teams/roster';
import { ui } from './ui';

/** The three player boxes. The box a name goes in decides the player's gender and role. */
export function RosterFields({ defaults, disabled = false }: {
  defaults?: { mixed1?: string; mixed2?: string; woman?: string };
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(['mixed1', 'mixed2', 'woman'] as const).map((key) => (
        <label key={key} className={ui.label}>{ROSTER_FIELD_LABELS[key]}
          <input name={key} required maxLength={60} defaultValue={defaults?.[key] ?? ''} disabled={disabled} className={ui.field} />
        </label>
      ))}
      <p className={`${ui.help} md:col-span-3`}>Your woman plays both mixed games. Your two men play the men&apos;s doubles together.</p>
    </div>
  );
}
```

```tsx
// apps/web/src/components/CopyButton.tsx
'use client';
import { useState } from 'react';

export function CopyButton({ text, className, label = 'Copy' }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt('Copy this link', text); }
      }}
    >{done ? 'Copied' : label}</button>
  );
}
```

- [ ] **Step 3: Join form (client) and page**

```tsx
// apps/web/src/components/JoinForm.tsx
'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/actions/errors';
import { RosterFields } from './RosterFields';
import { ui } from './ui';

/**
 * Calls the sign-up action itself so a rejected attempt keeps everything typed, then does a full
 * navigation to the one-time link: that route sets the httpOnly team cookie and lands on the team
 * page, which a client-side push could not do.
 */
export function JoinForm({ slug, needsCode, action }: {
  slug: string; needsCode: boolean;
  action: (formData: FormData) => Promise<ActionResult<{ token: string }>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await action(fd);
          if (!r.ok) { setError(r.message ?? r.error); return; }
          window.location.assign(`/t/${slug}/team/${r.data.token}?welcome=1`);
        });
      }}
    >
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <label className={ui.label}>Team name<input name="name" required maxLength={40} className={ui.field} /></label>
        <label className={ui.label}>Tagline <span className="font-normal text-slate-500">(optional)</span><input name="tagline" maxLength={80} className={ui.field} /></label>
        <label className={ui.label}>Team colour<input name="colour" type="color" defaultValue="#2563eb" className="mt-1 h-12 w-full rounded-lg border" /></label>
        <label className={`${ui.label} md:col-span-2`}>About your team <span className="font-normal text-slate-500">(optional)</span>
          <textarea name="description" maxLength={400} rows={2} className={ui.field} />
        </label>
      </div>
      <RosterFields />
      {needsCode && (
        <label className={ui.label}>Join code<input name="joinCode" required className={ui.field} />
          <span className={ui.help}>The organiser gave this to club members.</span>
        </label>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${ui.primary} disabled:opacity-60`}>
        {pending ? 'Signing up…' : 'Sign our team up'}
      </button>
    </form>
  );
}
```

```tsx
// apps/web/src/app/t/[slug]/join/page.tsx
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';
import { signUpTeam } from '@/actions/signup';
import { JoinForm } from '@/components/JoinForm';
import { ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  const open = t.status === 'setup' && t.signup_open;
  return (
    <section className={ui.card}>
      <h2 className="text-2xl font-bold">Sign your team up</h2>
      {open ? (
        <>
          <p className={`${ui.help} mb-6`}>One person signs the whole team up: a team name and your three players. You get a private team link at the end.</p>
          <JoinForm slug={slug} needsCode={t.join_code !== null} action={signUpTeam.bind(null, slug)} />
        </>
      ) : (
        <p className="mt-2 text-base">Sign-ups are closed. Ask the organiser to add your team.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: One-time link forwards the welcome flag**

In `apps/web/src/app/t/[slug]/team/[token]/route.ts` change the redirect line to keep the query string:

```ts
  const res = NextResponse.redirect(new URL(`/t/${slug}/team${req.nextUrl.search}`, req.url), 303);
```

- [ ] **Step 5: Team page — welcome banner, description, roster editing, swap, lock**

Rewrite the profile `<section>` of `apps/web/src/app/t/[slug]/team/page.tsx` (keep everything from "Your next match" down unchanged) and add the imports:

```tsx
import { cookies } from 'next/headers';
import { cookieName } from '@/lib/participant/token';
import { updateMyTeam, updateMyRoster, swapMixed, submitScoresForm } from '@/actions/participant';
import { listTeamsWithPlayers } from '@/lib/db/queries';   // replaces listTeams in the Promise.all
import { CopyButton } from '@/components/CopyButton';
import { RosterFields } from '@/components/RosterFields';
import { ui } from '@/components/ui';
```

The page signature gains `searchParams: Promise<{ welcome?: string }>`; read `const { welcome } = await searchParams;`. Build the private link from the cookie:

```tsx
  const hdrs = await headers();   // import { headers } from 'next/headers'
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? 'localhost:3000';
  const token = (await cookies()).get(cookieName(slug))?.value ?? '';
  const privateLink = `${host.startsWith('localhost') ? 'http' : 'https'}://${host}/t/${slug}/team/${token}`;
  const myTeam = teams.find((x) => x.id === me.team.id)!;   // teams is now TeamWithPlayers[]
  const byRole = (r: 'mixed1' | 'mixed2' | 'woman') => myTeam.players.find((p) => p.role === r)?.name ?? '';
  const rosterLocked = me.tournament.status !== 'setup';

  async function saveRoster(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyRoster(slug, formData), 'Players saved');
  }
  async function swap() {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await swapMixed(slug), 'Mixed pairs swapped');
  }
```

Render, in place of the old profile section:

```tsx
      {welcome === '1' && (
        <div data-testid="welcome" className="rounded-xl border border-emerald-400 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold">You&apos;re in. Save this private link, it is the only way back to your team page:</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{privateLink}</code>
            <CopyButton text={privateLink} className={ui.secondary} />
          </div>
        </div>
      )}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-4 flex items-center gap-2`}><span className="inline-block h-4 w-4 rounded-full" style={{ background: me.team.colour }} />{me.team.name}</h2>
        <form action={save} className="grid gap-4 md:grid-cols-2">
          <label className={ui.label}>Team name<input name="name" defaultValue={me.team.name} maxLength={40} required className={ui.field} /></label>
          <label className={ui.label}>Tagline<input name="tagline" defaultValue={me.team.tagline} maxLength={80} className={ui.field} /></label>
          <label className={ui.label}>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="mt-1 h-12 w-full rounded-lg border" /></label>
          <label className={`${ui.label} md:col-span-2`}>About your team<textarea name="description" defaultValue={me.team.description} maxLength={400} rows={2} className={ui.field} /></label>
          <div className="md:col-span-2"><SubmitButton className={ui.primary}>Save team</SubmitButton></div>
        </form>
      </section>
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-1`}>Players</h2>
        {rosterLocked ? (
          <>
            <p className={ui.help}>The draw is locked, so players can&apos;t change. Ask the organiser if someone is injured.</p>
            <ul className="mt-3 space-y-1 text-base">
              <li><span className="text-slate-500">Mixed #1:</span> {byRole('mixed1')} &amp; {byRole('woman')}</li>
              <li><span className="text-slate-500">Mixed #2:</span> {byRole('mixed2')} &amp; {byRole('woman')}</li>
              <li><span className="text-slate-500">Men&apos;s doubles:</span> {byRole('mixed1')} &amp; {byRole('mixed2')}</li>
            </ul>
          </>
        ) : (
          <>
            <form action={saveRoster} className="space-y-4">
              <RosterFields defaults={{ mixed1: byRole('mixed1'), mixed2: byRole('mixed2'), woman: byRole('woman') }} />
              <SubmitButton className={ui.primary}>Save players</SubmitButton>
            </form>
            <form action={swap} className="mt-3">
              <SubmitButton className={ui.secondary}>Swap which man plays Mixed #1</SubmitButton>
            </form>
          </>
        )}
      </section>
```

Note `privateLink` and the private link `<code>` are only rendered for the team that holds the cookie; the token never appears on a page a different visitor can load.

- [ ] **Step 6: Public nav gets Join while sign-ups are open**

In `apps/web/src/app/t/[slug]/layout.tsx` after the `tabs` array is built:

```tsx
  if (t.status === 'setup' && t.signup_open && !me) tabs.push(['/join', 'Join']);
```

- [ ] **Step 7: Verify by hand and typecheck**

Run: `npm run typecheck -w @tournament/web` — Expected: clean.
Run `npm run dev -w @tournament/web`, sign in, create a tournament `demo`, open `http://localhost:3000/t/demo/join` in a private window, sign a team up, confirm the welcome banner and link, edit players, swap, and check the organiser sees the team. Record what you saw in the report.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ui.ts apps/web/src/components/RosterFields.tsx apps/web/src/components/JoinForm.tsx apps/web/src/components/CopyButton.tsx "apps/web/src/app/t/[slug]/join" "apps/web/src/app/t/[slug]/team" "apps/web/src/app/t/[slug]/layout.tsx"
git commit -m "feat(web): public team sign-up page, welcome link, participant roster editing"
```

---

### Task 7: Organiser Teams page

**Files:**
- Create: `apps/web/src/app/admin/[slug]/teams/page.tsx`
- Modify (rewrite): `apps/web/src/components/TeamsAdmin.tsx`
- Modify: `apps/web/src/app/admin/[slug]/page.tsx` (remove `<TeamsAdmin>` from the setup page for now; Task 8 replaces the page entirely)

**Interfaces:**
- Consumes: `addTeam`, `setRoster`, `setSignupOpen`, `setJoinCode`, `deleteTeam`, `regenerateToken`, `withdrawTeam`, `reinstateTeam`, `setSeed`, `getEditTokens`, `listTeamsWithPlayers`, `validateRoster`, `rosterOf`, `ui`, `CopyButton`, `RosterFields`.

- [ ] **Step 1: Page**

```tsx
// apps/web/src/app/admin/[slug]/teams/page.tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireAdmin } from '@/actions/guard';
import { getEditTokens } from '@/actions/teams';
import { listTeamsWithPlayers } from '@/lib/db/queries';
import { TeamsAdmin } from '@/components/TeamsAdmin';
import { FlashMessage } from '@/components/FlashMessage';

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [teams, tokens, hdrs] = await Promise.all([listTeamsWithPlayers(ctx.sb, t.id), getEditTokens(slug), headers()]);
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? 'localhost:3000';
  const baseUrl = `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
  return (
    <div className="space-y-6">
      <FlashMessage />
      <TeamsAdmin slug={slug} tournament={t} teams={teams} tokens={tokens} baseUrl={baseUrl} />
    </div>
  );
}
```

- [ ] **Step 2: TeamsAdmin rewrite**

```tsx
// apps/web/src/components/TeamsAdmin.tsx
import { validateRoster } from '@tournament/core';
import { addTeam, deleteTeam, regenerateToken, reinstateTeam, setJoinCode, setRoster, setSeed, setSignupOpen, withdrawTeam } from '@/actions/teams';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import type { TeamWithPlayers } from '@/lib/db/queries';
import type { TournamentRow } from '@/lib/db/types';
import { rosterOf } from '@/lib/teams/roster';
import { CopyButton } from './CopyButton';
import { RosterFields } from './RosterFields';
import { SubmitButton } from './SubmitButton';
import { ui } from './ui';

export function TeamsAdmin({ slug, tournament: t, teams, tokens, baseUrl }: {
  slug: string; tournament: TournamentRow; teams: TeamWithPlayers[]; tokens: Record<string, string>; baseUrl: string;
}) {
  const here = `/admin/${slug}/teams`;
  const locked = t.status !== 'setup';
  const complete = teams.filter((x) => validateRoster(rosterOf(x)).ok);
  const joinLink = `${baseUrl}/t/${slug}/join`;

  async function add(fd: FormData) { 'use server'; redirectWithMsg(here, await addTeam(slug, fd), 'Team added'); }
  async function roster(fd: FormData) { 'use server'; redirectWithMsg(here, await setRoster(slug, String(fd.get('teamId')), fd), 'Players saved'); }
  async function seed(fd: FormData) {
    'use server';
    const raw = String(fd.get('seed') ?? '').trim();
    redirectWithMsg(here, await setSeed(slug, String(fd.get('teamId')), raw === '' ? null : Number(raw)), 'Seed saved');
  }
  async function remove(fd: FormData) { 'use server'; redirectWithMsg(here, await deleteTeam(slug, String(fd.get('teamId'))), 'Team removed'); }
  async function withdraw(fd: FormData) { 'use server'; redirectWithMsg(here, await withdrawTeam(slug, String(fd.get('teamId'))), 'Team withdrawn'); }
  async function reinstate(fd: FormData) { 'use server'; redirectWithMsg(here, await reinstateTeam(slug, String(fd.get('teamId'))), 'Team reinstated'); }
  async function regen(fd: FormData) { 'use server'; redirectWithMsg(here, await regenerateToken(slug, String(fd.get('teamId'))), 'New link generated'); }
  async function toggleSignup(fd: FormData) { 'use server'; redirectWithMsg(here, await setSignupOpen(slug, fd.get('open') === '1'), fd.get('open') === '1' ? 'Sign-ups opened' : 'Sign-ups closed'); }
  async function code(fd: FormData) { 'use server'; redirectWithMsg(here, await setJoinCode(slug, String(fd.get('joinCode') ?? '')), 'Join code saved'); }

  const byRole = (x: TeamWithPlayers, r: 'mixed1' | 'mixed2' | 'woman') => x.players.find((p) => p.role === r)?.name ?? '';

  return (
    <>
      <section className={ui.card}>
        <h2 className={ui.h2}>Sign-ups</h2>
        <p className={ui.help}>{teams.length} team{teams.length === 1 ? '' : 's'} signed up, {complete.length} complete roster{complete.length === 1 ? '' : 's'}. Sign-ups are <b>{t.signup_open && !locked ? 'open' : 'closed'}</b>.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{joinLink}</code>
          <CopyButton text={joinLink} className={ui.secondary} label="Copy sign-up link" />
          {!locked && (
            <form action={toggleSignup}>
              <input type="hidden" name="open" value={t.signup_open ? '0' : '1'} />
              <SubmitButton className={ui.secondary}>{t.signup_open ? 'Close sign-ups' : 'Open sign-ups'}</SubmitButton>
            </form>
          )}
        </div>
        <form action={code} className="mt-4 flex flex-wrap items-end gap-2">
          <label className={ui.label}>Join code <span className="font-normal text-slate-500">(optional)</span>
            <input name="joinCode" defaultValue={t.join_code ?? ''} maxLength={30} placeholder="blank = anyone with the link" className={ui.field} />
          </label>
          <SubmitButton className={ui.secondary}>Save code</SubmitButton>
        </form>
      </section>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Teams ({teams.length})</h2>
        {teams.length === 0 && <p className={ui.help}>No teams yet. Share the sign-up link or add one below.</p>}
        <ul className="divide-y">
          {teams.map((x) => {
            const ok = validateRoster(rosterOf(x)).ok;
            return (
              <li key={x.id} data-testid="team-row" className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-base">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: x.colour }} />
                    <span className={`font-medium ${x.withdrawn ? 'text-slate-400 line-through' : ''}`}>{x.name}</span>
                    {x.tagline && <span className="text-sm text-slate-500">{x.tagline}</span>}
                    {!ok && <span className={ui.pillTodo}>Incomplete roster</span>}
                    {x.withdrawn && <span className={ui.pillLocked}>Withdrawn</span>}
                    <span className="ml-auto text-xs text-slate-500">▾ details</span>
                  </summary>
                  <div className="mt-3 space-y-4 pl-5">
                    <form action={roster} className="space-y-3">
                      <input type="hidden" name="teamId" value={x.id} />
                      <RosterFields defaults={{ mixed1: byRole(x, 'mixed1'), mixed2: byRole(x, 'mixed2'), woman: byRole(x, 'woman') }} disabled={locked} />
                      {!locked && <SubmitButton className={ui.secondary}>Save players</SubmitButton>}
                    </form>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <form action={seed} className="flex items-center gap-1">
                        <input type="hidden" name="teamId" value={x.id} />
                        <label className="text-slate-600">Seed label<input name="seed" type="number" min={1} max={64} defaultValue={x.seed ?? ''} className="ml-1 w-16 rounded border p-1" /></label>
                        <SubmitButton className={ui.secondary}>Set</SubmitButton>
                      </form>
                      {tokens[x.id] && (
                        <>
                          <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{baseUrl}/t/{slug}/team/{tokens[x.id]}</code>
                          <CopyButton text={`${baseUrl}/t/${slug}/team/${tokens[x.id]}`} className={ui.secondary} label="Copy link" />
                          <form action={regen}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage="Generate a new private link? The old one stops working." className={ui.secondary}>Regenerate link</SubmitButton></form>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {x.withdrawn ? (
                        <form action={reinstate}><input type="hidden" name="teamId" value={x.id} /><SubmitButton className={ui.secondary}>Reinstate</SubmitButton></form>
                      ) : (
                        <form action={withdraw}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage={`Withdraw ${x.name}? Their open matches are forfeited to the opponent.`} className={ui.danger}>Withdraw</SubmitButton></form>
                      )}
                      {!locked && (
                        <form action={remove}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage={`Remove ${x.name} and their players? This cannot be undone.`} className={ui.danger}>Remove team</SubmitButton></form>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      {!locked && (
        <section className={ui.card}>
          <h2 className={ui.h2}>Add a team yourself</h2>
          <p className={ui.help}>For a team that could not use the sign-up link.</p>
          <form action={add} className="mt-4 space-y-4">
            <label className={ui.label}>Team name<input name="name" required maxLength={40} className={ui.field} /></label>
            <RosterFields />
            <SubmitButton className={ui.primary}>Add team</SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 3: Detach from the old setup page**

In `apps/web/src/app/admin/[slug]/page.tsx` remove the `TeamsAdmin` import, the `getEditTokens` / `listTeamsWithPlayers` / `headers` usage and the `<TeamsAdmin … />` line, and add a link `<a href={`/admin/${slug}/teams`} className={ui.secondary}>Manage teams</a>` under the form. (Task 8 replaces this page.)

- [ ] **Step 4: Typecheck, then check by hand**

Run: `npm run typecheck -w @tournament/web` — Expected: clean.
In the browser: `/admin/demo/teams` lists the signed-up team with the caret, shows "Incomplete roster" for a team inserted without players (create one through the old RLS test path if needed, or skip), edits players, adds a team, copies the link, closes and reopens sign-ups, saves a join code, and `/t/demo/join` then demands the code.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/admin/[slug]/teams" apps/web/src/components/TeamsAdmin.tsx "apps/web/src/app/admin/[slug]/page.tsx"
git commit -m "feat(web): organiser Teams page with rosters, sign-up link and join code"
```

---

### Task 8: Admin shell, hub, Event and Rules pages, route renames

**Files:**
- Create: `apps/web/src/lib/admin/hub.ts`, `hub.test.ts`
- Create: `apps/web/src/app/admin/[slug]/event/page.tsx`, `rules/page.tsx`
- Move: `apps/web/src/app/admin/[slug]/pools/page.tsx` → `standings/page.tsx`; `bracket/page.tsx` → `draw/page.tsx`
- Rewrite: `apps/web/src/app/admin/[slug]/pools/page.tsx`, `bracket/page.tsx` as redirects
- Rewrite: `apps/web/src/app/admin/[slug]/page.tsx` (hub), `layout.tsx`
- Modify: `apps/web/src/actions/tournaments.ts` (`updateEvent`), `apps/web/src/actions/revalidate.ts`, `apps/web/src/app/admin/[slug]/matches/page.tsx` (bracket link), `apps/web/src/components/Bracket.tsx` if it links to `/admin/[slug]/bracket` (grep)

**Interfaces:**
- Produces: `hubTiles(input): HubTile[]`, `statusLine(input): string`, `updateEvent(slug, formData)`.

- [ ] **Step 1: Failing tests for the pure hub logic**

```ts
// apps/web/src/lib/admin/hub.test.ts
import { describe, it, expect } from 'vitest';
import { hubTiles, statusLine, type HubInput } from './hub';

const base: HubInput = {
  status: 'setup', startsAt: '2026-09-12T08:30:00.000Z', venue: 'Main Hall',
  rules: '3 games to 15 · 13 min clock · 4 courts · top 2 per pool',
  teamCount: 6, completeCount: 6, signupOpen: true, poolCount: 0, meetingCount: 0, liveCount: 0, championName: null,
};

describe('hubTiles', () => {
  it('lists the four tiles in order with their states during setup', () => {
    const tiles = hubTiles(base);
    expect(tiles.map((t) => t.title)).toEqual(['1. Event details', '2. Rules', '3. Teams', '4. Pools and draw']);
    expect(tiles.map((t) => t.pill)).toEqual(['Done', 'Done', 'Done', 'To do']);
    expect(tiles[2]!.summary).toBe('6 signed up · 6 complete · sign-ups open');
    expect(tiles[3]!.summary).toBe('Not drawn');
  });
  it('event is To do until date and venue are both set', () => {
    expect(hubTiles({ ...base, venue: null })[0]!.pill).toBe('To do');
    expect(hubTiles({ ...base, venue: null })[0]!.summary).toBe('Not set');
  });
  it('teams is To do with fewer than 4 or an incomplete roster', () => {
    expect(hubTiles({ ...base, teamCount: 3, completeCount: 3 })[2]!.pill).toBe('To do');
    expect(hubTiles({ ...base, completeCount: 5 })[2]!.pill).toBe('To do');
  });
  it('rules and draw show Locked / Done once the pools are locked', () => {
    const tiles = hubTiles({ ...base, status: 'pools', signupOpen: false, poolCount: 2, meetingCount: 12 });
    expect(tiles[1]!.pill).toBe('Locked');
    expect(tiles[3]!.pill).toBe('Done');
    expect(tiles[3]!.summary).toBe('2 pools, 12 meetings');
  });
  it('draw says the knockout has started', () => {
    expect(hubTiles({ ...base, status: 'knockout', poolCount: 2, meetingCount: 15 })[3]!.summary).toBe('Knockout started');
  });
});

describe('statusLine', () => {
  it('describes each stage', () => {
    expect(statusLine(base)).toBe('Setup · 6 teams signed up');
    expect(statusLine({ ...base, status: 'pools', liveCount: 3 })).toBe('Pool stage · 3 games on court');
    expect(statusLine({ ...base, status: 'knockout', liveCount: 0 })).toBe('Knockout · no game on court');
    expect(statusLine({ ...base, status: 'finished', championName: 'Smashers' })).toBe('Finished · Champion: Smashers');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w @tournament/web -- src/lib/admin` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/admin/hub.ts
import type { TournamentStatus } from '@/lib/db/types';

export interface HubInput {
  status: TournamentStatus;
  startsAt: string | null;
  venue: string | null;
  /** Pre-rendered rules summary, e.g. "3 games to 15 · 13 min clock · 4 courts · top 2 per pool". */
  rules: string;
  teamCount: number;
  completeCount: number;
  signupOpen: boolean;
  poolCount: number;
  meetingCount: number;
  liveCount: number;
  championName: string | null;
}

export type Pill = 'Done' | 'To do' | 'Locked';
export interface HubTile { key: 'event' | 'rules' | 'teams' | 'draw'; title: string; summary: string; pill: Pill; href: string }

/** The four checklist tiles of the organiser's home page. `href` is relative to /admin/[slug]. */
export function hubTiles(i: HubInput): HubTile[] {
  const locked = i.status !== 'setup';
  const eventDone = i.startsAt !== null && i.venue !== null && i.venue !== '';
  const teamsDone = i.teamCount >= 4 && i.completeCount === i.teamCount;
  return [
    { key: 'event', title: '1. Event details', href: '/event', summary: eventDone ? 'date and venue set' : 'Not set', pill: eventDone ? 'Done' : 'To do' },
    { key: 'rules', title: '2. Rules', href: '/rules', summary: i.rules, pill: locked ? 'Locked' : 'Done' },
    { key: 'teams', title: '3. Teams', href: '/teams', summary: `${i.teamCount} signed up · ${i.completeCount} complete · sign-ups ${i.signupOpen && !locked ? 'open' : 'closed'}`, pill: teamsDone ? 'Done' : 'To do' },
    {
      key: 'draw', title: '4. Pools and draw', href: '/standings',
      summary: i.status === 'setup' ? 'Not drawn' : i.status === 'pools' ? `${i.poolCount} pools, ${i.meetingCount} meetings` : 'Knockout started',
      pill: locked ? 'Done' : 'To do',
    },
  ];
}

export function statusLine(i: HubInput): string {
  const onCourt = i.liveCount === 0 ? 'no game on court' : `${i.liveCount} game${i.liveCount === 1 ? '' : 's'} on court`;
  switch (i.status) {
    case 'setup': return `Setup · ${i.teamCount} team${i.teamCount === 1 ? '' : 's'} signed up`;
    case 'pools': return `Pool stage · ${onCourt}`;
    case 'knockout': return `Knockout · ${onCourt}`;
    case 'finished': return `Finished · Champion: ${i.championName ?? 'TBD'}`;
  }
}
```

The event summary in the first test expects `'Not set'` only when incomplete; when done the test does not check the text, so `'date and venue set'` is fine (the page itself renders the real date with `LocalDateTime`).

- [ ] **Step 4: `updateEvent` action**

Add to `apps/web/src/actions/tournaments.ts`:

```ts
/** Date and venue only; editable at every stage. */
export async function updateEvent(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const rawStart = String(formData.get('startsAt') ?? '').trim();
  if (rawStart !== '' && Number.isNaN(Date.parse(rawStart))) return fail('invalid_input', 'Start date/time is not valid');
  const venue = String(formData.get('venue') ?? '').trim();
  if (venue.length > 120) return fail('invalid_input', 'Venue must be at most 120 characters');
  const upd = await ctx.sb.from('tournaments').update({ starts_at: rawStart === '' ? null : new Date(rawStart).toISOString(), venue: venue === '' ? null : venue }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/t/${slug}`);
  return ok(undefined);
}
```

- [ ] **Step 5: Event and Rules pages**

```tsx
// apps/web/src/app/admin/[slug]/event/page.tsx
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { updateEvent } from '@/actions/tournaments';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { FlashMessage } from '@/components/FlashMessage';
import { LocalDateTimeInput } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  async function save(fd: FormData) { 'use server'; redirectWithMsg(`/admin/${slug}/event`, await updateEvent(slug, fd), 'Event details saved'); }
  return (
    <section className={ui.card}>
      <FlashMessage />
      <h2 className="text-2xl font-bold">Event details</h2>
      <p className={`${ui.help} mb-6`}>Shown under the tournament name on every public page. You can change these at any time.</p>
      <form action={save} className="max-w-xl space-y-5">
        <label className={ui.label}>Date and time<LocalDateTimeInput name="startsAt" defaultIso={t.starts_at} className={ui.field} /><span className={ui.help}>In your own timezone.</span></label>
        <label className={ui.label}>Venue<input name="venue" maxLength={120} defaultValue={t.venue ?? ''} className={ui.field} /><span className={ui.help}>Hall or club name, as players know it.</span></label>
        <SubmitButton className={ui.primary}>Save event details</SubmitButton>
      </form>
    </section>
  );
}
```

`apps/web/src/app/admin/[slug]/rules/page.tsx` is the current `apps/web/src/app/admin/[slug]/page.tsx` with these changes: the `Event` fieldset is removed; the form still needs `startsAt` / `venue` for `parseSettingsForm`, so add two hidden mirrors `<input type="hidden" name="startsAt" value={t.starts_at ?? ''} />` and `<input type="hidden" name="venue" value={t.venue ?? ''} />`; the `save` handler redirects to `/admin/${slug}/rules?msg=…`; headings use `ui.card`, `ui.label`, `ui.field`, `ui.help`; the page title is `<h2 className="text-2xl font-bold">Rules</h2>` with helper text "Locked once the pools are drawn."; each **Game names** input gets helper text `Played by: {PAIR_SLOT_LABEL[pairSlotForGame(n)]}` (import both from `@tournament/core`); each `<fieldset>` becomes `className="space-y-4 rounded-lg border p-4"` with a `legend` of `px-1 text-base font-semibold`; the submit button is `<SubmitButton className={ui.primary}>Save rules</SubmitButton>` (locked: the whole form is read-only and the button is omitted, since date and venue moved to Event).

- [ ] **Step 6: Move Standings and Draw, add redirects**

```bash
git mv "apps/web/src/app/admin/[slug]/pools/page.tsx" "apps/web/src/app/admin/[slug]/standings/page.tsx"
git mv "apps/web/src/app/admin/[slug]/bracket/page.tsx" "apps/web/src/app/admin/[slug]/draw/page.tsx"
```

In the moved standings page: `const here = `/admin/${slug}/standings`;`, and **remove** the lock / unlock forms at the bottom (they move to the hub). Keep the generate / move UI. Append the overall leaderboard under the pool grid:

```tsx
import { overallLeaderboard } from '@tournament/core';
// after the grid of pools, only once pools exist and are locked:
{!editable && pools.length > 0 && (() => {
  const table = overallLeaderboard(
    pools.map((p) => ({ poolName: p.name, rows: computePool({ pool: p, teams, matches, games, advancePerPool: t.advance_per_pool }).rows })),
    teams.filter((x) => x.withdrawn).map((x) => x.id),
  );
  return (
    <section className={ui.card} data-testid="leaderboard">
      <h2 className={`${ui.h2} mb-2`}>Overall points</h2>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Rank</th><th>Team</th><th>Pool</th><th className="text-right">P</th><th className="text-right">W</th><th className="text-right">Pts</th><th className="text-right">±</th></tr></thead>
        <tbody>{table.map((r) => (
          <tr key={r.teamId} className="border-t"><td className="py-1 text-slate-500">{r.overallRank}</td><td>{r.name}</td><td className="text-slate-500">{r.poolName}</td><td className="text-right">{r.played}</td><td className="text-right">{r.won}</td><td className="text-right font-semibold">{r.points}</td><td className="text-right font-mono">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
})()}
```

In the moved draw page: `const here = `/admin/${slug}/draw`;` and the `start` redirect uses `here`.

Redirect stubs:

```tsx
// apps/web/src/app/admin/[slug]/pools/page.tsx
import { redirect } from 'next/navigation';
export default async function OldPoolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/standings`);
}
```

```tsx
// apps/web/src/app/admin/[slug]/bracket/page.tsx
import { redirect } from 'next/navigation';
export default async function OldBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/draw`);
}
```

Update `apps/web/src/actions/revalidate.ts`:

```ts
    `/admin/${slug}`, `/admin/${slug}/event`, `/admin/${slug}/rules`, `/admin/${slug}/teams`, `/admin/${slug}/matches`,
    `/admin/${slug}/standings`, `/admin/${slug}/draw`, `/admin/${slug}/announcements`,
    `/t/${slug}`, `/t/${slug}/pools`, `/t/${slug}/bracket`, `/t/${slug}/team`, `/t/${slug}/join`, `/t/${slug}/announcements`,
```

Grep for any remaining admin links to `/pools` or `/bracket` (`grep -rn "admin/\${slug}/\(pools\|bracket\)\|/bracket\`\|/pools\`" apps/web/src`) and point them at `/standings` and `/draw`.

- [ ] **Step 7: Layout and hub**

```tsx
// apps/web/src/app/admin/[slug]/layout.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { signOut } from '@/app/login/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { LocalDateTime } from '@/components/LocalDateTime';
import { listGames, listMatches, listTeams } from '@/lib/db/queries';
import { statusLine } from '@/lib/admin/hub';

const tabs = [
  ['', 'Home'], ['/teams', 'Teams'], ['/matches', 'Matches'], ['/standings', 'Standings'], ['/draw', 'Draw'], ['/announcements', 'Announcements'],
] as const;

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [teams, matches, games] = await Promise.all([listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id)]);
  const final = matches.find((m) => m.stage === 'knockout' && m.next_match_id === null);
  const line = statusLine({
    status: t.status, startsAt: t.starts_at, venue: t.venue, rules: '', teamCount: teams.length, completeCount: 0, signupOpen: t.signup_open,
    poolCount: 0, meetingCount: 0, liveCount: games.filter((g) => g.started_at !== null && g.score_a === null).length,
    championName: teams.find((x) => x.id === final?.winner_id)?.name ?? null,
  });
  return (
    <div className="mx-auto max-w-5xl p-4 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t.name}</h1>
          <p className="text-sm text-slate-600">
            {t.starts_at && <LocalDateTime iso={t.starts_at} />}{t.starts_at && t.venue ? ' · ' : ''}{t.venue}
          </p>
          <p className="mt-1 text-base font-semibold text-slate-800">{line} · <Link className="font-normal underline" href={`/t/${slug}`}>public page</Link></p>
        </div>
        <form action={signOut}><SubmitButton className="text-sm underline">Sign out</SubmitButton></form>
      </header>
      <nav className="flex flex-wrap gap-1 border-b">
        {tabs.map(([path, label]) => (
          <Link key={label} href={`/admin/${slug}${path}`} className="rounded-t-lg px-4 py-3 text-base font-medium hover:bg-slate-100">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
```

```tsx
// apps/web/src/app/admin/[slug]/page.tsx  (the hub)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { validateRoster } from '@tournament/core';
import { requireAdmin } from '@/actions/guard';
import { lockPools, unlockPools } from '@/actions/pools';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listMatches, listPools, listTeamsWithPlayers } from '@/lib/db/queries';
import { settingsFor } from '@/lib/db/mappers';
import { rosterOf } from '@/lib/teams/roster';
import { hubTiles } from '@/lib/admin/hub';
import { FlashMessage } from '@/components/FlashMessage';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';

export default async function HubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [teams, pools, matches] = await Promise.all([listTeamsWithPlayers(ctx.sb, t.id), listPools(ctx.sb, t.id), listMatches(ctx.sb, t.id)]);
  const s = settingsFor(t, 'pool');
  const rules = `${s.gamesPerMatch} games to ${s.pointsPerGame}${s.timeCapMinutes ? ` · ${s.timeCapMinutes} min clock` : ''} · ${t.court_count} courts · top ${t.advance_per_pool} per pool`;
  const tiles = hubTiles({
    status: t.status, startsAt: t.starts_at, venue: t.venue, rules,
    teamCount: teams.length, completeCount: teams.filter((x) => validateRoster(rosterOf(x)).ok).length, signupOpen: t.signup_open,
    poolCount: pools.length, meetingCount: matches.filter((m) => m.stage === 'pool').length, liveCount: 0, championName: null,
  });
  const teamsTile = tiles.find((x) => x.key === 'teams')!;
  const canLock = t.status === 'setup' && teamsTile.pill === 'Done' && pools.length > 0;
  const resultCount = matches.filter((m) => m.status === 'done').length;
  const pill = (p: string) => (p === 'Done' ? ui.pillDone : p === 'Locked' ? ui.pillLocked : ui.pillTodo);

  async function lock() { 'use server'; redirectWithMsg(`/admin/${slug}`, await lockPools(slug), 'Pools locked and matches created'); }
  async function unlock() { 'use server'; redirectWithMsg(`/admin/${slug}`, await unlockPools(slug), 'Pools unlocked'); }

  return (
    <div className="space-y-5">
      <FlashMessage />
      <p className="text-base text-slate-700">{t.status === 'setup' ? 'Get these four things done, then lock the pools.' : 'Everything is set. Run the night from Matches.'}</p>
      <ol className="space-y-3">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Link href={`/admin/${slug}${tile.href}`} data-testid={`tile-${tile.key}`} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-5 hover:bg-slate-50">
              <span><span className="block text-lg font-semibold">{tile.title}</span><span className="block text-sm text-slate-600">{tile.summary}</span></span>
              <span className={pill(tile.pill)}>{tile.pill}</span>
            </Link>
          </li>
        ))}
      </ol>
      {t.status === 'setup' && (
        <form action={lock} className="space-y-1">
          <SubmitButton disabled={!canLock} className={`${ui.primary} disabled:opacity-50`}>Lock pools and create matches</SubmitButton>
          {!canLock && <p className={ui.help}>{pools.length === 0 ? 'Draw the pools first (tile 4).' : 'Every team needs two men and one woman, and you need at least 4 teams.'}</p>}
        </form>
      )}
      {t.status === 'pools' && (
        <div className="flex flex-wrap gap-3">
          <Link href={`/admin/${slug}/draw`} className={ui.primary}>Start the knockout</Link>
          <form action={unlock}>
            <SubmitButton confirmMessage={`Unlock the pools? This deletes the draw${resultCount ? ` and ${resultCount} entered result${resultCount === 1 ? '' : 's'}` : ''}, and returns the tournament to setup.`} className={ui.danger}>Unlock pools</SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
```

`SubmitButton` spreads `...rest` onto the button, so `disabled` is accepted; but it also sets `disabled={pending}` before the spread — check the order in `SubmitButton.tsx` and, if `disabled={pending}` comes after `{...rest}`, move `{...rest}` above it and change to `disabled={pending || rest.disabled}`.

- [ ] **Step 8: Tests, typecheck, manual check**

Run: `npm test -w @tournament/web` and `npm run typecheck -w @tournament/web` — Expected: PASS / clean.
In the browser walk Home → each tile → back, `/admin/demo/pools` redirects to `/standings`, lock from the hub with an incomplete roster is refused with the team named, and works once fixed.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src/app/admin apps/web/src/lib/admin apps/web/src/actions/tournaments.ts apps/web/src/actions/revalidate.ts
git commit -m "feat(web): organiser hub, Event and Rules pages, Standings and Draw routes"
```

---

### Task 9: Matches page — pool tabs, Ready / Finished, pair names

**Files:**
- Modify: `apps/web/src/components/GameLine.tsx`, `NowPlaying.tsx`
- Modify: `apps/web/src/app/admin/[slug]/matches/page.tsx`, `apps/web/src/app/t/[slug]/page.tsx`

**Interfaces:**
- `GameLine` and `NowPlaying` accept `teams: readonly (TeamRow & { players?: RosterPlayerRow[] })[]` and print pair names when players are present.

- [ ] **Step 1: GameLine prints the pairs**

In `apps/web/src/components/GameLine.tsx`:

```ts
import type { GameRow, RosterPlayerRow, TeamRow, TournamentRow } from '@/lib/db/types';
import { pairNames } from '@/lib/teams/roster';

export type TeamMaybeRoster = TeamRow & { players?: RosterPlayerRow[] };
// prop: teams: readonly TeamMaybeRoster[];

  const pairOf = (id: string | null) => {
    const team = id ? teams.find((x) => x.id === id) : undefined;
    return team?.players ? pairNames({ players: team.players }, slot.game_no) : null;
  };
  const pairA = pairOf(match.teamAId), pairB = pairOf(match.teamBId);
```

Change the first inner `<div className="flex flex-wrap items-center gap-2">` so the label block is:

```tsx
        <span className="min-w-[9rem]">
          <span className="block text-sm font-semibold text-slate-800">{label}</span>
          {(pairA || pairB) && <span data-testid="pair-names" className="block text-xs text-slate-500">{pairA ?? '—'} · {pairB ?? '—'}</span>}
        </span>
```

Also make the primary buttons follow the state ordering from the spec: the `Start now` button gets `className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"`; `Save` inside `GameScoreForm` is unchanged; `Change` / `Clear` / `Pause` / `Take off court` keep the bordered style.

`NowPlaying.tsx`: change the `teams` prop type to `readonly TeamMaybeRoster[]` (import from `./GameLine`).

- [ ] **Step 2: Matches page**

Rewrite `apps/web/src/app/admin/[slug]/matches/page.tsx`'s data and layout (keep `confirm` and `award` handlers):

```tsx
import { listTeamsWithPlayers } from '@/lib/db/queries';   // instead of listTeams
import { ui } from '@/components/ui';

export default async function MatchesAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ pool?: string }> }) {
  const { slug } = await params;
  const { pool: poolFilter = 'all' } = await searchParams;
  // …requireAdmin, loads (teams via listTeamsWithPlayers)…
  const inTab = (m: typeof matches[number]) =>
    poolFilter === 'all' ? true : poolFilter === 'knockout' ? m.stage === 'knockout' : m.poolId === poolFilter;
  const visible = matches.filter(inTab);
  const ready = visible.filter((m) => m.status !== 'done' && m.status !== 'pending');
  const waiting = visible.filter((m) => m.status === 'pending');
  const finished = visible.filter((m) => m.status === 'done');
  const here = `/admin/${slug}/matches?pool=${poolFilter}`;
  const tabsList = [['all', 'All'], ...pools.map((p) => [p.id, p.name] as const), ['knockout', 'Knockout']] as const;
```

Render:

```tsx
    <div className="space-y-5">
      <FlashMessage />
      <RecentOutcome />
      <NowPlaying tournament={t} games={board.nowPlaying} teams={teams} settings={settingsOf} admin />
      {/* Needs attention block unchanged */}
      <nav className="flex flex-wrap gap-2">
        {tabsList.map(([key, name]) => (
          <a key={key} href={`/admin/${slug}/matches?pool=${key}`} className={`rounded-lg px-4 py-2 text-base font-medium ${key === poolFilter ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{name}</a>
        ))}
      </nav>
      <section>
        <h2 className={`${ui.h2} mb-2`}>Ready to play ({ready.length})</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {ready.map((m) => ( /* the existing MatchCard + award + GameLine block, unchanged */ ))}
          {ready.length === 0 && <p className="text-sm text-slate-500">Nothing waiting.</p>}
        </div>
      </section>
      {waiting.length > 0 && (
        <section>
          <h2 className={`${ui.h2} mb-2`}>Waiting on an earlier result ({waiting.length})</h2>
          <div className="grid gap-3 lg:grid-cols-2">{waiting.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} />)}</div>
        </section>
      )}
      <details className="rounded-xl border bg-white p-4" open={finished.length > 0 && ready.length === 0}>
        <summary className="cursor-pointer text-lg font-semibold">Finished ({finished.length})</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {finished.map((m) => ( /* same card block as ready, so a finished game can still be changed */ ))}
        </div>
      </details>
    </div>
```

Every `?filter=` link elsewhere (`Bracket.tsx` `hrefFor`, the draw page, `matches/page.tsx` itself) becomes `?pool=all`; grep `filter=` under `apps/web/src` and `apps/web/e2e` and update. The e2e specs are updated in Task 10 — for this task only the app code.

- [ ] **Step 3: Public live page**

`apps/web/src/app/t/[slug]/page.tsx` already gets `TeamWithPlayers[]` from the bundle (Task 4), so `NowPlaying` prints pairs with no change. In the "Up next" list add the pairs under each line:

```tsx
  const pairLine = (m: typeof matches[number], gameNo: number) => {
    const a = teams.find((x) => x.id === m.teamAId), b = teams.find((x) => x.id === m.teamBId);
    const pa = a ? pairNames(a, gameNo) : null, pb = b ? pairNames(b, gameNo) : null;
    return pa || pb ? `${pa ?? '—'} · ${pb ?? '—'}` : null;
  };
  // in the <li>:
  {pairLine(g.match, g.slot.game_no) && <span className="block w-full text-xs text-slate-500">{pairLine(g.match, g.slot.game_no)}</span>}
```

(`import { pairNames } from '@/lib/teams/roster';`)

- [ ] **Step 4: Typecheck, tests, manual**

`npm run typecheck -w @tournament/web`, `npm test -w @tournament/web` — clean / PASS. In the browser: lock a 4-team demo, open Matches, see the pool tabs, "Ready to play", each game row with `Alex & Priya · Sam & Jo`, start one, see it in Now playing with pairs, score it, see it drop into Finished.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/GameLine.tsx apps/web/src/components/NowPlaying.tsx "apps/web/src/app/admin/[slug]/matches/page.tsx" "apps/web/src/app/t/[slug]/page.tsx" apps/web/src/components/Bracket.tsx "apps/web/src/app/admin/[slug]/draw/page.tsx"
git commit -m "feat(web): pool tabs, Ready/Finished sections and pair names on every game row"
```

---

### Task 10: End-to-end specs, docs

**Files:**
- Modify: `apps/web/e2e/tournament.spec.ts`, `participant.spec.ts`, `club-format.spec.ts`
- Create: `apps/web/e2e/signup.spec.ts`
- Modify: `apps/web/README.md`, `docs/superpowers/specs/2026-09-08-team-signup-and-organiser-ux-design.md` (record the two deviations in §0 / §2.4)

- [ ] **Step 1: Shared team helper in each existing spec**

The three specs add teams through the old textarea. Replace that in each with a per-spec helper (Playwright specs here do not share a helpers file; copy the function into each spec verbatim):

```ts
/** Adds one team through the organiser's form: two men and one woman, named after the team. */
async function addTeam(page: Page, slug: string, name: string) {
  const stem = name.replace(/[^A-Za-z]/g, '').slice(0, 6) || 'Team';
  await page.goto(`/admin/${slug}/teams`);
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="mixed1"]', `${stem} One`);
  await page.fill('input[name="mixed2"]', `${stem} Two`);
  await page.fill('input[name="woman"]', `${stem} Ella`);
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByText('Team added')).toBeVisible();
}
```

Then in each spec replace

```ts
  await page.fill('textarea[name="lines"]', teams.join('\n'));
  await page.getByRole('button', { name: 'Add teams' }).click();
  await expect(page.getByText('Added N team(s)')).toBeVisible();
```

with `for (const name of teams) await addTeam(page, slug, name);`. (In `tournament.spec.ts` the team array is 8 long; `participant.spec.ts` and `club-format.spec.ts` are 4.)

Other edits per spec:

- **tournament.spec.ts**: the "settings" step becomes `await page.goto(`/admin/${slug}/rules`); await page.getByRole('button', { name: 'Save rules' }).click(); await expect(page.getByText('Settings saved')).toBeVisible();`. Every `/admin/${slug}/pools` becomes `/admin/${slug}/standings`; every `/admin/${slug}/bracket` becomes `/admin/${slug}/draw`; every `matches?filter=open` becomes `matches?pool=all` and `matches?filter=done` also `matches?pool=all` (finished meetings live in the collapsed "Finished" block — open it with `await page.getByRole('group').filter({ hasText: 'Finished' }).locator('summary').click()` or simply `await page.locator('summary', { hasText: 'Finished' }).click()`). The lock step is now `await page.goto(`/admin/${slug}`); await page.getByRole('button', { name: 'Lock pools and create matches' }).click();` **after** generating pools on `/standings`.
- **participant.spec.ts**: private links are collected from the Teams page: `page.locator('[data-testid="team-row"]', { hasText: name }).locator('code').first()` — the row's `<details>` must be open for the code to exist in the DOM? No: `<details>` content is in the DOM whether open or not, and `textContent()` reads it; only visibility differs. Keep `textContent()`. Same path changes as above.
- **club-format.spec.ts**: same path changes; the lock step moves to the hub as above; the "Lock the pools first" text on the draw page is unchanged.

- [ ] **Step 2: New sign-up spec**

```ts
// apps/web/e2e/signup.spec.ts
import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `signup-${Date.now().toString(36)}`;
const teams = ['Smashers', 'Net Ninjas', 'Drop Shots', 'Late Birds'];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function joinAs(page: Page, name: string, code?: string) {
  const stem = name.replace(/[^A-Za-z]/g, '').slice(0, 6);
  await page.goto(`/t/${slug}/join`);
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="mixed1"]', `${stem} One`);
  await page.fill('input[name="mixed2"]', `${stem} Two`);
  await page.fill('input[name="woman"]', `${stem} Ella`);
  if (code !== undefined) await page.fill('input[name="joinCode"]', code);
  await page.getByRole('button', { name: 'Sign our team up' }).click();
}

test('teams sign themselves up, the organiser locks, and every game names its pair', async ({ page, browser }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);
  await page.fill('input[name="name"]', 'Sign-up Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await expect(page.getByTestId('tile-teams')).toContainText('0 signed up');

  // organiser sets a join code
  await page.goto(`/admin/${slug}/teams`);
  await page.fill('input[name="joinCode"]', 'club2026');
  await page.getByRole('button', { name: 'Save code' }).click();
  await expect(page.getByText('Join code saved')).toBeVisible();

  // a team in a fresh browser context: wrong code first, then right
  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await joinAs(visitor, teams[0]!, 'wrong');
  await expect(visitor.getByRole('alert')).toContainText('join code is not right');
  await joinAs(visitor, teams[0]!, 'club2026');
  await expect(visitor).toHaveURL(new RegExp(`/t/${slug}/team\\?welcome=1$`));
  await expect(visitor.getByTestId('welcome')).toContainText(`/t/${slug}/team/`);
  // the team can swap its mixed pairs while in setup
  await visitor.getByRole('button', { name: 'Swap which man plays Mixed #1' }).click();
  await expect(visitor.getByText('Mixed pairs swapped')).toBeVisible();
  await expect(visitor.locator('input[name="mixed1"]')).toHaveValue('Smashe Two');
  // a duplicate name is refused
  await joinAs(visitor, 'smashers', 'club2026');
  await expect(visitor.getByRole('alert')).toContainText('already taken');

  // the remaining teams, each in its own context so cookies do not collide
  for (const name of teams.slice(1)) {
    const c = await browser.newContext();
    const p = await c.newPage();
    await joinAs(p, name, 'club2026');
    await expect(p.getByTestId('welcome')).toBeVisible();
    await c.close();
  }

  // organiser sees four complete rosters, draws one pool and locks from the hub
  await page.goto(`/admin/${slug}`);
  await expect(page.getByTestId('tile-teams')).toContainText('4 signed up · 4 complete');
  await page.goto(`/admin/${slug}/standings`);
  await page.fill('input[name="poolCount"]', '1');
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await page.goto(`/admin/${slug}`);
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();

  // sign-ups closed automatically, the join page says so
  await visitor.goto(`/t/${slug}/join`);
  await expect(visitor.getByText('Sign-ups are closed')).toBeVisible();
  // and the roster is read-only now
  await visitor.goto(`/t/${slug}/team`);
  await expect(visitor.getByText("The draw is locked, so players can't change")).toBeVisible();

  // every game row names its pair: game 1 of Smashers' first meeting is "Smashe Two & Smashe Ella" after the swap
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const card = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') }).filter({ hasText: 'Smashers' }).first();
  const pairs = card.getByTestId('pair-names');
  await expect(pairs).toHaveCount(3);
  await expect(pairs.nth(0)).toContainText('Smashe Two & Smashe Ella');
  await expect(pairs.nth(1)).toContainText('Smashe One & Smashe Ella');
  await expect(pairs.nth(2)).toContainText('Smashe Two & Smashe One');

  // the overall leaderboard lists all four
  await page.goto(`/admin/${slug}/standings`);
  await expect(page.getByTestId('leaderboard').locator('tbody tr')).toHaveCount(4);
  await ctx.close();
});
```

Note `pairs.nth(2)`: after the swap `mixed1` is "Smashe Two" and men's doubles is `[mixed1, mixed2]` = "Smashe Two & Smashe One".

- [ ] **Step 3: Run the whole e2e suite**

```bash
npx kill-port 3100
npm run e2e -w @tournament/web
```

Expected: 4 specs pass (about ten minutes). Fix selector drift in the three older specs until green; do not weaken assertions.

- [ ] **Step 4: Docs**

`apps/web/README.md`: under "Local development" step 4 add "share `/t/<slug>/join` for teams to sign themselves up"; add a **Teams and sign-up** section (three named players, boxes decide gender and role, join code, sign-ups close at lock, organiser Teams page, incomplete rosters block locking); add a **Organiser screens** section (Home hub with four tiles and the lock button, Event, Rules, Teams, Matches tabs and sections, Standings with the overall points table, Draw); update **Routes** (admin: `/admin/[slug]` hub, `/event`, `/rules`, `/teams`, `/matches`, `/standings`, `/draw`, `/announcements`; public adds `/t/[slug]/join`); update **Tests** (fourth spec).

Spec document: in §0 add the two deviations from this plan's header; in §2.4 replace the `update_team_roster` paragraph with the `write_roster` / service-role description and add `admin_add_team` / `admin_set_roster`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e apps/web/README.md docs/superpowers/specs/2026-09-08-team-signup-and-organiser-ux-design.md
git commit -m "test(e2e): sign-up spec; existing specs use the roster form and new routes; docs"
```

---

## Self-review

**Spec coverage (§1–§4, §6, §7):**
- §1.1 gender/role columns, backfill, incomplete badge, lock refusal → Tasks 3, 5, 7. §1.2 sign-up columns, lock closes → Tasks 3, 5. §1.3 description → Tasks 3, 4, 6. §1.5 refresh link: the Teams page is `dynamic` and every action redirects, so a plain reload suffices; no separate link is built (YAGNI).
- §2.1 join page fields, helper text, button, welcome banner with copy → Task 6. §2.2 inline errors and 10/min limit → Tasks 5, 6. §2.3 team page edits, swap, lock note → Task 6. §2.4 functions → Task 3 (with the recorded deviation). §2.5 organiser controls and count line → Task 7.
- §3.1, §3.2 → Tasks 1, 2. §4.1 shell, nav, redirects, conventions → Task 8 (`ui.ts` in Task 6). §4.2 hub → Task 8. §4.3 → Task 8. §4.4 → Task 7. §4.5 → Task 9. §4.6 leaderboard on Standings → Task 8. §4.7 → Task 5.
- §6 security → Tasks 3, 5 (grants, single anon write path, token once). §7 tests → Tasks 1, 2, 3, 4, 8, 10.

**Placeholder scan:** the Rules page (Task 8 Step 5) and the Matches render (Task 9 Step 2) are described as edits to existing code with the exact changes listed rather than full listings; the implementer has the current files. No TBDs.

**Type consistency:** `TeamWithPlayers.players: RosterPlayerRow[]` (Task 4) is what `rosterOf`, `pairNames`, `TeamsAdmin`, the hub and `lockPools` consume; `TeamMaybeRoster` (Task 9) is the widened `GameLine` prop; `hubTiles` / `statusLine` take one `HubInput` (Task 8). `signUpTeam` returns `{ token }` and `JoinForm` reads `r.data.token`. `rosterErrorMessage` maps exactly the messages the migration raises.
