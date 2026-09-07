# Club Format, Overrides, Clock and Scheduling (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support the first real event's format (single game to 15 with a 13-minute clock, 1 team point per win, playoff tiebreaker, per-stage settings), give admins overrides (award match, withdraw team, replace a bracket team, manual pool order), add a tournament date/venue, a "Start now" flow with a court countdown, taglines everywhere, and fix result entry so errors show inline and scores are kept.

**Architecture:** Rule changes go into `packages/tournament-core` first (time-expired games, per-stage settings shape, team points and the new tie order, manual order and unresolved-tie detection) with unit tests. The web app gets a migration (new columns, `playoff` stage, `decided_by`, `started_at`, `time_expired`), stage-aware settings plumbing, new server actions for overrides, and UI changes. The score form becomes a client form that calls its action and renders the result inline instead of redirecting.

**Tech Stack:** unchanged (Next.js 15.5, React 19, Tailwind, Supabase, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md` section 11 (all of it), plus the sections it amends (5, 6.1, 6.3, 7).

## Global Constraints

- All earlier Global Constraints still apply (plans 2 and 3). Rules only in `@tournament/core`; the app never re-implements them.
- Per-stage settings: `Settings` gains `timeCapMinutes: number | null`. The tournament row stores a pool set and a knockout set (`ko_*` columns); `settingsFor(tournament, stage)` picks one. `playoff` matches use the pool settings.
- Team points: 1 per match win. Standings order (spec 11.2): points desc → recorded playoff between exactly two tied teams → head-to-head (two-way) → score difference desc → unresolved (name order, flagged).
- A game with `timeExpired` is valid when scores are non-negative integers, not equal, and neither exceeds `maxPoints ?? pointsPerGame`. Only allowed when the stage's `timeCapMinutes` is not null.
- New DB values: `matches.stage in ('pool','knockout','playoff')` (playoff requires `pool_id`, `round` null); `matches.decided_by in ('played','awarded','forfeit')` default `played`; `matches.started_at timestamptz`; `games.time_expired boolean default false`; `teams.withdrawn boolean default false`; `teams.pool_rank_override int`; tournaments: `starts_at timestamptz`, `venue text`, `time_cap_minutes int`, `ko_games_per_match`, `ko_points_per_game`, `ko_win_by_two`, `ko_max_points`, `ko_time_cap_minutes` (knockout columns nullable; null means "same as pool").
- Defaults for a new tournament change to the club format: `games_per_match 1`, `points_per_game 15`, `win_by_two false`, `max_points null`, `time_cap_minutes 13`, `advance_per_pool 2`, `court_count 4`. `BADMINTON_DEFAULTS` in core is updated to match (`gamesPerMatch 1, pointsPerGame 15, winByTwo false, maxPoints null, timeCapMinutes 13`). Existing core tests that assumed best-of-3/win-by-two build their own `Settings` literal instead of relying on the default; update them rather than the behaviour.
- Typed action errors as before. Migration edited in place (never deployed) followed by `npx supabase db reset`.
- Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

```
packages/tournament-core/src/
  types.ts                 Settings.timeCapMinutes, Game.timeExpired, Stage 'playoff', Match.decidedBy
  scoring.ts (+test)       validateGame(s, a, b, timeExpired?), matchResult passes it, validateSettings
  standings.ts (+test)     points column, new tie order, playoff results, manualOrder, unresolvedTies
  liveBoard.ts             ignore playoff matches in upNext (they are ad hoc) — they still show when live
  index.ts, README.md
supabase/migrations/20260906000000_init.sql   new columns and checks
apps/web/src/
  lib/db/types.ts, mappers.ts (settingsFor, rowToMatch decidedBy), queries.ts (unchanged API)
  lib/tournaments/settingsForm.ts (+test)      per-stage parsing + startsAt/venue
  lib/results/apply.ts (+test)                 planAward; planCourt startedAt; stage-aware
  lib/results/persist.ts                       decided_by, started_at, time_expired
  lib/results/form.ts                          gamesFromForm reads game{n}x checkbox
  lib/standings/compute.ts (+test)             glue: pool rows -> poolStandings(... {playoffs, manualOrder}) + tie flags
  actions/matches.ts                           startNow, awardMatch, replaceTeamInMatch, enterResult (stage-aware, inline result)
  actions/teams.ts                             withdrawTeam, reinstateTeam
  actions/pools.ts                             createPlayoff, setManualOrder, clearManualOrder
  actions/tournaments.ts                       createTournament (startsAt, venue), updateSettings per stage
  components/ScoreForm.tsx                     client: calls action, inline outcome, time-expired boxes, disabled until valid
  components/CourtClock.tsx                    countdown from started_at
  components/MatchCard.tsx, Bracket.tsx, StandingsTable.tsx   taglines, awarded/forfeit labels, withdrawn styling, Pts/±
  app/admin/[slug]/page.tsx                    settings per stage, date/venue, withdraw/reinstate
  app/admin/[slug]/pools/page.tsx              tie flags, record playoff, manual order
  app/admin/[slug]/matches/page.tsx            Start now, award buttons, clock
  app/admin/[slug]/bracket/page.tsx            replace team in slot
  app/admin/page.tsx                           create form: date, time, venue
  app/t/[slug]/layout.tsx, page.tsx, pools/page.tsx, team/page.tsx   header details, clock, standings, taglines
  e2e/club-format.spec.ts                      new spec
```

---

### Task 1: Core: time-expired games and per-stage settings shape

**Files:**
- Modify: `packages/tournament-core/src/types.ts`, `packages/tournament-core/src/scoring.ts`, `packages/tournament-core/src/scoring.test.ts`, `packages/tournament-core/src/simulation.test.ts` (settings literal), `packages/tournament-core/src/liveBoard.ts`, `packages/tournament-core/src/liveBoard.test.ts`, `packages/tournament-core/README.md`

**Interfaces:**
- Produces:
  - `Settings { gamesPerMatch; pointsPerGame; winByTwo; maxPoints; timeCapMinutes: number | null }`, `BADMINTON_DEFAULTS = { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 }`, `CLASSIC_BEST_OF_THREE: Settings = { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: null }` (used by the old tests).
  - `Game { gameNo; scoreA; scoreB; timeExpired?: boolean }`
  - `Stage = 'pool' | 'knockout' | 'playoff'`; `Match.decidedBy: 'played' | 'awarded' | 'forfeit'` (new required field; `makeMatch` test helper defaults it to `'played'`).
  - `validateGame(s, scoreA, scoreB, timeExpired = false)`; `matchResult` forwards `game.timeExpired ?? false`.
  - `validateSettings` also checks `timeCapMinutes` is null or a positive integer.
  - `liveBoard`: `upNext` ignores `playoff` matches; `nowPlaying` includes them.

- [ ] **Step 1: Failing tests**

Append to `packages/tournament-core/src/scoring.test.ts` (and change the file's top-level `const s = BADMINTON_DEFAULTS` to `const s = CLASSIC_BEST_OF_THREE`, importing it, so every existing expectation still holds):

```ts
describe('time-expired games', () => {
  const club: Settings = { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 };
  it('accepts any non-level score when time expired under a clock', () => {
    expect(validateGame(club, 11, 8, true)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(club, 3, 4, true)).toEqual({ ok: true, winner: 'b' });
  });
  it('still rejects a level score at expiry (deciding point is played on court)', () => {
    expect(validateGame(club, 9, 9, true)).toEqual({ ok: false, reason: 'a game cannot end in a tie' });
  });
  it('rejects scores above the target even when time expired', () => {
    expect(validateGame(club, 16, 3, true)).toEqual({ ok: false, reason: 'scores cannot exceed 15' });
  });
  it('rejects the flag when the stage has no clock', () => {
    const noClock: Settings = { ...club, timeCapMinutes: null };
    expect(validateGame(noClock, 11, 8, true)).toEqual({ ok: false, reason: 'this stage has no time cap' });
  });
  it('without the flag a club game must reach 15 and may be won by one', () => {
    expect(validateGame(club, 15, 14)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(club, 14, 12)).toEqual({ ok: false, reason: 'winner must reach 15' });
  });
  it('matchResult honours the per-game flag and a single-game match', () => {
    expect(matchResult(club, [{ gameNo: 1, scoreA: 10, scoreB: 7, timeExpired: true }])).toMatchObject({ ok: true, complete: true, winner: 'a' });
    expect(matchResult(club, [{ gameNo: 1, scoreA: 10, scoreB: 7 }])).toMatchObject({ ok: false });
  });
  it('validateSettings checks the time cap', () => {
    expect(validateSettings(club)).toEqual([]);
    expect(validateSettings({ ...club, timeCapMinutes: 0 })).toEqual(['timeCapMinutes must be null or a positive integer']);
    expect(validateSettings(BADMINTON_DEFAULTS)).toEqual([]);
  });
});
```

Append to `packages/tournament-core/src/liveBoard.test.ts`:

```ts
  it('never queues playoff matches as up next but shows them when live', () => {
    const ms = [
      makeMatch({ id: 'p1', stage: 'playoff', poolId: 'A', slot: 99, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'p2', stage: 'playoff', poolId: 'B', slot: 99, status: 'live', court: 2, teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'a1', poolId: 'A', slot: 1, status: 'ready', teamAId: 't1', teamBId: 't2' }),
    ];
    const b = liveBoard(ms, 'pool', ['A', 'B']);
    expect(b.upNext.map((m) => m.id)).toEqual(['a1']);
    expect(b.nowPlaying.map((m) => m.id)).toEqual(['p2']);
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -w @tournament/core
```

Expected: type errors / failures on the new fields.

- [ ] **Step 3: Implement**

`types.ts` changes:

```ts
export interface Settings {
  gamesPerMatch: number;
  pointsPerGame: number;
  winByTwo: boolean;
  maxPoints: number | null;
  /** Minutes per game before the clock ends it; null = no clock. */
  timeCapMinutes: number | null;
}

/** Club night format: one game to 15, win by one, 13-minute clock. */
export const BADMINTON_DEFAULTS: Settings = { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 };
/** Traditional best-of-three used by the original tests. */
export const CLASSIC_BEST_OF_THREE: Settings = { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: null };

export type Stage = 'pool' | 'knockout' | 'playoff';
export type DecidedBy = 'played' | 'awarded' | 'forfeit';

export interface Game {
  gameNo: number;
  scoreA: number;
  scoreB: number;
  /** The clock ended this game; any non-level score is accepted. */
  timeExpired?: boolean;
}
```

and add `decidedBy: DecidedBy;` to `Match` (after `winnerId`). Update `testUtils.makeMatch` default `decidedBy: 'played'`, and every literal `Match` in tests/`poolMatches`/`buildBracket` to include `decidedBy: 'played'`.

`scoring.ts`:

```ts
export function validateGame(s: Settings, scoreA: number, scoreB: number, timeExpired = false): GameValidation {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return fail('scores must be non-negative whole numbers');
  }
  if (scoreA === scoreB) return fail('a game cannot end in a tie');
  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  const lead = hi - lo;
  const winner: Side = scoreA > scoreB ? 'a' : 'b';
  const ceiling = s.maxPoints ?? s.pointsPerGame;

  if (timeExpired) {
    if (s.timeCapMinutes === null) return fail('this stage has no time cap');
    if (hi > ceiling) return fail(`scores cannot exceed ${ceiling}`);
    return { ok: true, winner };
  }
  // ... existing body unchanged from here ...
```

In `matchResult` call `validateGame(s, game.scoreA, game.scoreB, game.timeExpired ?? false)`. In `validateSettings` add:

```ts
  if (s.timeCapMinutes !== null && (!Number.isInteger(s.timeCapMinutes) || s.timeCapMinutes <= 0)) {
    problems.push('timeCapMinutes must be null or a positive integer');
  }
```

`liveBoard.ts`: in the up-next candidate filter add `m.stage !== 'playoff' &&`. `simulation.test.ts`: use `CLASSIC_BEST_OF_THREE` where it used `BADMINTON_DEFAULTS` (two games of 15-10 need best-of-three). README: document `timeExpired`, `timeCapMinutes`, `CLASSIC_BEST_OF_THREE`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @tournament/core
npm run typecheck -w @tournament/core
git add -A
git commit -m "feat(core): time-expired games, per-game clock settings, playoff stage, decidedBy" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Core: team points, new tie order, playoff results, manual order, unresolved ties

**Files:**
- Modify: `packages/tournament-core/src/standings.ts`, `packages/tournament-core/src/standings.test.ts`, `packages/tournament-core/README.md`

**Interfaces:**
- Produces:
  - `StandingRow` gains `points: number` (= won) and `tieUnresolved: boolean`.
  - `poolStandings(teams, matches, gamesByMatch, options?: { manualOrder?: readonly string[] })`. `matches` may include `playoff` matches for this pool; they are excluded from played/won/points/score but consulted as tie-breakers.
  - Order: points desc → playoff result between exactly two tied teams → head-to-head (exactly two tied) → pointDiff desc → name asc with `tieUnresolved = true` on every member of a group that reached the name step.
  - `manualOrder`: if given, rows are ordered by their index in it (unknown ids after, in computed order) and `tieUnresolved` is false everywhere.
  - `unresolvedTies(rows: StandingRow[], advancePerPool: number): { teamIds: string[]; affects: 'qualification' | 'seeding' }[]` — groups of rows with `tieUnresolved` that span the qualification boundary (positions advancePerPool and advancePerPool+1) or include position 1.

- [ ] **Step 1: Failing tests**

Replace `standings.test.ts` `describe('poolStandings')` additions with these extra cases (keep the earlier ones, adjusting `won` → they still hold; `points` equals `won`):

```ts
describe('club format ordering', () => {
  const four: TeamRef[] = [{ id: 'A', name: 'Aces' }, { id: 'B', name: 'Birdies' }, { id: 'C', name: 'Clears' }, { id: 'D', name: 'Drops' }];
  const g1 = (a: number, b: number) => [{ gameNo: 1, scoreA: a, scoreB: b }];
  const done = (id: string, a: string, b: string, sa: number, sb: number, stage: 'pool' | 'playoff' = 'pool'): [Match, Game[]] => [
    makeMatch({ id, stage, poolId: 'P', teamAId: a, teamBId: b, status: 'done', winnerId: sa > sb ? a : b }), g1(sa, sb),
  ];
  const build = (list: [Match, Game[]][]) => ({ matches: list.map(([m]) => m), games: Object.fromEntries(list.map(([m, g]) => [m.id, g])) });

  it('gives one point per win and exposes it', () => {
    const { matches, games } = build([done('m1', 'A', 'B', 15, 9), done('m2', 'C', 'D', 15, 3), done('m3', 'A', 'C', 15, 14)]);
    const rows = poolStandings(four, matches, games);
    expect(rows.map((r) => [r.teamId, r.points])).toEqual([['A', 2], ['C', 1], ['B', 0], ['D', 0]]);
  });

  it('a recorded playoff between two tied teams decides before head-to-head', () => {
    // A beat B in the pool, but B won the playoff -> B ranks above A; C above D by head-to-head
    const { matches, games } = build([
      done('m1', 'A', 'B', 15, 9), done('m2', 'A', 'C', 15, 9), done('m3', 'D', 'A', 15, 9),
      done('m4', 'B', 'C', 15, 9), done('m5', 'B', 'D', 15, 9), done('m6', 'C', 'D', 15, 9),
      done('po', 'A', 'B', 9, 15, 'playoff'),
    ]);
    const rows = poolStandings(four, matches, games);
    expect(rows.map((r) => r.teamId)).toEqual(['B', 'A', 'C', 'D']);
    expect(rows.find((r) => r.teamId === 'B')!.played).toBe(3); // playoff not counted
    expect(rows.every((r) => !r.tieUnresolved)).toBe(true);
  });

  it('without the playoff, head-to-head alone decides both two-way ties', () => {
    const { matches, games } = build([
      done('m1', 'A', 'B', 15, 9), done('m2', 'A', 'C', 15, 9), done('m3', 'D', 'A', 15, 9),
      done('m4', 'B', 'C', 15, 9), done('m5', 'B', 'D', 15, 9), done('m6', 'C', 'D', 15, 9),
    ]);
    const rows = poolStandings(four, matches, games);
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows.every((r) => !r.tieUnresolved)).toBe(true);
  });

  it('head-to-head then score difference resolve two-way ties', () => {
    const { matches, games } = build([done('m1', 'A', 'B', 15, 9), done('m2', 'B', 'C', 15, 9), done('m3', 'C', 'A', 15, 9), done('m4', 'A', 'D', 15, 9), done('m5', 'B', 'D', 15, 9), done('m6', 'C', 'D', 15, 9)]);
    // A, B, C all 2 points with a circular head-to-head and equal diff -> unresolved three-way
    const rows = poolStandings(four, matches, games);
    expect(rows.slice(0, 3).every((r) => r.tieUnresolved)).toBe(true);
    expect(rows[3]).toMatchObject({ teamId: 'D', tieUnresolved: false });
  });

  it('manual order overrides everything and clears flags', () => {
    const { matches, games } = build([done('m1', 'A', 'B', 15, 9)]);
    const rows = poolStandings(four, matches, games, { manualOrder: ['D', 'B'] });
    expect(rows.map((r) => r.teamId)).toEqual(['D', 'B', 'A', 'C']);
    expect(rows.every((r) => !r.tieUnresolved)).toBe(true);
  });
});

describe('unresolvedTies', () => {
  const row = (teamId: string, points: number, tieUnresolved: boolean): StandingRow => ({ teamId, name: teamId, played: 3, won: points, lost: 3 - points, points, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0, tieUnresolved });
  it('flags a tie spanning the qualification line', () => {
    const rows = [row('A', 3, false), row('B', 2, true), row('C', 2, true), row('D', 0, false)];
    expect(unresolvedTies(rows, 2)).toEqual([{ teamIds: ['B', 'C'], affects: 'qualification' }]);
  });
  it('flags a tie for first as seeding', () => {
    const rows = [row('A', 3, true), row('B', 3, true), row('C', 1, false), row('D', 0, false)];
    expect(unresolvedTies(rows, 2)).toEqual([{ teamIds: ['A', 'B'], affects: 'seeding' }]);
  });
  it('ignores ties below the line', () => {
    const rows = [row('A', 3, false), row('B', 2, false), row('C', 1, true), row('D', 1, true)];
    expect(unresolvedTies(rows, 2)).toEqual([]);
  });
});
```

Import `unresolvedTies`, `Game`, `Match`, `StandingRow` as needed.

- [ ] **Step 2: Run to verify failure**

```bash
npm test -w @tournament/core -- src/standings.test.ts
```

- [ ] **Step 3: Implement**

Replace `standings.ts`:

```ts
import type { Game, Match, TeamRef } from './types';

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  /** Team points: one per match win. */
  points: number;
  gamesWon: number;
  gamesLost: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  /** True when this row's position was settled only by name order. */
  tieUnresolved: boolean;
}

export interface StandingsOptions {
  /** Organiser-set finishing order (team ids). Overrides the computed order. */
  manualOrder?: readonly string[];
}

/**
 * Standings for one pool from done matches only. Order: points desc, then within a tie:
 * a playoff match between exactly the two tied teams, head-to-head (two-way), score
 * difference, and finally name order with `tieUnresolved` set. Playoff matches are not
 * counted in played/points/score. Pass only this pool's teams and matches.
 */
export function poolStandings(
  teams: readonly TeamRef[],
  matches: readonly Match[],
  gamesByMatch: Readonly<Record<string, readonly Game[]>>,
  options: StandingsOptions = {},
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const t of teams) {
    rows.set(t.id, { teamId: t.id, name: t.name, played: 0, won: 0, lost: 0, points: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0, tieUnresolved: false });
  }
  const isDone = (m: Match) => m.status === 'done' && m.teamAId !== null && m.teamBId !== null && m.winnerId !== null;
  const done = matches.filter((m) => isDone(m) && m.stage !== 'playoff');
  const playoffs = matches.filter((m) => isDone(m) && m.stage === 'playoff');

  for (const m of done) {
    const a = rows.get(m.teamAId!);
    const b = rows.get(m.teamBId!);
    if (!a || !b) continue;
    a.played++; b.played++;
    if (m.winnerId === a.teamId) { a.won++; b.lost++; } else { b.won++; a.lost++; }
    for (const g of gamesByMatch[m.id] ?? []) {
      a.pointsFor += g.scoreA; a.pointsAgainst += g.scoreB;
      b.pointsFor += g.scoreB; b.pointsAgainst += g.scoreA;
      if (g.scoreA > g.scoreB) { a.gamesWon++; b.gamesLost++; } else { b.gamesWon++; a.gamesLost++; }
    }
  }
  for (const r of rows.values()) { r.points = r.won; r.pointDiff = r.pointsFor - r.pointsAgainst; }

  if (options.manualOrder) {
    const pos = new Map(options.manualOrder.map((id, i) => [id, i]));
    const computed = orderComputed([...rows.values()], done, playoffs);
    return computed.sort((x, y) => (pos.get(x.teamId) ?? Number.MAX_SAFE_INTEGER) - (pos.get(y.teamId) ?? Number.MAX_SAFE_INTEGER)).map((r) => ({ ...r, tieUnresolved: false }));
  }
  return orderComputed([...rows.values()], done, playoffs);
}

function meetingWinner(list: readonly Match[], x: string, y: string): string | null {
  const m = list.find((m) => (m.teamAId === x && m.teamBId === y) || (m.teamAId === y && m.teamBId === x));
  return m ? m.winnerId : null;
}

/** Sort by points, then resolve each equal-points group with the tie chain. */
function orderComputed(rows: StandingRow[], done: readonly Match[], playoffs: readonly Match[]): StandingRow[] {
  const byPoints = new Map<number, StandingRow[]>();
  for (const r of rows) (byPoints.get(r.points) ?? byPoints.set(r.points, []).get(r.points)!).push(r);
  const out: StandingRow[] = [];
  for (const pts of [...byPoints.keys()].sort((a, b) => b - a)) {
    const group = byPoints.get(pts)!;
    if (group.length === 1) { out.push(group[0]!); continue; }
    if (group.length === 2) {
      const [x, y] = group as [StandingRow, StandingRow];
      const po = meetingWinner(playoffs, x.teamId, y.teamId);
      if (po) { out.push(...(po === x.teamId ? [x, y] : [y, x])); continue; }
      const h2h = meetingWinner(done, x.teamId, y.teamId);
      if (h2h) { out.push(...(h2h === x.teamId ? [x, y] : [y, x])); continue; }
    }
    // score difference, then unresolved name order (flag only the members still level after diff)
    const byDiff = [...group].sort((a, b) => b.pointDiff - a.pointDiff || a.name.localeCompare(b.name));
    for (let i = 0; i < byDiff.length; i++) {
      const r = byDiff[i]!;
      const prev = byDiff[i - 1], next = byDiff[i + 1];
      r.tieUnresolved = (prev !== undefined && prev.pointDiff === r.pointDiff) || (next !== undefined && next.pointDiff === r.pointDiff);
    }
    out.push(...byDiff);
  }
  return out;
}

export interface UnresolvedTie { teamIds: string[]; affects: 'qualification' | 'seeding' }

/** Unresolved tie groups that change who qualifies (span positions n and n+1) or who is first. */
export function unresolvedTies(rows: readonly StandingRow[], advancePerPool: number): UnresolvedTie[] {
  const out: UnresolvedTie[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!rows[i]!.tieUnresolved) { i++; continue; }
    let j = i;
    while (j + 1 < rows.length && rows[j + 1]!.tieUnresolved && rows[j + 1]!.points === rows[i]!.points && rows[j + 1]!.pointDiff === rows[i]!.pointDiff) j++;
    const first = i + 1, last = j + 1; // 1-based positions
    if (first <= advancePerPool && last > advancePerPool) out.push({ teamIds: rows.slice(i, j + 1).map((r) => r.teamId), affects: 'qualification' });
    else if (first === 1 && last >= 2) out.push({ teamIds: rows.slice(i, j + 1).map((r) => r.teamId), affects: 'seeding' });
    i = j + 1;
  }
  return out;
}
```

Fix up the earlier standings tests: the old "head-to-head when exactly two teams tie on wins and point difference" case still passes (two-way group → h2h before diff now, same expected order); the "three-way tie falls back to name order" case still yields `['A','B','C','D']` but now with `tieUnresolved` true for A, B, C; assert that too. Export `unresolvedTies`, `UnresolvedTie`, `StandingsOptions` from `index.ts` (already `export *`).

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @tournament/core
npm run typecheck -w @tournament/core
git add -A
git commit -m "feat(core): team points, playoff/head-to-head/diff tie order, manual order, unresolved ties" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Migration, row types, per-stage settings, tournament date and venue

**Files:**
- Modify: `supabase/migrations/20260906000000_init.sql`, `apps/web/src/lib/db/types.ts`, `apps/web/src/lib/db/mappers.ts`, `apps/web/src/lib/db/mappers.test.ts`, `apps/web/src/lib/tournaments/settingsForm.ts`, `apps/web/src/lib/tournaments/settingsForm.test.ts`, `apps/web/src/actions/tournaments.ts`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/[slug]/page.tsx`, `apps/web/src/app/t/[slug]/layout.tsx`
- Every place that constructs a `Match` literal or calls `settingsFromTournament` must compile again: `lib/results/apply.ts`, `lib/results/persist.ts`, `lib/pools/plan.ts`, `lib/bracket/plan.ts`, `actions/*.ts`, pages, tests. Mechanical: add `decidedBy: 'played'` / `decided_by` handling and replace `settingsFromTournament(t)` with `settingsFor(t, stage)`.

**Interfaces:**
- Produces:
  - Migration changes listed in Global Constraints; `create_tournament(p_slug, p_name, p_starts_at timestamptz default null, p_venue text default null)`.
  - `TournamentRow` gains `starts_at: string | null; venue: string | null; time_cap_minutes: number | null; ko_games_per_match: number | null; ko_points_per_game: number | null; ko_win_by_two: boolean | null; ko_max_points: number | null; ko_time_cap_minutes: number | null`. `TeamRow` gains `withdrawn: boolean; pool_rank_override: number | null` (both public columns; extend `TEAM_PUBLIC_COLUMNS`). `MatchRow` gains `decided_by: 'played' | 'awarded' | 'forfeit'; started_at: string | null`; `stage` type includes `'playoff'`. `GameRow` gains `time_expired: boolean`.
  - `settingsFor(t: TournamentRow, stage: Stage): Settings` (knockout uses `ko_*` falling back to pool values; `pool` and `playoff` use pool values). `settingsFromTournament` is removed.
  - `rowToMatch`/`matchToRow` carry `decidedBy`/`decided_by`; `matchToRow` returns `Omit<MatchRow, 'finished_at' | 'started_at'>`. `rowToGame` carries `timeExpired`.
  - `parseSettingsForm` returns `{ pool: Settings; knockout: Settings | null; courtCount; advancePerPool; startsAt: string | null; venue: string }` with field names `pool_gamesPerMatch`, `pool_pointsPerGame`, `pool_winByTwo`, `pool_maxPoints`, `pool_timeCap`, `ko_same` (checkbox: knockout same as pool), `ko_gamesPerMatch`, `ko_pointsPerGame`, `ko_winByTwo`, `ko_maxPoints`, `ko_timeCap`, `courtCount`, `advancePerPool`, `startsAt` (datetime-local string or blank), `venue`.
  - `createTournament` reads `name`, `slug`, `startsAt`, `venue`.

- [ ] **Step 1: Migration edits**

In `tournaments`: change defaults and add columns:

```sql
  games_per_match int not null default 1,
  points_per_game int not null default 15,
  win_by_two boolean not null default false,
  max_points int,
  time_cap_minutes int check (time_cap_minutes is null or time_cap_minutes > 0),
  ko_games_per_match int,
  ko_points_per_game int,
  ko_win_by_two boolean,
  ko_max_points int,
  ko_time_cap_minutes int check (ko_time_cap_minutes is null or ko_time_cap_minutes > 0),
  starts_at timestamptz,
  venue text check (venue is null or length(venue) <= 120),
  court_count int not null default 4 check (court_count between 1 and 50),
```

(remove the old `max_points int default 21` line; keep `advance_per_pool`.) After the table, set the club default: `alter table public.tournaments alter column time_cap_minutes set default 13;`.

In `teams` add `withdrawn boolean not null default false, pool_rank_override int,` and extend the column grant list to include `withdrawn, pool_rank_override`.

In `matches`: `stage text not null check (stage in ('pool','knockout','playoff'))`, add `decided_by text not null default 'played' check (decided_by in ('played','awarded','forfeit'))`, `started_at timestamptz`, and change the stage check to:

```sql
  check ((stage in ('pool','playoff') and pool_id is not null and round is null)
      or (stage = 'knockout' and pool_id is null and round is not null))
```

In `games` add `time_expired boolean not null default false`.

`create_tournament` gains two optional params and inserts them:

```sql
create or replace function public.create_tournament(p_slug text, p_name text, p_starts_at timestamptz default null, p_venue text default null) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not_admin' using errcode = '42501'; end if;
  insert into public.tournaments (slug, name, starts_at, venue) values (p_slug, p_name, p_starts_at, nullif(p_venue, '')) returning id into new_id;
  insert into public.tournament_admins (tournament_id, user_id) values (new_id, auth.uid());
  return new_id;
end; $$;
revoke execute on function public.create_tournament(text, text, timestamptz, text) from public, anon;
grant execute on function public.create_tournament(text, text, timestamptz, text) to authenticated, service_role;
```

(Drop the old two-arg `revoke`/`grant` lines; Postgres identifies functions by signature.) Apply with `npx supabase db reset`.

- [ ] **Step 2: Types and mappers (with failing tests first)**

Add to `mappers.test.ts`:

```ts
describe('settingsFor', () => {
  const base = { games_per_match: 1, points_per_game: 15, win_by_two: false, max_points: null, time_cap_minutes: 13,
    ko_games_per_match: null, ko_points_per_game: null, ko_win_by_two: null, ko_max_points: null, ko_time_cap_minutes: null } as TournamentRow;
  it('uses pool values for pool and playoff, and falls back for knockout when ko_* are null', () => {
    const pool = { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 };
    expect(settingsFor(base, 'pool')).toEqual(pool);
    expect(settingsFor(base, 'playoff')).toEqual(pool);
    expect(settingsFor(base, 'knockout')).toEqual(pool);
  });
  it('uses ko_* for knockout when set', () => {
    const t = { ...base, ko_games_per_match: 3, ko_win_by_two: true, ko_max_points: 21, ko_time_cap_minutes: null } as TournamentRow;
    expect(settingsFor(t, 'knockout')).toEqual({ gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: null });
  });
});
```

Note: with per-column fallback, a knockout with "no clock" while the pool has one needs `ko_time_cap_minutes` to be distinguishable from "same as pool". Use the sentinel `0` stored in `ko_time_cap_minutes` to mean "no clock" (the DB check must then be `ko_time_cap_minutes is null or ko_time_cap_minutes >= 0`), and `settingsFor` maps `0 → null`. Update the migration check accordingly and add a test: `ko_time_cap_minutes: 0` → `timeCapMinutes: null`.

Implement in `mappers.ts`:

```ts
export function settingsFor(t: TournamentRow, stage: Stage): Settings {
  const pool: Settings = { gamesPerMatch: t.games_per_match, pointsPerGame: t.points_per_game, winByTwo: t.win_by_two, maxPoints: t.max_points, timeCapMinutes: t.time_cap_minutes };
  if (stage !== 'knockout') return pool;
  return {
    gamesPerMatch: t.ko_games_per_match ?? pool.gamesPerMatch,
    pointsPerGame: t.ko_points_per_game ?? pool.pointsPerGame,
    winByTwo: t.ko_win_by_two ?? pool.winByTwo,
    maxPoints: t.ko_max_points ?? pool.maxPoints,
    timeCapMinutes: t.ko_time_cap_minutes === null ? pool.timeCapMinutes : t.ko_time_cap_minutes === 0 ? null : t.ko_time_cap_minutes,
  };
}
```

Update `rowToMatch` (`decidedBy: r.decided_by`), `matchToRow` (`decided_by: m.decidedBy`), `rowToGame` (`timeExpired: r.time_expired`), the round-trip test fixture, and the row types as listed in Interfaces. Replace every `settingsFromTournament(t)` call: `enterResult`/`confirmSubmission`/`applySubmission` use the match's stage (`settingsFor(t, rowToMatch(row).stage)`); the Matches admin page and the team page compute settings per card (`settingsFor(t, m.stage)`).

- [ ] **Step 3: Settings form (failing tests first)**

Replace `settingsForm.test.ts` expectations with the new field names; keep `slugify` tests. Key cases: pool-only with `ko_same` on → `knockout: null`; `ko_same` off with `ko_timeCap` blank → knockout `timeCapMinutes: null` (stored as `0`); invalid pool cap; `startsAt` `'2026-10-03T19:00'` → ISO string via `new Date(...).toISOString()`; blank → null; venue trimmed and ≤ 120.

Implement `parseSettingsForm`:

```ts
export interface SettingsInput {
  pool: Settings;
  /** null = same as pool */
  knockout: Settings | null;
  courtCount: number;
  advancePerPool: number;
  startsAt: string | null;
  venue: string;
}

function stageSettings(fd: FormData, prefix: 'pool' | 'ko'): Settings {
  const cap = String(fd.get(`${prefix}_maxPoints`) ?? '').trim();
  const clock = String(fd.get(`${prefix}_timeCap`) ?? '').trim();
  return {
    gamesPerMatch: int(fd, `${prefix}_gamesPerMatch`),
    pointsPerGame: int(fd, `${prefix}_pointsPerGame`),
    winByTwo: fd.get(`${prefix}_winByTwo`) !== null,
    maxPoints: cap === '' ? null : Number(cap),
    timeCapMinutes: clock === '' ? null : Number(clock),
  };
}

export function parseSettingsForm(fd: FormData): { ok: true; value: SettingsInput } | { ok: false; problems: string[] } {
  const pool = stageSettings(fd, 'pool');
  const knockout = fd.get('ko_same') !== null ? null : stageSettings(fd, 'ko');
  const rawStart = String(fd.get('startsAt') ?? '').trim();
  const startsAt = rawStart === '' ? null : new Date(rawStart).toISOString();
  const venue = String(fd.get('venue') ?? '').trim();
  const value: SettingsInput = { pool, knockout, courtCount: int(fd, 'courtCount'), advancePerPool: int(fd, 'advancePerPool'), startsAt, venue };
  const problems = validateSettings(pool).map((p) => `pool: ${p}`);
  if (knockout) problems.push(...validateSettings(knockout).map((p) => `knockout: ${p}`));
  if (rawStart !== '' && Number.isNaN(Date.parse(rawStart))) problems.push('start date/time is not valid');
  if (venue.length > 120) problems.push('venue must be at most 120 characters');
  if (!Number.isInteger(value.courtCount) || value.courtCount < 1 || value.courtCount > 50) problems.push('courtCount must be between 1 and 50');
  if (!Number.isInteger(value.advancePerPool) || value.advancePerPool < 1 || value.advancePerPool > 8) problems.push('advancePerPool must be between 1 and 8');
  return problems.length ? { ok: false, problems } : { ok: true, value };
}
```

- [ ] **Step 4: Actions and pages**

`updateSettings` writes: pool columns, `time_cap_minutes`, `ko_*` (all null when `knockout` is null; `ko_time_cap_minutes: knockout.timeCapMinutes ?? 0` otherwise), `court_count`, `advance_per_pool`, `starts_at`, `venue`. Allow `starts_at`/`venue` changes in any status; the rest only in `setup` (two update paths, or one update with the locked fields omitted when not in setup).

`createTournament`: read `startsAt` (blank → null, else ISO) and `venue`; pass `p_starts_at`, `p_venue` to the RPC. Admin home form gains `<input name="startsAt" type="datetime-local">` and `<input name="venue">`.

Setup page settings section: two fieldsets, "Pool stage" and "Knockout stage" (with a `ko_same` checkbox defaulting to checked when all `ko_*` are null; the knockout inputs are shown regardless, prefilled from ko or pool values), plus "Event" fields `startsAt` (prefill `t.starts_at` converted to `YYYY-MM-DDTHH:mm` local) and `venue`. Labels: "Games per match", "Points per game", "Points cap (blank = none)", "Clock minutes per game (blank = no clock)", "Win by two".

Public layout header: under the name, when `starts_at` or `venue` is set, render `new Date(t.starts_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })` and `· {venue}`.

- [ ] **Step 5: Verify and commit**

```bash
npx supabase db reset
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
git add -A
git commit -m "feat(web): per-stage settings, club defaults, tournament date and venue, playoff/decided_by columns" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The existing e2e will fail its `2/6 played` and score expectations only if defaults changed match counts; they do not (a pool of 4 still has 6 matches), but games are now single (15-7 is a complete result; the second game 15-9 becomes "extra game after the match was decided"). Update both existing specs' `fillScores`/`playAllOpen` to enter only game 1 and drop the `game2*` fills; the `must win by two` hint check becomes a `winner must reach 15` check on `14-12`.

---

### Task 4: Inline result entry, time-expired boxes, Start now, court clock

**Files:**
- Modify: `apps/web/src/components/ScoreForm.tsx`, `apps/web/src/lib/results/form.ts`, `apps/web/src/lib/results/apply.ts` (+test), `apps/web/src/lib/results/persist.ts`, `apps/web/src/actions/matches.ts`, `apps/web/src/actions/participant.ts`, `apps/web/src/app/admin/[slug]/matches/page.tsx`, `apps/web/src/app/t/[slug]/team/page.tsx`, `apps/web/src/app/t/[slug]/page.tsx`, `apps/web/src/components/MatchCard.tsx`
- Create: `apps/web/src/components/CourtClock.tsx`

**Interfaces:**
- Produces:
  - `ScoreForm` props: `{ matchId; settings; existing: Game[]; teamA; teamB; submitLabel; confirmMessage?; action: (formData: FormData) => Promise<ActionResult<unknown>>; successText?: string }`. It is a client form that calls `action` inside `useTransition`, shows the returned error (or `successText`, default "Saved") inline under the buttons, keeps typed values, renders a "Time expired" checkbox per game (`game{n}x`) only when `settings.timeCapMinutes !== null`, and disables Save until `matchResult` says complete and valid. On success it calls `router.refresh()`.
  - `gamesFromForm(fd, maxGames)` reads `game{n}x` → `timeExpired: true`.
  - `planCourt(matches, matchId, court, courtCount, now: string)` sets `startedAt` on the returned object? No: `Match` has no `startedAt`; the action writes `started_at: now` when moving to `live` and `null` when leaving `live`. `startNow(slug, matchId, court?: number)`: picks `court ?? first free court` (1..court_count not used by a live match) → `assignCourt`.
  - `persist.ts` writes `decided_by` (from the plan: `'played'` for results, passed in by award/forfeit callers, see Task 5) and `time_expired` per game; sets `started_at: null` when the primary leaves live.
  - `<CourtClock startedAt capMinutes />` client component: mm:ss remaining, red and "TIME" when ≤ 0; ticks every second.
  - `MatchCard` shows the clock for live matches when both props are available, and the tagline under each team name.

- [ ] **Step 1: Tests for the pure bits**

`apps/web/src/lib/results/form.test.ts` (new):

```ts
import { describe, it, expect } from 'vitest';
import { gamesFromForm } from './form';
const fd = (e: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };
describe('gamesFromForm', () => {
  it('reads scores and the time-expired flag, stopping at the first blank pair', () => {
    expect(gamesFromForm(fd({ game1a: '11', game1b: '8', game1x: 'on', game2a: '', game2b: '' }), 3)).toEqual([{ gameNo: 1, scoreA: 11, scoreB: 8, timeExpired: true }]);
    expect(gamesFromForm(fd({ game1a: '15', game1b: '9' }), 1)).toEqual([{ gameNo: 1, scoreA: 15, scoreB: 9, timeExpired: false }]);
  });
});
```

`apply.test.ts`: existing `planResult` tests use `BADMINTON_DEFAULTS` with two games; switch them to `CLASSIC_BEST_OF_THREE` and add one club case: single time-expired game `10-7` with `BADMINTON_DEFAULTS` completes the match.

- [ ] **Step 2: Implement form parsing, ScoreForm, CourtClock**

`form.ts`: `games.push({ gameNo: n, scoreA: Number(a), scoreB: Number(b), timeExpired: formData.get(\`game${n}x\`) !== null });`

`ScoreForm.tsx`:

```tsx
'use client';
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { gamesNeeded, matchResult, validateGame, type Settings, type Game } from '@tournament/core';
import type { ActionResult } from '@/actions/errors';

export function ScoreForm({ matchId, settings, existing, teamA, teamB, action, submitLabel, confirmMessage, successText = 'Saved' }: {
  matchId: string; settings: Settings; existing: Game[]; teamA: string; teamB: string;
  action: (formData: FormData) => Promise<ActionResult<unknown>>; submitLabel: string; confirmMessage?: string; successText?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = Array.from({ length: settings.gamesPerMatch }, (_, i) => i + 1);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const g of existing) { v[`game${g.gameNo}a`] = String(g.scoreA); v[`game${g.gameNo}b`] = String(g.scoreB); if (g.timeExpired) v[`game${g.gameNo}x`] = 'on'; }
    return v;
  });
  const games: Game[] = [];
  for (const n of rows) {
    const a = vals[`game${n}a`] ?? '', b = vals[`game${n}b`] ?? '';
    if (a === '' && b === '') break;
    games.push({ gameNo: n, scoreA: Number(a), scoreB: Number(b), timeExpired: vals[`game${n}x`] === 'on' });
  }
  const hints = rows.map((n) => {
    const g = games.find((x) => x.gameNo === n);
    if (!g) return '';
    const v = validateGame(settings, g.scoreA, g.scoreB, g.timeExpired ?? false);
    return v.ok ? (v.winner === 'a' ? `${teamA} won` : `${teamB} won`) : v.reason;
  });
  const result = matchResult(settings, games);
  const ready = result.ok && result.complete;
  const status = !result.ok ? result.reason : result.complete ? (result.winner === 'a' ? `${teamA} wins the match` : `${teamB} wins the match`) : `${result.gamesA}-${result.gamesB} in games · need ${gamesNeeded(settings)}`;

  return (
    <form
      action={(fd) => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        start(async () => {
          const r = await action(fd);
          setOutcome(r.ok ? { ok: true, text: successText } : { ok: false, text: r.message ?? r.error });
          if (r.ok) router.refresh();
        });
      }}
      data-testid="score-form"
      className="space-y-2 text-sm"
    >
      <input type="hidden" name="matchId" value={matchId} />
      <div className={`grid items-center gap-2 ${settings.timeCapMinutes !== null ? 'grid-cols-[auto_1fr_1fr_auto_2fr]' : 'grid-cols-[auto_1fr_1fr_2fr]'}`}>
        <span /><span className="truncate font-medium">{teamA}</span><span className="truncate font-medium">{teamB}</span>
        {settings.timeCapMinutes !== null && <span className="text-xs text-slate-500">Time up</span>}<span />
        {rows.map((n, i) => (
          <Fragment key={n}>
            <span className="text-slate-500">Game {n}</span>
            <input name={`game${n}a`} inputMode="numeric" value={vals[`game${n}a`] ?? ''} onChange={(e) => setVals({ ...vals, [`game${n}a`]: e.target.value })} className="w-16 rounded border p-1" />
            <input name={`game${n}b`} inputMode="numeric" value={vals[`game${n}b`] ?? ''} onChange={(e) => setVals({ ...vals, [`game${n}b`]: e.target.value })} className="w-16 rounded border p-1" />
            {settings.timeCapMinutes !== null && (
              <input type="checkbox" name={`game${n}x`} checked={vals[`game${n}x`] === 'on'} onChange={(e) => setVals({ ...vals, [`game${n}x`]: e.target.checked ? 'on' : '' })} title="Clock ran out; highest score wins" />
            )}
            <span className="text-xs text-slate-500">{hints[i]}</span>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={!ready || pending} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40">{pending ? 'Saving…' : submitLabel}</button>
        <span className="text-xs text-slate-600">{status}</span>
        {outcome && <span data-testid="score-outcome" className={`text-xs ${outcome.ok ? 'text-emerald-700' : 'text-red-700'}`}>{outcome.text}</span>}
      </div>
    </form>
  );
}
```

`CourtClock.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

export function CourtClock({ startedAt, capMinutes }: { startedAt: string; capMinutes: number }) {
  const end = new Date(startedAt).getTime() + capMinutes * 60_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.round((end - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
  return <span data-testid="court-clock" className={`rounded px-1.5 font-mono text-xs ${left === 0 ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>{left === 0 ? 'TIME' : `${mm}:${ss}`}</span>;
}
```

`MatchCard`: new optional props `startedAt?: string | null`, `capMinutes?: number | null`, `taglines?: boolean` (default true: render `t.tagline` in `text-[11px] text-slate-500` under the name when non-empty). Show `<CourtClock/>` in the header when `match.status === 'live' && startedAt && capMinutes`. Show a small label for `decidedBy !== 'played'` ("awarded" / "forfeit") next to the status.

- [ ] **Step 3: Actions**

`actions/matches.ts`:
- `assignCourt` writes `started_at: planned.status === 'live' ? new Date().toISOString() : null` alongside `court`/`status` (a live→live court move keeps the original: only set when transitioning from non-live).
- New `startNow(slug, matchId, court?: number | null)`: `requireAdmin`, load matches, `busy = new Set(live courts)`, `chosen = court ?? first 1..court_count not in busy`; if none free → `fail('invalid_input', 'All courts are busy')`; then the same conditional update as `assignCourt` (call it).
- `enterResult` uses `settingsFor(ctx.tournament, rowToMatch(row).stage)`; pass `decidedBy: 'played'` to the plan (see persist).
- Export a form-friendly wrapper used by the page: `enterResultForm(slug, formData)` returning `ActionResult` (parses `matchId` and games with the match's stage settings); the page passes `action={enterResultForm.bind(null, slug)}` to `ScoreForm`. (`bind` on a server action with a string is serializable.)

`persist.ts`: the primary claim update also sets `decided_by: input.decidedBy ?? 'played'` and `started_at: null`; game inserts include `time_expired: g.timeExpired ?? false`; `ResultPlan`/`applyResultPlan` input gains optional `decidedBy`.

`actions/participant.ts` `submitScores`: settings by match stage; `applySubmission` likewise (pass `settings` in from the caller).

- [ ] **Step 4: Pages**

Admin Matches page: replace the court form with a "Start now" button (`startNow` with no court) plus a small court `<select>` (name `court`, default blank = auto) and, for live matches, "Move" and "Take off court" buttons; pass `startedAt={row.started_at}` and `capMinutes={settingsFor(t, m.stage).timeCapMinutes}` to `MatchCard` (keep the raw rows alongside the mapped matches to read `started_at`). `ScoreForm` gets `action={enterResultForm.bind(null, slug)}` and `successText="Result saved"`; drop the inline `score` action and its redirect. Live page and team page: pass `startedAt`/`capMinutes` to cards; team page `ScoreForm` gets `action={submitScoresForm.bind(null, slug)}` (a form-friendly wrapper of `submitScores`) with `successText` computed server-side? The outcome differs (submitted/confirmed/disputed): have `submitScoresForm` return `ok({ outcome, text })` and make `ScoreForm` show `r.data.text` when present (`typeof r.data === 'object' && r.data && 'text' in r.data`).

- [ ] **Step 5: e2e adjustments and commit**

Both existing specs: assertions `Result saved`/`Scores submitted…` now appear inline in `[data-testid="score-outcome"]` (no URL change); the `Court updated` step becomes clicking "Start now" and expecting `Court 1 · live`; scores are single games. Run:

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
npx kill-port 3100
npm run e2e -w @tournament/web
git add -A
git commit -m "feat(web): inline result entry with time-expired games, Start now, court clock, taglines on cards" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Admin overrides: award match, withdraw team, replace bracket team, playoff, manual pool order

**Files:**
- Create: `apps/web/src/lib/standings/compute.ts`, `apps/web/src/lib/standings/compute.test.ts`
- Modify: `apps/web/src/lib/results/apply.ts` (+test: `planAward`), `apps/web/src/actions/matches.ts`, `apps/web/src/actions/teams.ts`, `apps/web/src/actions/pools.ts`, `apps/web/src/actions/bracket.ts` (planKnockout consumes computed rows), `apps/web/src/lib/bracket/plan.ts` (+test), `apps/web/src/app/admin/[slug]/matches/page.tsx`, `apps/web/src/app/admin/[slug]/pools/page.tsx`, `apps/web/src/app/admin/[slug]/bracket/page.tsx`, `apps/web/src/components/TeamsAdmin.tsx`

**Interfaces:**
- Produces:
  - `computePool(input: { pool: PoolRow; teams: TeamRow[]; matches: Match[]; games: Record<string, Game[]>; advancePerPool: number }): { rows: StandingRow[]; ties: UnresolvedTie[]; manual: boolean; playoffs: Match[] }` — filters this pool's teams (excluding none; withdrawn teams stay in the table) and matches (pool + playoff with this `poolId`), builds `manualOrder` from `pool_rank_override` (ascending, only teams with a value) when at least one team has it, calls `poolStandings`, then `unresolvedTies`.
  - `planAward(input: { matches: Match[]; matchId: string; winnerId: string }): ResultPlan | { error: 'match_not_editable'; message }` — like `planResult` without games: rollback if the winner changes on a done match, then advance; `gamesToWrite: []`; `decidedBy` set by the caller.
  - Actions: `awardMatch(slug, matchId, winnerId, kind: 'awarded' | 'forfeit' = 'awarded')`; `withdrawTeam(slug, teamId)` (sets `withdrawn`, then for every match of the team with status in `ready|live|submitted|disputed` and both teams known → `awardMatch(..., opponent, 'forfeit')`); `reinstateTeam(slug, teamId)` (clears the flag only); `replaceTeamInMatch(slug, matchId, side, teamId)` (knockout match, status not `done`, target team in this tournament; if the match becomes fully populated → `ready`); `createPlayoff(slug, poolId, teamXId, teamYId)` (inserts a `playoff` match, `slot = 100 + count`, status `ready`); `setManualOrder(slug, poolId, orderedTeamIds)` (writes `pool_rank_override = index+1` for the pool's teams; validates it is a permutation of the pool's team ids); `clearManualOrder(slug, poolId)`.
  - `planKnockout` takes `poolResults` already computed by `computePool` (ranked ids), so manual order and playoffs feed the bracket; it still refuses while unresolved ties touch the qualification line unless the pool has a manual order.

- [ ] **Step 1: Tests**

`compute.test.ts`: (a) a pool with a manual order returns `manual: true`, rows in that order, `ties: []`; (b) a two-way 2nd/3rd tie with no playoff returns one `qualification` tie; (c) after a playoff match (stage `playoff`, `poolId`) between them is done, `ties` is empty and the playoff winner is 2nd; (d) knockout matches for the same teams are ignored.

`apply.test.ts` `planAward`: awarding a ready match sets it done with the winner and fills the next match; awarding a done match to the other team rolls back downstream (`clearGamesFor` includes the dependent done match) and `gamesToWrite` is empty; awarding to a team not in the match errors.

`bracket/plan.test.ts`: `planKnockout` now takes `poolResults: { poolId: string; name: string; ranked: string[]; unresolved: boolean }[]` and errors with "Pool A has an unresolved tie on the qualification line; record a playoff or set the order manually" when `unresolved` is true; existing pairing tests adapt by passing precomputed `ranked` arrays.

- [ ] **Step 2: Implement the pure pieces**

`lib/standings/compute.ts`:

```ts
import { poolStandings, unresolvedTies, type Game, type Match, type StandingRow, type UnresolvedTie } from '@tournament/core';
import type { PoolRow, TeamRow } from '@/lib/db/types';
import { teamRefs } from '@/lib/db/mappers';

export interface PoolComputation { rows: StandingRow[]; ties: UnresolvedTie[]; manual: boolean; playoffs: Match[] }

export function computePool(input: { pool: PoolRow; teams: TeamRow[]; matches: Match[]; games: Record<string, Game[]>; advancePerPool: number }): PoolComputation {
  const teams = input.teams.filter((t) => t.pool_id === input.pool.id);
  const matches = input.matches.filter((m) => m.poolId === input.pool.id && (m.stage === 'pool' || m.stage === 'playoff'));
  const overridden = teams.filter((t) => t.pool_rank_override !== null).sort((a, b) => a.pool_rank_override! - b.pool_rank_override!);
  const manual = overridden.length > 0;
  const rows = poolStandings(teamRefs(teams), matches, input.games, manual ? { manualOrder: overridden.map((t) => t.id) } : {});
  return { rows, ties: manual ? [] : unresolvedTies(rows, input.advancePerPool), manual, playoffs: matches.filter((m) => m.stage === 'playoff') };
}
```

`planAward` in `apply.ts`:

```ts
export function planAward(input: { matches: Match[]; matchId: string; winnerId: string }): ResultPlan | { error: 'match_not_editable'; message: string } {
  const match = input.matches.find((m) => m.id === input.matchId);
  if (!match || !match.teamAId || !match.teamBId || match.status === 'pending') return { error: 'match_not_editable', message: 'This match cannot be awarded yet' };
  if (input.winnerId !== match.teamAId && input.winnerId !== match.teamBId) return { error: 'match_not_editable', message: 'That team is not in this match' };
  let working = input.matches;
  let clearGamesFor: string[] = [];
  const touched = new Map<string, Match>();
  const applyChanges = (changed: Match[]) => { const byId = new Map(changed.map((m) => [m.id, m])); working = working.map((m) => byId.get(m.id) ?? m); for (const m of changed) touched.set(m.id, m); };
  if (match.status === 'done' && match.winnerId !== null && match.winnerId !== input.winnerId) { const rb = rollback(working, input.matchId); applyChanges(rb.changed); clearGamesFor = rb.resetMatchIds; }
  applyChanges(advance(working, input.matchId, input.winnerId));
  const completed = touched.get(input.matchId)!;
  const terminal = working.find((m) => m.stage === 'knockout' && m.nextMatchId === null);
  return { updates: [...touched.values()], gamesToWrite: [], clearGamesFor, winnerId: input.winnerId, tournamentFinished: completed.stage === 'knockout' && completed.nextMatchId === null, terminalStillDone: terminal !== undefined && terminal.status === 'done' };
}
```

(Refactor the shared rollback-then-advance block out of `planResult` into a private helper used by both.)

`lib/bracket/plan.ts`: `planKnockout({ pools: PoolResultInput[]; advancePerPool; newId })` where `PoolResultInput = { poolId; name; ranked: string[]; unresolved: boolean }`; error on `unresolved`; error on `ranked.length < advancePerPool`; then `buildBracket(pools.map(p => ({ poolId: p.poolId, ranked: p.ranked })), advancePerPool, newId)`. Withdrawn teams: exclude from `ranked` before slicing? No: a withdrawn team may still legitimately have qualified before withdrawing; the admin uses "replace team in bracket" if needed. Keep the computed order.

- [ ] **Step 3: Actions**

`awardMatch` in `actions/matches.ts`:

```ts
export async function awardMatch(slug: string, matchId: string, winnerId: string, kind: 'awarded' | 'forfeit' = 'awarded'): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (!['pools', 'knockout', 'finished'].includes(ctx.tournament.status)) return fail('stale_state', 'Tournament is not in play');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const plan = planAward({ matches: rows.map(rowToMatch), matchId, winnerId });
  if ('error' in plan) return fail(plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status, decidedBy: kind });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}
```

`withdrawTeam`/`reinstateTeam` in `actions/teams.ts` (withdraw: update flag with `.eq('tournament_id')`, then loop the team's open matches calling `awardMatch(slug, m.id, opponentId, 'forfeit')`, collecting failures into the message; pending matches with a null opponent are left). `replaceTeamInMatch` in `actions/bracket.ts` (guards: knockout, not done, team exists in tournament, not already in the other side; conditional update on previous side value; status `ready` when both sides set). `createPlayoff`, `setManualOrder`, `clearManualOrder` in `actions/pools.ts` (all `requireAdmin`; playoff only when status `pools`; manual order only when status `pools`).

`startKnockout` in `actions/bracket.ts` now builds `pools` via `computePool` per pool → `{ poolId, name, ranked: rows.map(r => r.teamId), unresolved: ties.some(t => t.affects === 'qualification') }`.

- [ ] **Step 4: Admin UI**

Pools page (status `pools`): for each pool render the standings via `computePool` with `StandingsTable`, a red box listing `ties` ("Birdies and Clears are tied for the last qualifying place") with a "Record men's doubles playoff" button (creates the playoff match, which then appears on the Matches page with label `Pool A · playoff`) and a "Set finishing order" form: one `<select name="rank_<teamId>">` per team with values 1..n, submit → `setManualOrder`; when `manual` show "Order set by organiser" and a "Clear manual order" button. Matches page: on every card with both teams known and status not `pending`, two small buttons "Award to <A>" / "Award to <B>" wrapped in `ConfirmButton`; label playoff matches; Needs-attention unchanged. Bracket page (status knockout): under each not-done match, a compact form: `<select name="side">a|b</select> <select name="teamId">all non-withdrawn teams</select> Replace`. TeamsAdmin: "Withdraw" (with confirm) / "Reinstate" per team, available in any status after setup too, greyed name when withdrawn.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
git add -A
git commit -m "feat(web): award/forfeit matches, withdraw teams, replace bracket teams, playoffs and manual pool order" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Public display: team points table, taglines, withdrawn and awarded states, playoffs

**Files:**
- Modify: `apps/web/src/components/StandingsTable.tsx`, `apps/web/src/components/Bracket.tsx`, `apps/web/src/components/MatchCard.tsx`, `apps/web/src/app/t/[slug]/pools/page.tsx`, `apps/web/src/app/t/[slug]/page.tsx`, `apps/web/src/app/t/[slug]/bracket/page.tsx`, `apps/web/src/app/t/[slug]/team/page.tsx`

**Interfaces:**
- `StandingsTable` columns: `#`, Team (colour dot, name, seed badge, tagline underneath, "withdrawn" pill when `withdrawn`), `P`, `W`, `Pts`, `±`; rows with `tieUnresolved` get a small "tie" pill; props gain `manual?: boolean` (renders "Order set by organiser" caption) and `ties?: UnresolvedTie[]` (renders a one-line note per tie under the table on the public page: "Tie for the last qualifying place to be decided").
- `Bracket` boxes: tagline line under the name (`text-[10px] text-slate-500`, truncated); awarded/forfeit label instead of scores when `decidedBy !== 'played'`.
- Public pools page uses `computePool` (same numbers as admin) and lists playoff matches under "Playoff" inside the pool's matches list. Live page: the "Latest results" cards show "awarded"/"forfeit" where applicable (already via `MatchCard`).
- Team page: withdrawn teams see a banner "Your team has been withdrawn by the organiser" and no score forms.

- [ ] **Step 1: Implement** the changes above (no new pure logic; all display). Keep `tr.bg-emerald-50` on qualifying rows (the e2e depends on it).

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm run build -w @tournament/web
git add -A
git commit -m "feat(web): points table with taglines, withdrawn/awarded states and playoffs on public pages" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Club-format end-to-end test and docs

**Files:**
- Create: `apps/web/e2e/club-format.spec.ts`
- Modify: `apps/web/README.md`, `packages/tournament-core/README.md`

**Interfaces:**
- Produces a spec proving: creation with date and venue shown on the public header; club defaults (single game, clock); Start now; the court clock visible; a time-expired result `10-7`; an invalid `14-12` blocked with the inline hint and a disabled Save button; an awarded match; a withdrawn team's remaining match forfeited; a 2nd/3rd tie flagged, a playoff recorded and the bracket starting; a team replaced in a bracket slot.

- [ ] **Step 1: Write the spec**

`apps/web/e2e/club-format.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `club-${Date.now().toString(36)}`;
// One pool of 4 -> 6 matches; we engineer a 2nd/3rd tie: A beats everyone; B beats C; C beats D; D beats B.
const teams = ['Alpha & Ana', 'Bravo & Bea', 'Charlie & Cho', 'Delta & Dee'];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Enter a single-game result on the open match between two named teams. */
async function enterResult(page: Page, a: string, b: string, sa: number, sb: number, timeUp = false) {
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const card = page.locator('div.rounded.border', { has: page.getByTestId('score-form') }).filter({ hasText: a }).filter({ hasText: b }).first();
  const form = card.getByTestId('score-form');
  // The form's column order is teamA then teamB; find which is which from the header labels.
  const headers = await form.locator('span.font-medium').allTextContents();
  const aIsFirst = headers[0]?.includes(a);
  await form.locator('input[name="game1a"]').fill(String(aIsFirst ? sa : sb));
  await form.locator('input[name="game1b"]').fill(String(aIsFirst ? sb : sa));
  if (timeUp) await form.locator('input[name="game1x"]').check();
  await form.getByRole('button', { name: /save result/i }).click();
  await expect(form.getByTestId('score-outcome')).toHaveText('Result saved');
}

test('club format: clock, time-expired results, awards, withdrawal, playoff, bracket replacement', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);

  // create with date and venue
  await page.fill('input[name="name"]', 'Club Night');
  await page.fill('input[name="slug"]', slug);
  await page.fill('input[name="startsAt"]', '2026-10-03T19:00');
  await page.fill('input[name="venue"]', 'Riverside Sports Hall');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await page.goto(`/t/${slug}`);
  await expect(page.getByText('Riverside Sports Hall')).toBeVisible();
  await expect(page.getByText(/2026/)).toBeVisible();

  // teams, one pool, lock
  await page.goto(`/admin/${slug}`);
  await page.fill('textarea[name="lines"]', teams.join('\n'));
  await page.getByRole('button', { name: 'Add teams' }).click();
  await expect(page.getByText('Added 4 team(s)')).toBeVisible();
  await page.goto(`/admin/${slug}/pools`);
  await page.fill('input[name="poolCount"]', '1');
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();

  // Start now on the first open match: clock appears on the public live board
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await page.getByRole('button', { name: 'Start now' }).first().click();
  await expect(page.getByTestId('court-clock').first()).toBeVisible();
  await page.goto(`/t/${slug}`);
  await expect(page.getByTestId('court-clock').first()).toHaveText(/\d\d:\d\d|TIME/);

  // invalid single game 14-12 keeps Save disabled and shows the reason
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const first = page.getByTestId('score-form').first();
  await first.locator('input[name="game1a"]').fill('14');
  await first.locator('input[name="game1b"]').fill('12');
  await expect(first.getByText('winner must reach 15')).toBeVisible();
  await expect(first.getByRole('button', { name: /save result/i })).toBeDisabled();

  // results: A beats all by 6; B beats C, C beats D (time expired 10-4), D beats B, each by 6.
  // B, C, D end on 1 point each with a circular head-to-head and identical -6 score difference.
  await enterResult(page, 'Alpha & Ana', 'Bravo & Bea', 15, 9);
  await enterResult(page, 'Alpha & Ana', 'Charlie & Cho', 15, 9);
  await enterResult(page, 'Alpha & Ana', 'Delta & Dee', 15, 9);
  await enterResult(page, 'Bravo & Bea', 'Charlie & Cho', 15, 9);
  await enterResult(page, 'Charlie & Cho', 'Delta & Dee', 10, 4, true);
  await enterResult(page, 'Delta & Dee', 'Bravo & Bea', 15, 9);
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await expect(page.getByText('Nothing here.')).toBeVisible();

  // unresolved three-way tie touching the qualification line
  await page.goto(`/admin/${slug}/pools`);
  await expect(page.getByText(/tied for the last qualifying place|tie on the qualification line/i)).toBeVisible();
  // knockout refuses until resolved
  await page.goto(`/admin/${slug}/bracket`);
  await expect(page.getByText(/unresolved tie/i)).toBeVisible();

  // set the order manually: A, C, B, D
  await page.goto(`/admin/${slug}/pools`);
  const order = { 'Alpha & Ana': '1', 'Charlie & Cho': '2', 'Bravo & Bea': '3', 'Delta & Dee': '4' } as const;
  for (const [name, rank] of Object.entries(order)) {
    const row = page.locator('tr', { hasText: name }).first();
    await row.locator('select').selectOption(rank);
  }
  await page.getByRole('button', { name: 'Set finishing order' }).click();
  await expect(page.getByText('Order set by organiser')).toBeVisible();
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText('Order set by organiser')).toBeVisible();
  await expect(page.locator('tr.bg-emerald-50')).toHaveCount(2);

  // start knockout (2 qualifiers -> a single final) and replace Charlie with Bravo in the final
  await page.goto(`/admin/${slug}/bracket`);
  await page.getByRole('button', { name: 'Start knockout with this bracket' }).click();
  await expect(page.getByText('Knockout started')).toBeVisible();
  const replace = page.locator('form', { has: page.locator('select[name="side"]') }).first();
  await replace.locator('select[name="side"]').selectOption('b');
  await replace.locator('select[name="teamId"]').selectOption({ label: 'Bravo & Bea' });
  await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Team replaced')).toBeVisible();
  await expect(page.getByText('Bravo & Bea')).toBeVisible();

  // withdraw Bravo: the final is forfeited to Alpha and the tournament finishes
  await page.goto(`/admin/${slug}`);
  const bravoRow = page.locator('tr', { hasText: 'Bravo & Bea' });
  await bravoRow.getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByText(/withdrawn/i).first()).toBeVisible();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Alpha & Ana/)).toBeVisible();
  await expect(page.getByText(/forfeit/i).first()).toBeVisible();

  // override the done final: award it to Bravo (organiser decision) -> champion changes, label "awarded"
  await page.goto(`/admin/${slug}/matches?filter=done`);
  const finalCard = page.locator('div.rounded.border', { has: page.getByTestId('score-form') }).filter({ hasText: 'Alpha & Ana' }).filter({ hasText: 'Bravo & Bea' }).first();
  await finalCard.getByRole('button', { name: 'Award to Bravo & Bea' }).click();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Bravo & Bea/)).toBeVisible();
  await expect(page.getByText(/awarded/i).first()).toBeVisible();
});
```

Selector notes for the implementer: buttons must be labelled exactly "Start now", "Award to <team name>", "Set finishing order", "Replace", "Withdraw"; success messages "Team replaced"; the pools tie note must contain "tied for the last qualifying place"; the bracket refusal text must contain "unresolved tie"; the manual-order selects live inside the standings rows (`<tr>`) of the admin table. If the real DOM differs, adjust the selectors and say so; do not weaken assertions.

- [ ] **Step 2: Run all three specs**

```bash
npx kill-port 3100
npm run e2e -w @tournament/web
```

Expected: `3 passed`.

- [ ] **Step 3: Docs**

`apps/web/README.md`: a "Formats" section describing per-stage settings, the clock and time-expired games, team points and tie order, playoffs and manual order, awards/forfeits/withdrawal, replace in bracket. `packages/tournament-core/README.md`: update rows for `validateGame`, `poolStandings` (options, points, tieUnresolved), add `unresolvedTies`, `CLASSIC_BEST_OF_THREE`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(web): club-format e2e (clock, time-expired, award, withdraw, playoff, replace); docs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for this plan

- Core and web unit/integration tests pass; typecheck and build pass; all three Playwright specs pass locally.
- A new tournament defaults to the club format (1 game to 15, win by one, 13-minute clock, 4 courts, top 2 per pool) and shows its date and venue publicly.
- Result entry never loses typed scores; invalid or incomplete results cannot be submitted; the reason is shown next to the form.
- Standings show team points and the agreed tie order; ties on the qualification line are flagged and resolvable by playoff or manual order; the knockout cannot start with an unresolved qualifying tie.
- Admins can award any match, withdraw and reinstate teams (forfeiting open matches), and replace a team in an unplayed bracket slot.
- Live matches show a countdown on the live board and admin screen; taglines appear under team names everywhere.

