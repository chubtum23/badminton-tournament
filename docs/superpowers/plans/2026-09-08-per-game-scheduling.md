# Three Labelled Games Per Meeting, Scheduled Individually (Plan 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A meeting between two teams becomes three labelled games (Mixed doubles #1, Mixed doubles #2, Men's doubles). All three are always played, the meeting goes to whoever wins more of them, and each game is sent to its own court with its own pausable thirteen minute clock. Live games appear in their own box above everything else on the admin Matches screen.

**Architecture:** The scheduling unit moves down one level, from the match to the game. Game rows are created empty when a match is created, and they carry `court`, `started_at`, `paused_at` and `paused_ms`; the match keeps only its identity, status, winner and `finished_at`. The rules package learns one new setting, `playAllGames`, which makes a match complete only when every game has a score. `liveBoard` leaves the rules package, because "what is on court" is now a question about games, and is rebuilt in the app where game rows are visible.

**Tech Stack:** unchanged (Next.js 15.5, React 19, Tailwind, Supabase, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md`. Section 11 is the v1.1 club format; this plan adds section 12 (v1.2) in Task 6, and amends 11.1 and 11.4.

## Global Constraints

- All earlier Global Constraints still apply (plans 2 to 4). Rules only in `@tournament/core`; the app never re-implements them. Typed action errors. Strict TypeScript. Tests import `describe`, `it`, `expect` explicitly from `vitest`.
- **A meeting is won by the team that wins more of its games.** Every game is always played, so the pool table's points difference sees all of them. A meeting win is worth one team point, unchanged.
- **Scheduling belongs to the game.** `games` carries `court`, `started_at`, `paused_at`, `paused_ms`. `matches` keeps `status`, `winner_id`, `decided_by`, `finished_at` and its links, and loses `court`, `started_at`, `paused_at`, `paused_ms`. `Match` in the rules package loses `court`.
- **Game rows exist before scores.** Creating a match creates one row per game slot with null scores, so a game can be scheduled before it is played.
- **Labels come from the tournament.** `tournaments.game_labels text[]`, defaulting to `Mixed doubles #1`, `Mixed doubles #2`, `Men's doubles`. Game `n` is labelled `game_labels[n]`, falling back to `Game n` when the array is shorter.
- New tournament defaults: `games_per_match 3`, `points_per_game 15`, `win_by_two false`, `max_points null`, `time_cap_minutes 13`, `play_all_games true`, `court_count 4`, `advance_per_pool 2`.
- **The initial migration is deployed and immutable.** Every schema change is a new file from `npx supabase migration new <name>`, applied locally with `npx supabase db reset` and to the hosted Sydney project with `npx supabase db push`.
- After `npx supabase db reset` the local admin is gone: run `npm run seed:admin -w @tournament/web` before any Playwright run.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. The repo's git identity is already `chubtum23`; never pass `-c user.name` / `-c user.email`.
- If integration tests fail with `JWT issued at future`, run `docker restart $(docker ps --format '{{.Names}}' | grep supabase_auth)`, wait a few seconds and re-run. It is a clock-skew flake, not a code fault.

---

## File structure

```
packages/tournament-core/src/
  types.ts            Settings.playAllGames; Match loses `court`
  scoring.ts (+test)  matchResult honours playAllGames; validateSettings
  liveBoard.ts        DELETED (moves to the app, which can see game rows)
  liveBoard.test.ts   DELETED
  index.ts, README.md
supabase/migrations/
  <new>_per_game_scheduling.sql   games gain scheduling + nullable scores; matches lose them;
                                  tournaments gain play_all_games and game_labels
apps/web/src/
  lib/db/types.ts         GameRow gains scheduling; MatchRow loses it; TournamentRow gains two
  lib/db/mappers.ts       settingsFor reads playAllGames; matchToRow drops the moved columns;
                          gameLabel(tournament, gameNo)
  lib/db/queries.ts       listGames returns the new columns; gameSlotsByMatch
  lib/schedule/board.ts (+test)   nowPlaying / upNext over game slots — replaces core liveBoard
  lib/schedule/plan.ts (+test)    planGameCourt: which court a game may go to
  lib/results/persist.ts  writes game scores in place; rollback clears slots, never deletes rows
  lib/results/apply.ts    planCourt DELETED (superseded by planGameCourt)
  lib/tournaments/settingsForm.ts (+test)  playAllGames and the per-game labels
  actions/games.ts        startGame, pauseGame, resumeGame, takeGameOffCourt, saveGameScore
  actions/matches.ts      loses assignCourt/startNow/pauseMatch/resumeMatch/enterResultForm
  actions/pools.ts, actions/bracket.ts   create game slots alongside matches
  components/GameRow.tsx  one game slot: label, score or controls, clock
  components/NowPlaying.tsx   the box above everything on the admin Matches screen
  components/MatchCard.tsx    shows each game's label and score
  components/ScoreForm.tsx    DELETED (score entry is per game now)
  components/GameScoreForm.tsx  one game's two boxes, time-expired tick, Save
  app/admin/[slug]/matches/page.tsx   Now playing box, then the meetings
  app/t/[slug]/page.tsx, pools/page.tsx, bracket/page.tsx, team/page.tsx   per-game display
  e2e/*.spec.ts           three games per meeting
```

---

### Task 1: Rules package: `playAllGames`, and scheduling leaves `Match`

**Files:**
- Modify: `packages/tournament-core/src/types.ts`, `scoring.ts`, `scoring.test.ts`, `index.ts`, `README.md`
- Modify (fixtures only): `testUtils.ts`, `pools.ts`, `bracket.ts`, `advance.ts`, and every `*.test.ts` that builds a `Match`
- Delete: `packages/tournament-core/src/liveBoard.ts`, `packages/tournament-core/src/liveBoard.test.ts`

**Interfaces:**
- Produces:
  - `Settings` gains `playAllGames: boolean`. `BADMINTON_DEFAULTS = { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13, playAllGames: true }`. `CLASSIC_BEST_OF_THREE` keeps its values and gains `playAllGames: false`.
  - `Match` no longer has `court`.
  - `matchResult(s, games)` when `s.playAllGames` is true: every game is validated as now; the match is complete only when `games.length === s.gamesPerMatch`; the winner is the side with more game wins; more than `gamesPerMatch` games is still an error. When false, the current majority behaviour is unchanged.
  - `validateSettings` additionally rejects an even `gamesPerMatch` when `playAllGames` is true, with `playAllGames needs an odd gamesPerMatch so a meeting cannot be drawn`.
  - `liveBoard` and `LiveBoard` are gone from the package's exports.

- [ ] **Step 1: Failing tests**

Append to `packages/tournament-core/src/scoring.test.ts`:

```ts
describe('playAllGames', () => {
  const club: Settings = { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13, playAllGames: true };
  const g = (gameNo: number, scoreA: number, scoreB: number) => ({ gameNo, scoreA, scoreB });

  it('is incomplete at two games to nil, because the third is still played', () => {
    expect(matchResult(club, [g(1, 15, 9), g(2, 15, 7)])).toEqual({ ok: true, complete: false, winner: null, gamesA: 2, gamesB: 0 });
  });

  it('accepts the dead third game and keeps the winner', () => {
    expect(matchResult(club, [g(1, 15, 9), g(2, 15, 7), g(3, 4, 15)])).toEqual({ ok: true, complete: true, winner: 'a', gamesA: 2, gamesB: 1 });
  });

  it('decides a meeting won two games to one', () => {
    expect(matchResult(club, [g(1, 15, 9), g(2, 7, 15), g(3, 15, 12)])).toMatchObject({ complete: true, winner: 'a', gamesA: 2, gamesB: 1 });
  });

  it('still refuses more games than the meeting has', () => {
    expect(matchResult(club, [g(1, 15, 9), g(2, 15, 7), g(3, 4, 15), g(4, 15, 1)])).toEqual({ ok: false, reason: 'expected 3 games but got 4' });
  });

  it('leaves the majority rule alone when playAllGames is off', () => {
    expect(matchResult(CLASSIC_BEST_OF_THREE, [g(1, 15, 9), g(2, 15, 7)])).toMatchObject({ complete: true, winner: 'a' });
    expect(matchResult(CLASSIC_BEST_OF_THREE, [g(1, 15, 9), g(2, 15, 7), g(3, 4, 15)])).toEqual({ ok: false, reason: 'extra game after the match was decided' });
  });

  it('validateSettings rejects an even game count when all games are played', () => {
    expect(validateSettings({ ...club, gamesPerMatch: 2 })).toEqual([
      'gamesPerMatch must be a positive odd integer',
      'playAllGames needs an odd gamesPerMatch so a meeting cannot be drawn',
    ]);
    expect(validateSettings(club)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -w @tournament/core -- src/scoring.test.ts
```

Expected: type errors on the missing `playAllGames`, then assertion failures.

- [ ] **Step 3: Implement**

`types.ts`: add to `Settings`

```ts
  /** Every game is played even once the meeting is decided, so all scores count. */
  playAllGames: boolean;
```

and set `BADMINTON_DEFAULTS = { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13, playAllGames: true }`, `CLASSIC_BEST_OF_THREE = { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: null, playAllGames: false }`. Remove `court` from `Match`.

`scoring.ts`, in `matchResult`, replace the decided-match guard and the final verdict:

```ts
  for (let i = 0; i < ordered.length; i++) {
    const game = ordered[i]!;
    if (game.gameNo !== i + 1) {
      return { ok: false, reason: `expected game ${i + 1} but got game ${game.gameNo}` };
    }
    if (s.playAllGames) {
      if (i >= s.gamesPerMatch) return { ok: false, reason: `expected ${s.gamesPerMatch} games but got ${ordered.length}` };
    } else if (gamesA >= needed || gamesB >= needed) {
      return { ok: false, reason: 'extra game after the match was decided' };
    }
    const v = validateGame(s, game.scoreA, game.scoreB, game.timeExpired ?? false);
    if (!v.ok) return { ok: false, reason: `game ${game.gameNo}: ${v.reason}` };
    if (v.winner === 'a') gamesA++;
    else gamesB++;
  }

  if (s.playAllGames) {
    // Every game is played, so the meeting is only over when the last score is in and it
    // goes to whoever won more of them. An odd gamesPerMatch makes a draw impossible.
    const complete = ordered.length === s.gamesPerMatch;
    const winner: Side | null = !complete ? null : gamesA > gamesB ? 'a' : 'b';
    return { ok: true, complete, winner, gamesA, gamesB };
  }
  const winner: Side | null = gamesA >= needed ? 'a' : gamesB >= needed ? 'b' : null;
  return { ok: true, complete: winner !== null, winner, gamesA, gamesB };
```

`validateSettings`: append

```ts
  if (s.playAllGames && Number.isInteger(s.gamesPerMatch) && s.gamesPerMatch % 2 === 0) {
    problems.push('playAllGames needs an odd gamesPerMatch so a meeting cannot be drawn');
  }
```

Delete `liveBoard.ts` and `liveBoard.test.ts`, and remove the `export * from './liveBoard';` line from `index.ts`. Remove `court` from every `Match` literal (`testUtils.makeMatch`, `pools.poolMatches`, `bracket.buildBracket`) and from any test fixture or assertion that mentions it. Update `README.md`: document `playAllGames`, drop the `liveBoard` row, and note that court and clock now belong to a game and live in the application.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @tournament/core
npm run typecheck -w @tournament/core
git add -A
git commit -m "feat(core): play every game in a meeting; scheduling leaves Match" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: the whole core suite green. `apps/web` will not compile until Task 3; that is expected.

---

### Task 2: Migration, row types and game slots

**Files:**
- Create: `supabase/migrations/<timestamp>_per_game_scheduling.sql` via `npx supabase migration new per_game_scheduling`
- Modify: `apps/web/src/lib/db/types.ts`, `apps/web/src/lib/db/mappers.ts` (+ `mappers.test.ts`), `apps/web/src/lib/db/queries.ts`, `apps/web/src/lib/tournaments/settingsForm.ts` (+ test), `apps/web/src/actions/tournaments.ts`, `apps/web/src/app/admin/[slug]/page.tsx`, `apps/web/src/actions/pools.ts`, `apps/web/src/actions/bracket.ts`

**Interfaces:**
- Produces:
  - `GameRow { match_id; game_no; score_a: number | null; score_b: number | null; time_expired: boolean; court: number | null; started_at: string | null; paused_at: string | null; paused_ms: number }`
  - `MatchRow` loses `court`, `started_at`, `paused_at`, `paused_ms`; keeps `finished_at`.
  - `TournamentRow` gains `play_all_games: boolean` and `game_labels: string[]`.
  - `settingsFor(t, stage)` returns the extra `playAllGames` (pool value; there is no knockout override).
  - `gameLabel(t: TournamentRow, gameNo: number): string` — `t.game_labels[gameNo - 1] ?? \`Game ${gameNo}\``.
  - `matchToRow` returns `Omit<MatchRow, 'finished_at'>`.
  - `slotRowsFor(matchId: string, gamesPerMatch: number): Pick<GameRow, 'match_id' | 'game_no'>[]` in `mappers.ts`, used wherever matches are created.
  - `gameSlotsByMatch(rows: readonly GameRow[]): Record<string, GameRow[]>` in `queries.ts`, sorted by `game_no`, replacing `gamesByMatch` for display. `gamesByMatch` stays but returns only *scored* games as core `Game[]`, because that is what the rules package consumes.

- [ ] **Step 1: Write the migration**

```sql
-- Scheduling moves from the meeting down to the individual game: each game goes to its own
-- court and runs its own clock. A game row now exists from the moment its match is created,
-- so it can be scheduled before anyone has played it, which is why the scores are nullable.
alter table public.games
  alter column score_a drop not null,
  alter column score_b drop not null,
  add column court int,
  add column started_at timestamptz,
  add column paused_at timestamptz,
  add column paused_ms bigint not null default 0 check (paused_ms >= 0);

alter table public.matches
  drop column court,
  drop column started_at,
  drop column paused_at,
  drop column paused_ms;

alter table public.tournaments
  add column play_all_games boolean not null default true,
  add column game_labels text[] not null default array['Mixed doubles #1', 'Mixed doubles #2', 'Men''s doubles'],
  alter column games_per_match set default 3;

-- Give every match that already exists its full set of game slots.
insert into public.games (match_id, game_no)
select m.id, s.n
from public.matches m
join public.tournaments t on t.id = m.tournament_id
cross join lateral generate_series(1, t.games_per_match) as s(n)
on conflict (match_id, game_no) do nothing;
```

Apply and verify:

```bash
npx supabase db reset
npx supabase db push
npx supabase migration list
```

Expected: three migrations, each present locally and remotely.

- [ ] **Step 2: Row types, mappers and the label helper (failing tests first)**

Add to `apps/web/src/lib/db/mappers.test.ts`:

```ts
describe('gameLabel', () => {
  const t = { game_labels: ['Mixed doubles #1', 'Mixed doubles #2', "Men's doubles"] } as TournamentRow;
  it('names each game from the tournament', () => {
    expect(gameLabel(t, 1)).toBe('Mixed doubles #1');
    expect(gameLabel(t, 3)).toBe("Men's doubles");
  });
  it('falls back when the list is shorter than the match', () => {
    expect(gameLabel({ game_labels: [] } as unknown as TournamentRow, 2)).toBe('Game 2');
  });
});

describe('slotRowsFor', () => {
  it('makes one empty slot per game', () => {
    expect(slotRowsFor('m1', 3)).toEqual([
      { match_id: 'm1', game_no: 1 }, { match_id: 'm1', game_no: 2 }, { match_id: 'm1', game_no: 3 },
    ]);
  });
});
```

Also extend the existing `settingsFor` test to assert `playAllGames` comes through, and update the `matchToRow` round-trip fixture for the removed columns.

- [ ] **Step 3: Implement the types and mappers**

Update `GameRow`, `MatchRow`, `TournamentRow` as in Interfaces. In `mappers.ts`:

```ts
export function gameLabel(t: Pick<TournamentRow, 'game_labels'>, gameNo: number): string {
  return t.game_labels[gameNo - 1] ?? `Game ${gameNo}`;
}

export function slotRowsFor(matchId: string, gamesPerMatch: number): { match_id: string; game_no: number }[] {
  return Array.from({ length: gamesPerMatch }, (_, i) => ({ match_id: matchId, game_no: i + 1 }));
}
```

Add `playAllGames: t.play_all_games` to both branches of `settingsFor`. Drop the moved columns from `matchToRow` and `rowToMatch`. `rowToGame` keeps mapping only scored games; make it take a row whose scores are non-null and have `gamesByMatch` skip rows where either score is null:

```ts
export function gamesByMatch(rows: readonly GameRow[]): Record<string, Game[]> {
  const out: Record<string, Game[]> = {};
  for (const r of rows) {
    if (r.score_a === null || r.score_b === null) continue; // an unplayed slot is not a game yet
    (out[r.match_id] ??= []).push({ gameNo: r.game_no, scoreA: r.score_a, scoreB: r.score_b, timeExpired: r.time_expired });
  }
  for (const list of Object.values(out)) list.sort((x, y) => x.gameNo - y.gameNo);
  return out;
}
```

In `queries.ts` add the new columns to the `listGames` select and add:

```ts
export function gameSlotsByMatch(rows: readonly GameRow[]): Record<string, GameRow[]> {
  const out: Record<string, GameRow[]> = {};
  for (const r of rows) (out[r.match_id] ??= []).push(r);
  for (const list of Object.values(out)) list.sort((x, y) => x.game_no - y.game_no);
  return out;
}
```

- [ ] **Step 4: Create slots wherever matches are created**

In `actions/pools.ts` `lockPools`, after the matches insert succeeds:

```ts
  const slots = matches.flatMap((m) => slotRowsFor(m.id, settingsFor(ctx.tournament, 'pool').gamesPerMatch));
  const insSlots = await ctx.sb.from('games').insert(slots);
  if (insSlots.error) return fail('invalid_input', insSlots.error.message);
```

Do the same in `actions/bracket.ts` `startKnockout` (using `settingsFor(t, 'knockout').gamesPerMatch`, inserting the slots after each round's matches are inserted) and in `actions/pools.ts` `createPlayoff` (using the pool settings). Read each function first; keep their existing claim-then-write ordering.

- [ ] **Step 5: Settings form and page**

`settingsForm.ts`: `SettingsInput.pool` and `.knockout` now carry `playAllGames`. Read it from a checkbox named `pool_playAllGames` (knockout inherits the pool value; do not add a knockout control). Add `labels: string[]` to `SettingsInput`, read from fields `gameLabel1`, `gameLabel2`, ... up to `pool.gamesPerMatch`, each trimmed, with a problem `game labels must not be blank` if any is empty. Extend the tests accordingly.

`actions/tournaments.ts` `updateSettings` writes `play_all_games` and `game_labels` alongside the other rule fields (so they lock after setup like the rest).

`app/admin/[slug]/page.tsx`: in the Pool stage fieldset add `<label className="flex items-end gap-2 pb-2"><input name="pool_playAllGames" type="checkbox" defaultChecked={pool.playAllGames} disabled={locked} /> Play every game</label>`. Add a new fieldset "Game names" rendering one text input per game, `name={`gameLabel${n}`}`, `defaultValue={gameLabel(t, n)}`, disabled when locked, and add the matching hidden mirrors to the `locked` block so the values survive a date-and-venue save.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @tournament/web
```

Expected: still failing, because the actions and pages that used `match.court` are rewritten in Task 3. Confirm the failures are confined to `actions/matches.ts`, `lib/results/apply.ts`, `lib/results/persist.ts`, `components/CourtClock.tsx`, `components/MatchCard.tsx`, `components/ScoreForm.tsx` and the pages that use them.

```bash
git add -A
git commit -m "feat(db): give every game its own court, clock and slot row" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Sending a game to a court, and the board of what is on

**Files:**
- Create: `apps/web/src/lib/schedule/plan.ts` (+ `plan.test.ts`), `apps/web/src/lib/schedule/board.ts` (+ `board.test.ts`), `apps/web/src/lib/schedule/status.ts`, `apps/web/src/actions/games.ts`
- Modify: `apps/web/src/actions/matches.ts` (remove the match-level scheduling actions), `apps/web/src/lib/results/apply.ts` (remove `planCourt` and its tests), `apps/web/src/components/CourtClock.tsx`

**Interfaces:**
- Consumes: `GameRow`, `gameSlotsByMatch`, `settingsFor`, `gameLabel`, `requireAdmin`, `revalidateTournament`, `ClockState`/`remainingMs` from `lib/results/clock.ts`.
- Produces:
  - `planGameCourt(slots: readonly GameRow[], matchId: string, gameNo: number, court: number | null, courtCount: number): { court: number | null; started_at: string | null; paused_at: null; paused_ms: number } | { error: string }` — pure. Sending a slot to a court sets `court` and stamps `started_at` when it was not already running, and resets the pause fields. Passing `null` takes it off court and clears the clock. Refuses a court outside `1..courtCount`, a court already held by another running game, and a slot that already has a score.
  - `firstFreeCourt(slots: readonly GameRow[], courtCount: number): number | null`
  - `ScheduledGame { match: Match; slot: GameRow; label: string }` and `scheduleBoard(input: { tournament: TournamentRow; matches: readonly Match[]; slots: readonly GameRow[]; poolOrder: readonly string[]; stage: Stage }): { nowPlaying: ScheduledGame[]; upNext: ScheduledGame[] }` in `board.ts`.
  - Server actions in `actions/games.ts`: `startGame(slug, matchId, gameNo, court: number | null)`, `takeGameOffCourt(slug, matchId, gameNo)`, `pauseGame(slug, matchId, gameNo)`, `resumeGame(slug, matchId, gameNo)`. All `requireAdmin`, all typed `ActionResult`, all `revalidateTournament`.
  - `CourtClock` takes `startedAt`, `capMinutes`, `pausedAt`, `pausedMs` exactly as it does now; no change beyond being fed from a game slot.

- [ ] **Step 1: Failing tests for the pure pieces**

`apps/web/src/lib/schedule/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { firstFreeCourt, planGameCourt } from './plan';
import type { GameRow } from '@/lib/db/types';

const slot = (over: Partial<GameRow> & { match_id: string; game_no: number }): GameRow => ({
  score_a: null, score_b: null, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0, ...over,
});
const running = slot({ match_id: 'm1', game_no: 1, court: 1, started_at: '2026-10-03T09:00:00.000Z' });
const idle = slot({ match_id: 'm1', game_no: 2 });
const played = slot({ match_id: 'm1', game_no: 3, score_a: 15, score_b: 9 });

describe('firstFreeCourt', () => {
  it('skips courts held by a running game', () => {
    expect(firstFreeCourt([running], 4)).toBe(2);
    expect(firstFreeCourt([], 4)).toBe(1);
  });
  it('is null when every court is busy', () => {
    expect(firstFreeCourt([running, slot({ match_id: 'm2', game_no: 1, court: 2, started_at: 'x' })], 2)).toBeNull();
  });
});

describe('planGameCourt', () => {
  it('sends an idle game to a court and starts its clock', () => {
    const r = planGameCourt([running, idle], 'm1', 2, 3, 4);
    expect(r).toMatchObject({ court: 3, paused_at: null, paused_ms: 0 });
    if ('error' in r) throw new Error(r.error);
    expect(typeof r.started_at).toBe('string');
  });
  it('moving a running game to another court keeps its clock', () => {
    const r = planGameCourt([running, idle], 'm1', 1, 2, 4);
    if ('error' in r) throw new Error(r.error);
    expect(r).toEqual({ court: 2, started_at: running.started_at, paused_at: null, paused_ms: 0 });
  });
  it('taking a game off court clears the clock', () => {
    expect(planGameCourt([running], 'm1', 1, null, 4)).toEqual({ court: null, started_at: null, paused_at: null, paused_ms: 0 });
  });
  it('refuses a busy court, an out of range court, an unknown slot and a played game', () => {
    expect(planGameCourt([running, idle], 'm1', 2, 1, 4)).toEqual({ error: 'court 1 is in use' });
    expect(planGameCourt([running, idle], 'm1', 2, 9, 4)).toEqual({ error: 'court must be between 1 and 4' });
    expect(planGameCourt([running], 'm1', 7, 2, 4)).toEqual({ error: 'unknown game' });
    expect(planGameCourt([played], 'm1', 3, 2, 4)).toEqual({ error: 'that game already has a score' });
  });
});
```

`apps/web/src/lib/schedule/board.test.ts` covers: a started, unscored slot appears in `nowPlaying` ordered by court; a scored slot never does; `upNext` offers the earliest unstarted, unscored slot per pool ordered by `poolOrder`, then by the match's `slot` and the game number; a match missing a team offers nothing; playoff matches never appear in `upNext` but do appear in `nowPlaying` when running. Build fixtures with the local `slot` helper above and `makeMatch` from `@tournament/core`.

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @tournament/web -- src/lib/schedule
```

- [ ] **Step 3: Implement the pure pieces**

`apps/web/src/lib/schedule/plan.ts`:

```ts
import type { GameRow } from '@/lib/db/types';

const isRunning = (g: GameRow) => g.started_at !== null && g.score_a === null;

/** The lowest court no running game is holding, or null when they are all busy. */
export function firstFreeCourt(slots: readonly GameRow[], courtCount: number): number | null {
  const busy = new Set(slots.filter(isRunning).map((g) => g.court));
  for (let c = 1; c <= courtCount; c++) if (!busy.has(c)) return c;
  return null;
}

export type CourtPlan = { court: number | null; started_at: string | null; paused_at: null; paused_ms: number };

/**
 * Where one game goes next. Sending an idle game to a court starts its clock; moving a game
 * that is already running keeps the clock it has, so a court change does not hand a team
 * extra time. Taking it off court throws the clock away, because the game will start again.
 */
export function planGameCourt(
  slots: readonly GameRow[], matchId: string, gameNo: number, court: number | null, courtCount: number, now = new Date().toISOString(),
): CourtPlan | { error: string } {
  const slot = slots.find((g) => g.match_id === matchId && g.game_no === gameNo);
  if (!slot) return { error: 'unknown game' };
  if (slot.score_a !== null) return { error: 'that game already has a score' };
  if (court === null) return { court: null, started_at: null, paused_at: null, paused_ms: 0 };
  if (!Number.isInteger(court) || court < 1 || court > courtCount) return { error: `court must be between 1 and ${courtCount}` };
  const holder = slots.find((g) => isRunning(g) && g.court === court && !(g.match_id === matchId && g.game_no === gameNo));
  if (holder) return { error: `court ${court} is in use` };
  return { court, started_at: slot.started_at ?? now, paused_at: null, paused_ms: slot.started_at ? slot.paused_ms : 0 };
}
```

Note the returned `paused_ms` keeps a moved game's accumulated stoppages and resets a fresh start to zero; adjust the second test's expectation if you change this, but do not change the behaviour.

`apps/web/src/lib/schedule/board.ts`:

```ts
import type { Match, Stage } from '@tournament/core';
import type { GameRow, TournamentRow } from '@/lib/db/types';
import { gameLabel } from '@/lib/db/mappers';

export interface ScheduledGame { match: Match; slot: GameRow; label: string }
export interface Board { nowPlaying: ScheduledGame[]; upNext: ScheduledGame[] }

const isRunning = (g: GameRow) => g.started_at !== null && g.score_a === null;
const isWaiting = (g: GameRow) => g.started_at === null && g.score_a === null;

/**
 * What is on court and what should go on next, at the level of individual games. This
 * replaces the rules package's old match-level board: a court now holds one game, not a
 * whole meeting.
 */
export function scheduleBoard(input: {
  tournament: TournamentRow; matches: readonly Match[]; slots: readonly GameRow[]; poolOrder: readonly string[]; stage: Stage;
}): Board {
  const byId = new Map(input.matches.map((m) => [m.id, m]));
  const label = (n: number) => gameLabel(input.tournament, n);
  const playable = (m: Match | undefined): m is Match =>
    m !== undefined && m.teamAId !== null && m.teamBId !== null && m.status !== 'done';

  const nowPlaying = input.slots
    .filter(isRunning)
    .flatMap((slot) => { const m = byId.get(slot.match_id); return m ? [{ match: m, slot, label: label(slot.game_no) }] : []; })
    .sort((x, y) => (x.slot.court ?? Number.MAX_SAFE_INTEGER) - (y.slot.court ?? Number.MAX_SAFE_INTEGER));

  const groupKey = (m: Match) => (input.stage === 'pool' ? `pool:${m.poolId}` : `round:${m.round}`);
  const best = new Map<string, ScheduledGame>();
  for (const slot of input.slots) {
    if (!isWaiting(slot)) continue;
    const m = byId.get(slot.match_id);
    if (!playable(m) || m.stage !== input.stage || m.stage === 'playoff') continue;
    const candidate = { match: m, slot, label: label(slot.game_no) };
    const current = best.get(groupKey(m));
    const earlier = !current
      || m.slot < current.match.slot
      || (m.slot === current.match.slot && slot.game_no < current.slot.game_no);
    if (earlier) best.set(groupKey(m), candidate);
  }

  const poolRank = (poolId: string | null) => {
    const idx = input.poolOrder.indexOf(poolId ?? '');
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const upNext = [...best.values()].sort((x, y) =>
    input.stage === 'pool' ? poolRank(x.match.poolId) - poolRank(y.match.poolId) : (x.match.round ?? 0) - (y.match.round ?? 0),
  );
  return { nowPlaying, upNext };
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
npm test -w @tournament/web -- src/lib/schedule
```

- [ ] **Step 5: The scheduling actions**

Create `apps/web/src/actions/games.ts` with `'use server'` at the top. Each action resolves `requireAdmin(slug)`, loads the tournament's game rows with `listGames`, and writes with a conditional update whose affected rows are checked, in the pattern the existing actions use.

```ts
export async function startGame(slug: string, matchId: string, gameNo: number, court: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const slots = await listGames(ctx.sb, ctx.tournament.id);
  const chosen = court ?? firstFreeCourt(slots, ctx.tournament.court_count);
  if (chosen === null) return fail('invalid_input', 'Every court is in use');
  const planned = planGameCourt(slots, matchId, gameNo, chosen, ctx.tournament.court_count);
  if ('error' in planned) return fail(planned.error.includes('court must be between') ? 'invalid_input' : 'match_not_editable', planned.error);
  const upd = await ctx.sb.from('games').update(planned)
    .eq('match_id', matchId).eq('game_no', gameNo).is('score_a', null).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');
  await syncMatchStatus(ctx.sb, ctx.tournament.id, matchId);
  revalidateTournament(slug);
  return ok(undefined);
}
```

`takeGameOffCourt` is the same shape with `planGameCourt(..., null, ...)`. `pauseGame` updates `{ paused_at: now }` filtered `.is('paused_at', null)` and requires `started_at` to be set (`.not('started_at', 'is', null)`); `resumeGame` reads the row, requires a non-null `paused_at`, and updates `{ paused_ms: paused_ms + (Date.now() - Date.parse(paused_at)), paused_at: null }` filtered on the `paused_at` it read. Both check the affected row count and return `stale_state` on zero.

Add a shared helper used by every action here and by Task 4. It takes a Supabase client, so it must **not** live in a `'use server'` file, where every export becomes a callable endpoint and only serializable arguments are allowed. Put it in `apps/web/src/lib/schedule/status.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listGames } from '@/lib/db/queries';

/**
 * A meeting is live while any of its games is on court or already scored, and ready again
 * when none is. Completion is not decided here: that happens in saveGameScore, which has the
 * full result and can advance the bracket.
 */
export async function syncMatchStatus(sb: SupabaseClient, tournamentId: string, matchId: string): Promise<void> {
  const slots = (await listGames(sb, tournamentId)).filter((g) => g.match_id === matchId);
  const active = slots.some((g) => g.started_at !== null || g.score_a !== null);
  await sb.from('matches').update({ status: active ? 'live' : 'ready' })
    .eq('id', matchId).in('status', ['ready', 'live']);
}
```

Delete `assignCourt`, `startNow`, `pauseMatch` and `resumeMatch` from `actions/matches.ts`, and delete `planCourt` from `lib/results/apply.ts` along with its tests in `apply.test.ts`.

- [ ] **Step 6: Verify and commit**

```bash
npm test -w @tournament/web -- src/lib
npm run typecheck -w @tournament/web
```

Expected: the `lib` tests pass. Typecheck still fails inside the components and pages rewritten in Task 5; confirm the errors are confined to `components/` and `app/`.

```bash
git add -A
git commit -m "feat(web): send individual games to courts and track what is on" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Entering one game's score, and finishing the meeting

**Files:**
- Modify: `apps/web/src/actions/games.ts`, `apps/web/src/lib/results/persist.ts`, `apps/web/src/actions/matches.ts`, `apps/web/src/actions/participant.ts`, `apps/web/src/lib/submissions/applySubmission.ts`
- Test: `apps/web/src/integration/perGame.integration.test.ts` (new)

**Interfaces:**
- Produces:
  - `saveGameScore(slug: string, matchId: string, gameNo: number, formData: FormData): Promise<ActionResult>` and `clearGameScore(slug: string, matchId: string, gameNo: number): Promise<ActionResult>` in `actions/games.ts`.
  - `applyResultPlan` no longer deletes or inserts game rows. It updates the scores of the slots named in `plan.gamesToWrite`, and for every match in `plan.clearGamesFor` it blanks that match's slots (`score_a`, `score_b` null, `time_expired` false) and clears their clocks, leaving the rows in place.

- [ ] **Step 1: `saveGameScore`**

```ts
export async function saveGameScore(slug: string, matchId: string, gameNo: number, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (!['pools', 'knockout', 'finished'].includes(ctx.tournament.status)) return fail('stale_state', 'The tournament is not in play');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const row = rows.find((r) => r.id === matchId);
  if (!row || row.status === 'pending' || !row.team_a_id || !row.team_b_id) return fail('match_not_editable', 'That meeting cannot take a score yet');
  const settings = settingsFor(ctx.tournament, row.stage);

  const scoreA = Number(String(formData.get('scoreA') ?? '').trim());
  const scoreB = Number(String(formData.get('scoreB') ?? '').trim());
  const timeExpired = formData.get('timeExpired') !== null;
  const check = validateGame(settings, scoreA, scoreB, timeExpired);
  if (!check.ok) return fail('invalid_score', check.reason);

  // Writing the score also takes the game off court: it is finished, so it must not hold a
  // court or keep counting down.
  const upd = await ctx.sb.from('games')
    .update({ score_a: scoreA, score_b: scoreB, time_expired: timeExpired, court: null, started_at: null, paused_at: null, paused_ms: 0 })
    .eq('match_id', matchId).eq('game_no', gameNo).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');

  const slots = (await listGames(ctx.sb, ctx.tournament.id)).filter((g) => g.match_id === matchId);
  const scored = slots.filter((g) => g.score_a !== null && g.score_b !== null);
  if (scored.length < settings.gamesPerMatch) {
    await syncMatchStatus(ctx.sb, ctx.tournament.id, matchId);
    revalidateTournament(slug);
    return ok(undefined);
  }

  // Every game is in: the meeting can be decided and the winner moved on.
  const games = scored.map((g) => ({ gameNo: g.game_no, scoreA: g.score_a!, scoreB: g.score_b!, timeExpired: g.time_expired }));
  const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}
```

`clearGameScore` blanks one slot. When the meeting was already `done` it must come undone first, so call `rollback` from `@tournament/core` on the match, write the returned `changed` matches, blank the slots of every id in `resetMatchIds`, then blank this slot and re-run `syncMatchStatus`. Model the writes on `applyResultPlan`.

- [ ] **Step 2: `applyResultPlan` stops owning game rows**

In `lib/results/persist.ts` replace the delete-and-insert of the primary match's games with in-place updates, and the `clearGamesFor` deletes with blanking:

```ts
  for (const id of plan.clearGamesFor) {
    // The rows are the meeting's game slots, so they stay; only the results go.
    const blank = await sb.from('games')
      .update({ score_a: null, score_b: null, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0 })
      .eq('match_id', id);
    if (blank.error) return fail('invalid_input', blank.error.message);
    const subs = await sb.from('score_submissions').delete().eq('match_id', id);
    if (subs.error) return fail('invalid_input', subs.error.message);
  }
  for (const g of plan.gamesToWrite) {
    const wrote = await sb.from('games')
      .update({ score_a: g.scoreA, score_b: g.scoreB, time_expired: g.timeExpired ?? false, court: null, started_at: null, paused_at: null, paused_ms: 0 })
      .eq('match_id', matchId).eq('game_no', g.gameNo).select('game_no');
    if (wrote.error) return fail('invalid_input', wrote.error.message);
    if ((wrote.data ?? []).length === 0) return fail('stale_state', 'A game slot is missing; reload');
  }
```

Remove every reference to the match columns that no longer exist (`court`, `started_at`, `paused_at`, `paused_ms`) from the claim update and the downstream loop; `finished_at` stays.

- [ ] **Step 3: Keep the participant path working**

`actions/participant.ts` `submitScores` and `lib/submissions/applySubmission.ts` send a whole meeting's games at once, which still works because `applyResultPlan` writes them through `gamesToWrite`. Read both, remove any reference to the dropped match columns, and make sure the games they submit are validated against `settingsFor(tournament, stage)` as they are today. A participant submits the whole meeting, not one game.

`actions/matches.ts`: delete `enterResult` and `enterResultForm` (score entry is per game now); keep `awardMatch`, `confirmSubmission` and `replaceTeamInMatch`.

- [ ] **Step 4: Integration test**

`apps/web/src/integration/perGame.integration.test.ts`, following the pattern in `submissions.integration.test.ts`: create a tournament through `create_tournament`, two teams, a pool, one `ready` pool match with three game slots. Then assert, with the service client:

1. Updating slot 1 to a court and a `started_at` leaves the other two idle, and `firstFreeCourt` then returns the next court.
2. Scoring games 1 and 2 for the same team leaves the match not done (because the third is still played).
3. Scoring game 3 lets `planResult` report `complete` with that team as winner, and `applyResultPlan` marks the match `done`, sets `winner_id`, and leaves three game rows with scores and no court.

- [ ] **Step 5: Verify and commit**

```bash
npm test -w @tournament/web
npm run typecheck -w @tournament/web
```

Expected: `lib`, `actions` and integration suites pass; typecheck errors remain only in `components/` and `app/`.

```bash
git add -A
git commit -m "feat(web): score one game at a time and finish the meeting on the last" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The screens

**Files:**
- Create: `apps/web/src/components/GameScoreForm.tsx`, `apps/web/src/components/GameLine.tsx`, `apps/web/src/components/NowPlaying.tsx`
- Delete: `apps/web/src/components/ScoreForm.tsx`
- Modify: `apps/web/src/components/MatchCard.tsx`, `apps/web/src/app/admin/[slug]/matches/page.tsx`, `apps/web/src/app/t/[slug]/page.tsx`, `apps/web/src/app/t/[slug]/pools/page.tsx`, `apps/web/src/app/t/[slug]/bracket/page.tsx`, `apps/web/src/app/t/[slug]/team/page.tsx`, `apps/web/src/app/admin/[slug]/pools/page.tsx` (its fixtures list gains the per-game scores)

**Interfaces:**
- Consumes: `scheduleBoard`, `ScheduledGame`, `gameSlotsByMatch`, `gameLabel`, `settingsFor`, the actions from `actions/games.ts`, `CourtClock`, `SubmitButton`.
- Produces:
  - `<GameScoreForm matchId gameNo settings label action successText? />` — a client form with two number inputs (`scoreA`, `scoreB`), a `timeExpired` checkbox shown only when the stage has a clock, a Save button disabled until `validateGame` accepts the pair, and the inline outcome in `[data-testid="game-outcome"]`. Keep `data-testid="game-score-form"` on the `<form>`.
  - `<GameLine tournament match slot settings admin />` — one row for one game: its label, the score if it has one, otherwise the court controls and clock. Used by both the admin screen and the read-only views (`admin` false hides every control).
  - `<NowPlaying games settings />` — the box of `ScheduledGame`s.

- [ ] **Step 1: `GameScoreForm`**

Model it closely on the deleted `ScoreForm`: `'use client'`, `useTransition`, an inline outcome that survives via the existing `RecentOutcome` mechanism, values kept on failure. The difference is that it holds one game rather than a list, so validity is `validateGame(settings, a, b, timeExpired).ok` rather than `matchResult`. Give the hint line the reason string when it is invalid and the winning team's name when it is valid.

- [ ] **Step 2: `GameLine`**

For a slot with a score: the label, `15-9`, a "time" marker when `time_expired`, and, for an admin, a small "Change" toggle revealing `GameScoreForm` plus a "Clear" button wired to `clearGameScore` and guarded with `confirmMessage`.

For a slot with no score: the label, and for an admin a **Start now** button (calling `startGame` with a `court` select defaulting to blank for "first free"), or, when it is running, the `CourtClock`, **Pause** / **Resume**, **Take off court**, and the `GameScoreForm`. For a non-admin: the label plus `Court N` and the clock when running, or nothing.

Keep these labels exactly: `Start now`, `Pause`, `Resume`, `Take off court`, `Save`, `Clear`, `Change`.

- [ ] **Step 3: `NowPlaying` and the admin Matches screen**

`NowPlaying` renders a bordered box titled `Now playing (N)` containing one `GameLine` per running game, each showing the meeting's two team names, the game label and the court. When nothing is running render `<p>No game is on court.</p>` inside the box so the heading is still there.

Rewrite `app/admin/[slug]/matches/page.tsx` as:

1. Load pools, teams, match rows, game rows and submissions as it does now, plus `gameSlotsByMatch`.
2. `const board = scheduleBoard({ tournament: t, matches, slots, poolOrder: pools.map((p) => p.id), stage: t.status === 'pools' ? 'pool' : 'knockout' });`
3. Render, in order: `<FlashMessage />`, `<RecentOutcome />`, `<NowPlaying games={board.nowPlaying} settings={...} />`, the existing **Needs attention** section, the filter nav, then the meetings.
4. Each meeting is a `MatchCard` whose body is one `GameLine` per slot, plus the award buttons that are already there.

The `open` / `done` / `all` filter keeps its current meaning at the meeting level.

- [ ] **Step 4: The read-only views**

`MatchCard` gains an optional `slots?: GameRow[]` and, when given, lists each game's label and score under the team lines instead of the old single score column. Where a match has no slots (a bye) keep today's rendering.

Feed `slots` from `gameSlotsByMatch` on the public live page, the public pools page, the public bracket page and the participant's team page. On the public live page, replace the old match-level "Now playing" section with `board.nowPlaying` rendered through `GameLine` in read-only mode, and keep "Up next" from `board.upNext`.

The admin pools page's fixtures list shows each meeting's game scores joined with `, ` for a finished meeting, and the count of games played otherwise.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
```

Expected: all three clean. The Playwright specs still fail here, because they enter one game per meeting; Task 6 fixes them.

```bash
git add -A
git commit -m "feat(web): per-game rows, a now playing box and per-game score entry" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: End-to-end tests, documentation and the spec

**Files:**
- Modify: `apps/web/e2e/tournament.spec.ts`, `apps/web/e2e/participant.spec.ts`, `apps/web/e2e/club-format.spec.ts`
- Modify: `apps/web/README.md`, `packages/tournament-core/README.md`, `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md`

**Interfaces:**
- Produces three passing specs against the new model, and a v1.2 section in the spec.

- [ ] **Step 1: A shared helper for playing a meeting**

Every spec now has to score three games instead of one. In each spec replace the single-game helper with:

```ts
/** Scores every game of the first open meeting. Side A wins two to one by `margin`. */
async function playMeeting(page: Page, slugName: string, margin: number): Promise<void> {
  await page.goto(`/admin/${slugName}/matches?filter=open`);
  const card = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') }).first();
  for (const [gameNo, a, b] of [[1, 15, 15 - margin], [2, 15 - margin, 15], [3, 15, 15 - margin]] as const) {
    const form = card.getByTestId('game-score-form').nth(0);
    await form.locator('input[name="scoreA"]').fill(String(a));
    await form.locator('input[name="scoreB"]').fill(String(b));
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    void gameNo;
  }
}
```

Adjust the locator to the real markup once `GameLine` exists: the point is that each unscored game exposes its own `game-score-form`, and scoring one makes the next the first unscored form on the card. Where a spec previously counted twelve pool results, it now plays six meetings; keep the assertion in terms of meetings, and keep the varying `margin` per meeting that `tournament.spec.ts` already uses to avoid an accidental three-way tie.

- [ ] **Step 2: New assertions**

In `club-format.spec.ts`, replace the old match-level clock and pause assertions with per-game ones:

- Start the first game of the first meeting, then assert `[data-testid="court-clock"]` is visible **inside the Now playing box** (`page.getByText('Now playing').locator('..')`, or give `NowPlaying` a `data-testid="now-playing"` and scope to it, which is preferable — add that test id in Task 5's component if it is missing).
- Click **Pause**, expect the clock to read `paused`; click **Resume**, expect it to be counting again.
- Assert the three labels appear on a meeting card: `Mixed doubles #1`, `Mixed doubles #2`, `Men's doubles`.
- Score two games for one team and assert the meeting is still open (the third is always played), then score the third and assert it leaves the open filter.

- [ ] **Step 3: Run the suite**

```bash
npx kill-port 3100
npm run seed:admin -w @tournament/web
npm run e2e -w @tournament/web
```

Expected: `3 passed`. These specs are now considerably longer; if a spec exceeds the 300 second per-test timeout in `playwright.config.ts`, raise that timeout rather than cutting assertions, and say so.

- [ ] **Step 4: Documentation**

`packages/tournament-core/README.md`: document `playAllGames`, note that `Match` has no court and that the live board is now the application's job.

`apps/web/README.md`: a "Meetings and games" section explaining that a meeting is three labelled games, that all three are played, that the meeting goes to whoever wins more, and that each game is sent to a court and clocked on its own.

`docs/superpowers/specs/2026-09-05-badminton-tournament-design.md`: append section 12, "v1.2 addendum (agreed 2026-09-08): three games per meeting", covering the format, that all games are always played and the meeting goes on games won, that scheduling and the clock belong to the game, the configurable game labels defaulting to the two mixed doubles and the men's doubles, and the Now playing box. Add one line to 11.1 and 11.4 pointing at section 12 as the amendment.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(web): three games per meeting end to end; document the format" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

---

## Done criteria for this plan

- A new tournament defaults to three games per meeting, labelled Mixed doubles #1, Mixed doubles #2 and Men's doubles, all of them played.
- Each game can be sent to any free court on its own, has its own thirteen minute countdown, and can be paused and resumed without the stoppage counting.
- A meeting finishes when its last game is scored and goes to the team that won more games; one team point, with every score counted in the points difference.
- The admin Matches screen opens with a Now playing box listing the games on court, above everything else.
- Core, web unit and integration tests pass; typecheck and build pass; all three Playwright specs pass.
- The migration is a new file, applied locally and to the hosted Sydney project.

