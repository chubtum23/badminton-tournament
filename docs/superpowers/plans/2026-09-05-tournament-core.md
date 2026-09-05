# Tournament Core Rules Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/tournament-core`, the dependency-free TypeScript package that holds every tournament rule from the spec (score validation, pool dealing, round-robin schedules, standings, bracket generation, advancement, rollback, live board), fully unit tested.

**Architecture:** An npm-workspaces monorepo. This plan creates only the `packages/tournament-core` workspace. Every exported function is pure: it takes settings and plain row objects in and returns new objects out. Later plans (web app, participants) import these functions from Next.js server actions and persist the results; none of that is in scope here.

**Tech Stack:** Node 20+, npm workspaces, TypeScript 5 (strict), Vitest 2. No runtime dependencies in the core package.

**Spec:** `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md`, sections 4 (types), 6 (logic), 9 (testing), 10 (extensibility). This plan is 1 of 3; plan 2 covers the Supabase schema and Next.js admin/public app, plan 3 covers participant links, submissions, announcements and realtime.

## Global Constraints

- Package name: `@tournament/core`, path `packages/tournament-core`, `"type": "module"`.
- `tsconfig` uses `"strict": true` and `"noUncheckedIndexedAccess": true`. Array index reads need `!` or a guard.
- No runtime dependencies in `packages/tournament-core`. Dev dependencies only: `typescript`, `vitest`.
- No imports from React, Next.js, Supabase or Node built-ins inside `packages/tournament-core/src`.
- Every function is pure. Never mutate an input object; return copies.
- Badminton defaults: `gamesPerMatch: 3`, `pointsPerGame: 15`, `winByTwo: true`, `maxPoints: 21`.
- Tests import `describe`, `it`, `expect` explicitly from `vitest` (no globals).
- Shell is Windows PowerShell 5.1: `&&` is not available. Run chained commands on separate lines or with `;`.
- Commit after every task with the message shown. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

```
package.json                                   npm workspaces root
.gitignore
packages/tournament-core/
  package.json                                 @tournament/core
  tsconfig.json
  vitest.config.ts
  README.md                                    one paragraph per exported function
  src/
    index.ts                                   re-exports everything below
    types.ts                                   Settings, Match, Game, TeamRef, Rng, enums, BADMINTON_DEFAULTS
    testUtils.ts                               seededRng, makeMatch (test-only helpers)
    scoring.ts / scoring.test.ts               validateGame, matchResult
    pools.ts / pools.test.ts                   shuffle, assignPools, roundRobin, poolMatches
    standings.ts / standings.test.ts           poolStandings
    bracket.ts / bracket.test.ts               bracketSize, bracketOrder, seedQualifiers, buildBracket
    advance.ts / advance.test.ts               advance, rollback
    liveBoard.ts / liveBoard.test.ts           liveBoard
    simulation.test.ts                         full 16-team tournament through the pure functions
```

---

### Task 1: Monorepo scaffold and test runner

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `packages/tournament-core/package.json`
- Create: `packages/tournament-core/tsconfig.json`
- Create: `packages/tournament-core/vitest.config.ts`
- Create: `packages/tournament-core/src/index.ts`
- Test: `packages/tournament-core/src/index.test.ts`

**Interfaces:**
- Produces: a workspace where `npm test -w @tournament/core` runs Vitest over `src/**/*.test.ts`.

- [ ] **Step 1: Create the root workspace files**

`package.json` (repo root):

```json
{
  "name": "badminton-tournament",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.*
coverage/
```

- [ ] **Step 2: Create the core package files**

`packages/tournament-core/package.json`:

```json
{
  "name": "@tournament/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/tournament-core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

`packages/tournament-core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write the failing smoke test**

`packages/tournament-core/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('package', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 4: Install and run to verify it fails**

Run from the repo root:

```powershell
npm install
npm test -w @tournament/core
```

Expected: FAIL with `Failed to resolve import "./index"` (or "Cannot find module").

- [ ] **Step 5: Write the minimal index**

`packages/tournament-core/src/index.ts`:

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 6: Run to verify it passes**

```powershell
npm test -w @tournament/core
```

Expected: `1 passed`.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore: scaffold npm workspace and @tournament/core with vitest" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared types and game validation

**Files:**
- Create: `packages/tournament-core/src/types.ts`
- Create: `packages/tournament-core/src/scoring.ts`
- Test: `packages/tournament-core/src/scoring.test.ts`

**Interfaces:**
- Produces:
  - `Settings { gamesPerMatch: number; pointsPerGame: number; winByTwo: boolean; maxPoints: number | null }`
  - `BADMINTON_DEFAULTS: Settings`
  - `Side = 'a' | 'b'`, `Stage = 'pool' | 'knockout'`, `MatchStatus = 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done'`
  - `Game { gameNo: number; scoreA: number; scoreB: number }`
  - `Match { id; stage; poolId; round; slot; teamAId; teamBId; court; status; winnerId; nextMatchId; nextMatchSide }`
  - `TeamRef { id: string; name: string }`, `Rng = () => number`
  - `validateGame(settings: Settings, scoreA: number, scoreB: number): GameValidation` where `GameValidation = { ok: true; winner: Side } | { ok: false; reason: string }`

- [ ] **Step 1: Write the types file**

`packages/tournament-core/src/types.ts`:

```ts
/** Sport-specific scoring rules. Stored per tournament. */
export interface Settings {
  /** Odd number of games; the match is won by a majority. */
  gamesPerMatch: number;
  /** Points needed to win a game. */
  pointsPerGame: number;
  /** If true, a game past pointsPerGame must be won by a two-point lead. */
  winByTwo: boolean;
  /** Hard cap; the first side to reach it wins regardless of lead. null = no cap. */
  maxPoints: number | null;
}

export const BADMINTON_DEFAULTS: Settings = {
  gamesPerMatch: 3,
  pointsPerGame: 15,
  winByTwo: true,
  maxPoints: 21,
};

export type Side = 'a' | 'b';
export type Stage = 'pool' | 'knockout';
export type MatchStatus = 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done';

export interface Game {
  gameNo: number;
  scoreA: number;
  scoreB: number;
}

export interface Match {
  id: string;
  stage: Stage;
  poolId: string | null;
  /** Knockout only. 1 = first round. null for pool matches. */
  round: number | null;
  /** Position within the pool schedule or within the knockout round, starting at 1. */
  slot: number;
  teamAId: string | null;
  teamBId: string | null;
  court: number | null;
  status: MatchStatus;
  winnerId: string | null;
  nextMatchId: string | null;
  nextMatchSide: Side | null;
}

export interface TeamRef {
  id: string;
  name: string;
}

/** Returns a float in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;
```

- [ ] **Step 2: Write the failing tests**

`packages/tournament-core/src/scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateGame } from './scoring';
import { BADMINTON_DEFAULTS, type Settings } from './types';

const s = BADMINTON_DEFAULTS; // to 15, win by two, cap 21

describe('validateGame', () => {
  it('accepts a normal win for either side', () => {
    expect(validateGame(s, 15, 11)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(s, 9, 15)).toEqual({ ok: true, winner: 'b' });
  });

  it('rejects when nobody reached the target', () => {
    expect(validateGame(s, 14, 12)).toEqual({ ok: false, reason: 'winner must reach 15' });
  });

  it('rejects ties, negatives and non-integers', () => {
    expect(validateGame(s, 15, 15).ok).toBe(false);
    expect(validateGame(s, -1, 15).ok).toBe(false);
    expect(validateGame(s, 15.5, 10).ok).toBe(false);
  });

  it('enforces win by two at the target', () => {
    expect(validateGame(s, 15, 14)).toEqual({ ok: false, reason: 'must win by two' });
    expect(validateGame(s, 16, 14)).toEqual({ ok: true, winner: 'a' });
  });

  it('requires exactly a two-point lead past the target', () => {
    expect(validateGame(s, 17, 14)).toEqual({ ok: false, reason: 'a game past 15 ends on a two-point lead' });
    expect(validateGame(s, 20, 18)).toEqual({ ok: true, winner: 'a' });
  });

  it('lets the cap end the game with a one-point lead', () => {
    expect(validateGame(s, 21, 20)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(s, 19, 21)).toEqual({ ok: true, winner: 'b' });
    expect(validateGame(s, 21, 14)).toEqual({ ok: false, reason: 'a game past 15 ends on a two-point lead' });
    expect(validateGame(s, 22, 20)).toEqual({ ok: false, reason: 'scores cannot exceed 21' });
  });

  it('without win-by-two the game ends exactly at the target', () => {
    const noWbt: Settings = { ...s, winByTwo: false, maxPoints: null };
    expect(validateGame(noWbt, 15, 14)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(noWbt, 16, 14)).toEqual({ ok: false, reason: 'game ends at 15' });
  });

  it('when the cap equals the target any lead wins', () => {
    const capped: Settings = { ...s, maxPoints: 15 };
    expect(validateGame(capped, 15, 14)).toEqual({ ok: true, winner: 'a' });
  });

  it('with no cap the game can run long', () => {
    const uncapped: Settings = { ...s, maxPoints: null };
    expect(validateGame(uncapped, 30, 28)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(uncapped, 30, 29)).toEqual({ ok: false, reason: 'a game past 15 ends on a two-point lead' });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/scoring.test.ts
```

Expected: FAIL, cannot resolve `./scoring`.

- [ ] **Step 4: Implement validateGame**

`packages/tournament-core/src/scoring.ts`:

```ts
import type { Settings, Side } from './types';

export type GameValidation = { ok: true; winner: Side } | { ok: false; reason: string };

const fail = (reason: string): GameValidation => ({ ok: false, reason });

export function validateGame(s: Settings, scoreA: number, scoreB: number): GameValidation {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return fail('scores must be non-negative whole numbers');
  }
  if (scoreA === scoreB) return fail('a game cannot end in a tie');

  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  const lead = hi - lo;
  const winner: Side = scoreA > scoreB ? 'a' : 'b';

  if (hi < s.pointsPerGame) return fail(`winner must reach ${s.pointsPerGame}`);
  if (s.maxPoints !== null && hi > s.maxPoints) return fail(`scores cannot exceed ${s.maxPoints}`);

  if (hi === s.pointsPerGame) {
    const capIsTarget = s.maxPoints === s.pointsPerGame;
    if (s.winByTwo && !capIsTarget && lead < 2) return fail('must win by two');
    return { ok: true, winner };
  }

  // hi > pointsPerGame: only possible in win-by-two mode
  if (!s.winByTwo) return fail(`game ends at ${s.pointsPerGame}`);
  const atCap = s.maxPoints !== null && hi === s.maxPoints;
  if (lead === 2 || (atCap && lead === 1)) return { ok: true, winner };
  return fail(`a game past ${s.pointsPerGame} ends on a two-point lead`);
}
```

- [ ] **Step 5: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/scoring.test.ts
```

Expected: all `validateGame` tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(core): add shared types and validateGame" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Match result from a list of games

**Files:**
- Modify: `packages/tournament-core/src/scoring.ts`
- Test: `packages/tournament-core/src/scoring.test.ts` (append)

**Interfaces:**
- Consumes: `validateGame`, `Settings`, `Game`, `Side`.
- Produces: `matchResult(settings: Settings, games: readonly Game[]): MatchResult` where
  `MatchResult = { ok: true; complete: boolean; winner: Side | null; gamesA: number; gamesB: number } | { ok: false; reason: string }`

- [ ] **Step 1: Append the failing tests**

Append to `packages/tournament-core/src/scoring.test.ts`:

```ts
import { matchResult } from './scoring';

describe('matchResult', () => {
  const g = (gameNo: number, scoreA: number, scoreB: number) => ({ gameNo, scoreA, scoreB });

  it('is incomplete with no games', () => {
    expect(matchResult(s, [])).toEqual({ ok: true, complete: false, winner: null, gamesA: 0, gamesB: 0 });
  });

  it('declares a straight-games winner', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 15, 12)])).toEqual({
      ok: true, complete: true, winner: 'a', gamesA: 2, gamesB: 0,
    });
  });

  it('is incomplete at one game each', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 12, 15)])).toEqual({
      ok: true, complete: false, winner: null, gamesA: 1, gamesB: 1,
    });
  });

  it('declares a three-game winner', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 12, 15), g(3, 13, 15)])).toMatchObject({
      ok: true, complete: true, winner: 'b', gamesA: 1, gamesB: 2,
    });
  });

  it('rejects a game after the match is decided', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 15, 12), g(3, 15, 1)])).toEqual({
      ok: false, reason: 'extra game after the match was decided',
    });
  });

  it('rejects out-of-sequence game numbers', () => {
    expect(matchResult(s, [g(1, 15, 8), g(3, 15, 12)])).toEqual({
      ok: false, reason: 'expected game 2 but got game 3',
    });
  });

  it('reports which game is invalid', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 15, 14)])).toEqual({
      ok: false, reason: 'game 2: must win by two',
    });
  });

  it('accepts games in any input order', () => {
    expect(matchResult(s, [g(2, 15, 12), g(1, 15, 8)])).toMatchObject({ complete: true, winner: 'a' });
  });

  it('honours gamesPerMatch = 1', () => {
    const single: Settings = { ...s, gamesPerMatch: 1 };
    expect(matchResult(single, [g(1, 15, 8)])).toMatchObject({ complete: true, winner: 'a' });
    expect(matchResult(single, [g(1, 15, 8), g(2, 15, 8)]).ok).toBe(false);
  });
});
```

Move the `import { matchResult } from './scoring';` line to the top of the file and merge it into the existing import: `import { validateGame, matchResult } from './scoring';`.

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/scoring.test.ts
```

Expected: FAIL, `matchResult` is not exported.

- [ ] **Step 3: Implement matchResult**

Append to `packages/tournament-core/src/scoring.ts`:

```ts
import type { Game } from './types';

export type MatchResult =
  | { ok: true; complete: boolean; winner: Side | null; gamesA: number; gamesB: number }
  | { ok: false; reason: string };

export function gamesNeeded(s: Settings): number {
  return Math.floor(s.gamesPerMatch / 2) + 1;
}

export function matchResult(s: Settings, games: readonly Game[]): MatchResult {
  const needed = gamesNeeded(s);
  const ordered = [...games].sort((x, y) => x.gameNo - y.gameNo);
  let gamesA = 0;
  let gamesB = 0;

  for (let i = 0; i < ordered.length; i++) {
    const game = ordered[i]!;
    if (game.gameNo !== i + 1) {
      return { ok: false, reason: `expected game ${i + 1} but got game ${game.gameNo}` };
    }
    if (gamesA >= needed || gamesB >= needed) {
      return { ok: false, reason: 'extra game after the match was decided' };
    }
    const v = validateGame(s, game.scoreA, game.scoreB);
    if (!v.ok) return { ok: false, reason: `game ${game.gameNo}: ${v.reason}` };
    if (v.winner === 'a') gamesA++;
    else gamesB++;
  }

  const winner: Side | null = gamesA >= needed ? 'a' : gamesB >= needed ? 'b' : null;
  return { ok: true, complete: winner !== null, winner, gamesA, gamesB };
}
```

Merge the new `import type { Game }` into the existing import at the top: `import type { Game, Settings, Side } from './types';`.

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/scoring.test.ts
```

Expected: all scoring tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add matchResult" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Random pool assignment

**Files:**
- Create: `packages/tournament-core/src/testUtils.ts`
- Create: `packages/tournament-core/src/pools.ts`
- Test: `packages/tournament-core/src/pools.test.ts`

**Interfaces:**
- Consumes: `Rng`.
- Produces:
  - `shuffle<T>(items: readonly T[], rng: Rng): T[]`
  - `assignPools(teamIds: readonly string[], poolCount: number, rng: Rng): string[][]`
  - test helper `seededRng(seed: number): Rng`

- [ ] **Step 1: Write the test helper**

`packages/tournament-core/src/testUtils.ts`:

```ts
import type { Match, Rng } from './types';

/** mulberry32: small deterministic PRNG for tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a Match with sensible defaults; override any field. */
export function makeMatch(overrides: Partial<Match> & { id: string }): Match {
  return {
    stage: 'pool',
    poolId: null,
    round: null,
    slot: 1,
    teamAId: null,
    teamBId: null,
    court: null,
    status: 'pending',
    winnerId: null,
    nextMatchId: null,
    nextMatchSide: null,
    ...overrides,
  };
}

/** Sequential id generator: m1, m2, m3 ... */
export function idGen(prefix = 'm'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
```

- [ ] **Step 2: Write the failing tests**

`packages/tournament-core/src/pools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shuffle, assignPools } from './pools';
import { seededRng } from './testUtils';

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('shuffle', () => {
  it('returns a permutation and does not mutate the input', () => {
    const input = teams(8);
    const copy = [...input];
    const out = shuffle(input, seededRng(1));
    expect(input).toEqual(copy);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it('is deterministic for a given rng seed', () => {
    expect(shuffle(teams(8), seededRng(42))).toEqual(shuffle(teams(8), seededRng(42)));
  });

  it('actually reorders for most seeds', () => {
    const differs = [1, 2, 3, 4, 5].some((seed) => shuffle(teams(8), seededRng(seed)).join() !== teams(8).join());
    expect(differs).toBe(true);
  });
});

describe('assignPools', () => {
  it('deals 16 teams into 4 pools of 4', () => {
    const pools = assignPools(teams(16), 4, seededRng(7));
    expect(pools).toHaveLength(4);
    expect(pools.map((p) => p.length)).toEqual([4, 4, 4, 4]);
    expect(pools.flat().sort()).toEqual(teams(16).sort());
  });

  it('spreads a remainder across the first pools', () => {
    const pools = assignPools(teams(10), 3, seededRng(7));
    expect(pools.map((p) => p.length)).toEqual([4, 3, 3]);
  });

  it('ignores input order (placement is random, not seeded)', () => {
    const a = assignPools(teams(8), 2, seededRng(3));
    const b = assignPools([...teams(8)].reverse(), 2, seededRng(3));
    // same rng, different input order => different pools; proves order is not preserved
    expect(a).not.toEqual(b);
  });

  it('rejects impossible pool counts', () => {
    expect(() => assignPools(teams(4), 0, seededRng(1))).toThrow('poolCount must be a positive integer');
    expect(() => assignPools(teams(4), 5, seededRng(1))).toThrow('more pools than teams');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/pools.test.ts
```

Expected: FAIL, cannot resolve `./pools`.

- [ ] **Step 4: Implement shuffle and assignPools**

`packages/tournament-core/src/pools.ts`:

```ts
import type { Rng } from './types';

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Shuffle all teams and deal them round-robin into pools.
 * Seeds are deliberately ignored: placement is random.
 */
export function assignPools(teamIds: readonly string[], poolCount: number, rng: Rng): string[][] {
  if (!Number.isInteger(poolCount) || poolCount < 1) throw new Error('poolCount must be a positive integer');
  if (poolCount > teamIds.length) throw new Error('more pools than teams');
  const pools: string[][] = Array.from({ length: poolCount }, () => []);
  shuffle(teamIds, rng).forEach((id, i) => pools[i % poolCount]!.push(id));
  return pools;
}
```

- [ ] **Step 5: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/pools.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(core): add shuffle and random assignPools" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Round-robin schedule and pool match rows

**Files:**
- Modify: `packages/tournament-core/src/pools.ts`
- Test: `packages/tournament-core/src/pools.test.ts` (append)

**Interfaces:**
- Consumes: `Match`.
- Produces:
  - `Pairing { slot: number; teamAId: string; teamBId: string }`
  - `roundRobin(teamIds: readonly string[]): Pairing[]`
  - `poolMatches(poolId: string, teamIds: readonly string[], newId: () => string): Match[]` (status `ready`, stage `pool`)

- [ ] **Step 1: Append the failing tests**

Append to `packages/tournament-core/src/pools.test.ts` (and add `roundRobin, poolMatches` to the import from `./pools`, `idGen` to the import from `./testUtils`):

```ts
describe('roundRobin', () => {
  const pairKey = (a: string, b: string) => [a, b].sort().join('-');

  it('schedules every pair exactly once', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const pairings = roundRobin(teams(n));
      expect(pairings).toHaveLength((n * (n - 1)) / 2);
      const keys = pairings.map((p) => pairKey(p.teamAId, p.teamBId));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('numbers slots from 1 in order', () => {
    expect(roundRobin(teams(4)).map((p) => p.slot)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never has a team in both matches of the same round (4 teams)', () => {
    const p = roundRobin(teams(4));
    for (const [x, y] of [[0, 1], [2, 3], [4, 5]] as const) {
      const a = p[x]!, b = p[y]!;
      expect(new Set([a.teamAId, a.teamBId, b.teamAId, b.teamBId]).size).toBe(4);
    }
  });

  it('alternates which side the fixed team plays on', () => {
    const p = roundRobin(teams(4));
    const sides = p.filter((m) => m.teamAId === 't1' || m.teamBId === 't1').map((m) => (m.teamAId === 't1' ? 'a' : 'b'));
    expect(new Set(sides).size).toBe(2);
  });

  it('returns nothing for fewer than two teams', () => {
    expect(roundRobin([])).toEqual([]);
    expect(roundRobin(['t1'])).toEqual([]);
  });
});

describe('poolMatches', () => {
  it('turns pairings into ready pool matches', () => {
    const ms = poolMatches('poolA', teams(3), idGen());
    expect(ms).toHaveLength(3);
    expect(ms[0]).toEqual({
      id: 'm1', stage: 'pool', poolId: 'poolA', round: null, slot: 1,
      teamAId: expect.any(String), teamBId: expect.any(String), court: null,
      status: 'ready', winnerId: null, nextMatchId: null, nextMatchSide: null,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/pools.test.ts
```

Expected: FAIL, `roundRobin` is not exported.

- [ ] **Step 3: Implement roundRobin and poolMatches**

Append to `packages/tournament-core/src/pools.ts` (and change the import to `import type { Match, Rng } from './types';`):

```ts
export interface Pairing {
  slot: number;
  teamAId: string;
  teamBId: string;
}

/**
 * Circle-method round robin. With n teams (n even, or n+1 with a bye) there are
 * n-1 rounds of n/2 matches; within a round no team appears twice.
 */
export function roundRobin(teamIds: readonly string[]): Pairing[] {
  if (teamIds.length < 2) return [];
  const ids: (string | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null); // bye marker
  const n = ids.length;
  const fixed = ids[0]!;
  let rest = ids.slice(1);
  const out: Pairing[] = [];
  let slot = 1;

  for (let round = 0; round < n - 1; round++) {
    const ring = [fixed, ...rest];
    for (let i = 0; i < n / 2; i++) {
      const x = ring[i]!;
      const y = ring[n - 1 - i]!;
      if (x === null || y === null) continue;
      out.push(round % 2 === 0 ? { slot, teamAId: x, teamBId: y } : { slot, teamAId: y, teamBId: x });
      slot++;
    }
    rest = [rest[rest.length - 1]!, ...rest.slice(0, -1)];
  }
  return out;
}

/** Pool matches are ready as soon as they are created: both teams are known. */
export function poolMatches(poolId: string, teamIds: readonly string[], newId: () => string): Match[] {
  return roundRobin(teamIds).map((p) => ({
    id: newId(),
    stage: 'pool',
    poolId,
    round: null,
    slot: p.slot,
    teamAId: p.teamAId,
    teamBId: p.teamBId,
    court: null,
    status: 'ready',
    winnerId: null,
    nextMatchId: null,
    nextMatchSide: null,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/pools.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add roundRobin schedule and poolMatches" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Pool standings

**Files:**
- Create: `packages/tournament-core/src/standings.ts`
- Test: `packages/tournament-core/src/standings.test.ts`

**Interfaces:**
- Consumes: `Match`, `Game`, `TeamRef`, `makeMatch`.
- Produces:
  - `StandingRow { teamId; name; played; won; lost; gamesWon; gamesLost; pointsFor; pointsAgainst; pointDiff }`
  - `poolStandings(teams: readonly TeamRef[], matches: readonly Match[], gamesByMatch: Readonly<Record<string, readonly Game[]>>): StandingRow[]`

Ordering (spec 6.3): match wins desc, then point difference desc, then head-to-head when exactly two teams are tied on both, then name ascending.

- [ ] **Step 1: Write the failing tests**

`packages/tournament-core/src/standings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { poolStandings } from './standings';
import { makeMatch } from './testUtils';
import type { Game, Match, TeamRef } from './types';

const teams: TeamRef[] = [
  { id: 'A', name: 'Aces' },
  { id: 'B', name: 'Birdies' },
  { id: 'C', name: 'Clears' },
  { id: 'D', name: 'Drops' },
];

interface Played { id: string; a: string; b: string; games: [number, number][] }

/** Builds done matches plus their games; the winner is whoever took more games. */
function build(played: Played[]): { matches: Match[]; games: Record<string, Game[]> } {
  const matches: Match[] = [];
  const games: Record<string, Game[]> = {};
  for (const p of played) {
    const gamesA = p.games.filter(([x, y]) => x > y).length;
    const winnerId = gamesA > p.games.length / 2 ? p.a : p.b;
    matches.push(makeMatch({ id: p.id, stage: 'pool', poolId: 'P', teamAId: p.a, teamBId: p.b, status: 'done', winnerId }));
    games[p.id] = p.games.map(([scoreA, scoreB], i) => ({ gameNo: i + 1, scoreA, scoreB }));
  }
  return { matches, games };
}

describe('poolStandings', () => {
  it('ranks by match wins first', () => {
    const { matches, games } = build([
      { id: 'm1', a: 'A', b: 'B', games: [[15, 3], [15, 3]] },   // A +24, B -24
      { id: 'm2', a: 'C', b: 'A', games: [[15, 13], [15, 13]] }, // C +4,  A +20
      { id: 'm3', a: 'C', b: 'B', games: [[15, 0], [15, 0]] },   // C +34, B -54
    ]);
    const rows = poolStandings(teams, matches, games);
    // C 2 wins, A 1 win, then D (0 wins, 0 diff) ahead of B (0 wins, -54)
    expect(rows.map((r) => r.teamId)).toEqual(['C', 'A', 'D', 'B']);
    expect(rows[0]).toMatchObject({
      played: 2, won: 2, lost: 0, gamesWon: 4, gamesLost: 0, pointsFor: 60, pointsAgainst: 26, pointDiff: 34,
    });
  });

  it('breaks equal wins by point difference', () => {
    const { matches, games } = build([
      { id: 'm1', a: 'A', b: 'C', games: [[15, 5], [15, 5]] },   // A +20, C -20
      { id: 'm2', a: 'B', b: 'D', games: [[15, 13], [15, 13]] }, // B +4,  D -4
    ]);
    expect(poolStandings(teams, matches, games).map((r) => r.teamId)).toEqual(['A', 'B', 'D', 'C']);
  });

  it('uses head-to-head when exactly two teams tie on wins and point difference', () => {
    // Every result is 15-13, 15-13 (a +4 swing).
    const { matches, games } = build([
      { id: 'm1', a: 'B', b: 'A', games: [[15, 13], [15, 13]] }, // B beats A: B +4, A -4
      { id: 'm2', a: 'A', b: 'C', games: [[15, 13], [15, 13]] }, // A beats C: A 0,  C -4
      { id: 'm3', a: 'C', b: 'B', games: [[15, 13], [15, 13]] }, // C beats B: C 0,  B 0
      { id: 'm4', a: 'B', b: 'D', games: [[15, 13], [15, 13]] }, // B beats D: B +4, D -4
      { id: 'm5', a: 'A', b: 'D', games: [[15, 13], [15, 13]] }, // A beats D: A +4, D -8
    ]);
    const rows = poolStandings(teams, matches, games);
    expect(rows.find((r) => r.teamId === 'A')).toMatchObject({ won: 2, pointDiff: 4 });
    expect(rows.find((r) => r.teamId === 'B')).toMatchObject({ won: 2, pointDiff: 4 });
    expect(rows.find((r) => r.teamId === 'C')).toMatchObject({ won: 1, pointDiff: 0 });
    // Only A and B are tied; B beat A, so B ranks above A even though "Aces" sorts first by name.
    expect(rows.map((r) => r.teamId)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('falls back to name order for a three-way tie', () => {
    const { matches, games } = build([
      { id: 'm1', a: 'A', b: 'B', games: [[15, 13], [15, 13]] }, // A +4, B -4
      { id: 'm2', a: 'B', b: 'C', games: [[15, 13], [15, 13]] }, // B 0,  C -4
      { id: 'm3', a: 'C', b: 'A', games: [[15, 13], [15, 13]] }, // C 0,  A 0
    ]);
    // A, B, C all 1 win and 0 diff: head-to-head is skipped (group of three), names decide.
    expect(poolStandings(teams, matches, games).map((r) => r.teamId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ignores matches that are not done', () => {
    const matches = [makeMatch({ id: 'm1', teamAId: 'A', teamBId: 'B', status: 'live' })];
    const rows = poolStandings(teams, matches, { m1: [{ gameNo: 1, scoreA: 15, scoreB: 3 }] });
    expect(rows.every((r) => r.played === 0)).toBe(true);
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'B', 'C', 'D']); // alphabetical by name
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/standings.test.ts
```

Expected: FAIL, cannot resolve `./standings`.

- [ ] **Step 3: Implement poolStandings**

`packages/tournament-core/src/standings.ts`:

```ts
import type { Game, Match, TeamRef } from './types';

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  gamesWon: number;
  gamesLost: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

/**
 * Standings for one pool, computed from done matches only.
 * Order: wins desc, point difference desc, head-to-head (two-way ties only), name asc.
 */
export function poolStandings(
  teams: readonly TeamRef[],
  matches: readonly Match[],
  gamesByMatch: Readonly<Record<string, readonly Game[]>>,
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const t of teams) {
    rows.set(t.id, {
      teamId: t.id, name: t.name, played: 0, won: 0, lost: 0,
      gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0,
    });
  }

  const done = matches.filter(
    (m) => m.status === 'done' && m.teamAId !== null && m.teamBId !== null && m.winnerId !== null,
  );

  for (const m of done) {
    const a = rows.get(m.teamAId!);
    const b = rows.get(m.teamBId!);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    if (m.winnerId === a.teamId) { a.won++; b.lost++; } else { b.won++; a.lost++; }
    for (const g of gamesByMatch[m.id] ?? []) {
      a.pointsFor += g.scoreA; a.pointsAgainst += g.scoreB;
      b.pointsFor += g.scoreB; b.pointsAgainst += g.scoreA;
      if (g.scoreA > g.scoreB) { a.gamesWon++; b.gamesLost++; } else { b.gamesWon++; a.gamesLost++; }
    }
  }
  for (const r of rows.values()) r.pointDiff = r.pointsFor - r.pointsAgainst;

  const tieKey = (r: StandingRow) => `${r.won}|${r.pointDiff}`;
  const tieGroupSize = new Map<string, number>();
  for (const r of rows.values()) tieGroupSize.set(tieKey(r), (tieGroupSize.get(tieKey(r)) ?? 0) + 1);

  const headToHead = (x: StandingRow, y: StandingRow): number => {
    const meeting = done.find(
      (m) => (m.teamAId === x.teamId && m.teamBId === y.teamId) || (m.teamAId === y.teamId && m.teamBId === x.teamId),
    );
    if (!meeting) return 0;
    return meeting.winnerId === x.teamId ? -1 : 1;
  };

  return [...rows.values()].sort((x, y) => {
    if (y.won !== x.won) return y.won - x.won;
    if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff;
    if (tieGroupSize.get(tieKey(x)) === 2) {
      const h = headToHead(x, y);
      if (h !== 0) return h;
    }
    return x.name.localeCompare(y.name);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/standings.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add poolStandings with tie-breaks" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Knockout bracket generation

**Files:**
- Create: `packages/tournament-core/src/bracket.ts`
- Test: `packages/tournament-core/src/bracket.test.ts`

**Interfaces:**
- Consumes: `Match`, `Side`.
- Produces:
  - `PoolResult { poolId: string; ranked: string[] }` (team ids in finishing order, from `poolStandings`)
  - `bracketSize(qualifiers: number): number` (next power of two, minimum 2)
  - `bracketOrder(size: number): number[]` (standard seed positions, e.g. size 8 â†’ `[1,8,4,5,2,7,3,6]`)
  - `seedQualifiers(pools: readonly PoolResult[], advancePerPool: number): string[]` (global seed order: all pool winners, then all runners-up, ... rotated to avoid same-pool first-round clashes)
  - `buildBracket(pools: readonly PoolResult[], advancePerPool: number, newId: () => string): Match[]` (all knockout matches, linked, byes resolved)

Placement rule: qualifier at global seed `k` sits at position `k` of `bracketOrder(size)`. First-round match `i` (1-based) takes positions `2i-1` and `2i`. Seeds beyond the qualifier count are byes.

- [ ] **Step 1: Write the failing tests**

`packages/tournament-core/src/bracket.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bracketSize, bracketOrder, seedQualifiers, buildBracket, type PoolResult } from './bracket';
import { idGen } from './testUtils';
import type { Match } from './types';

const pool = (name: string, n: number): PoolResult => ({
  poolId: name,
  ranked: Array.from({ length: n }, (_, i) => `${name}${i + 1}`),
});
const poolOf = (teamId: string) => teamId[0]!;
const round = (ms: Match[], r: number) => ms.filter((m) => m.round === r).sort((x, y) => x.slot - y.slot);

describe('bracketSize', () => {
  it('rounds up to a power of two, minimum 2', () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(4)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(8)).toBe(8);
    expect(bracketSize(9)).toBe(16);
  });
});

describe('bracketOrder', () => {
  it('produces the standard seeding layout', () => {
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('rejects non powers of two', () => {
    expect(() => bracketOrder(6)).toThrow('size must be a power of two');
  });
});

describe('seedQualifiers', () => {
  it('puts every pool winner ahead of every runner-up', () => {
    const seeds = seedQualifiers([pool('A', 4), pool('B', 4), pool('C', 4), pool('D', 4)], 2);
    expect(seeds.slice(0, 4).sort()).toEqual(['A1', 'B1', 'C1', 'D1']);
    expect(seeds.slice(4).sort()).toEqual(['A2', 'B2', 'C2', 'D2']);
  });
  it('throws when a pool is too small', () => {
    expect(() => seedQualifiers([pool('A', 1), pool('B', 2)], 2)).toThrow('pool A has fewer than 2 teams');
  });
});

describe('buildBracket', () => {
  it('two pools, top two: A1 v B2 and B1 v A2 into a final', () => {
    const ms = buildBracket([pool('A', 3), pool('B', 3)], 2, idGen());
    expect(ms).toHaveLength(3);
    const [r1a, r1b] = round(ms, 1);
    const [final] = round(ms, 2);
    expect(r1a).toMatchObject({ teamAId: 'A1', teamBId: 'B2', status: 'ready', nextMatchId: final!.id, nextMatchSide: 'a' });
    expect(r1b).toMatchObject({ teamAId: 'B1', teamBId: 'A2', status: 'ready', nextMatchId: final!.id, nextMatchSide: 'b' });
    expect(final).toMatchObject({ teamAId: null, teamBId: null, status: 'pending', nextMatchId: null, nextMatchSide: null });
  });

  it('four pools, top two: no same-pool clash in round one and A1, B1 in opposite halves', () => {
    const ms = buildBracket([pool('A', 4), pool('B', 4), pool('C', 4), pool('D', 4)], 2, idGen());
    expect(ms).toHaveLength(7);
    const r1 = round(ms, 1);
    expect(r1).toHaveLength(4);
    for (const m of r1) {
      expect(m.status).toBe('ready');
      expect(poolOf(m.teamAId!)).not.toBe(poolOf(m.teamBId!));
    }
    expect(r1.map((m) => [m.teamAId, m.teamBId])).toEqual([
      ['A1', 'D2'], ['D1', 'A2'], ['B1', 'C2'], ['C1', 'B2'],
    ]);
    const semis = round(ms, 2);
    expect(r1[0]!.nextMatchId).toBe(semis[0]!.id);
    expect(r1[1]!.nextMatchId).toBe(semis[0]!.id);
    expect(r1[2]!.nextMatchId).toBe(semis[1]!.id);
    expect(r1[3]!.nextMatchId).toBe(semis[1]!.id);
    expect(semis.every((m) => m.status === 'pending')).toBe(true);
    expect(round(ms, 3)).toHaveLength(1);
  });

  it('three pools, top two: pool winners A1 and B1 get byes and are placed into the semis', () => {
    const ms = buildBracket([pool('A', 3), pool('B', 3), pool('C', 3)], 2, idGen());
    expect(ms).toHaveLength(7);
    const r1 = round(ms, 1);
    const byes = r1.filter((m) => m.status === 'done');
    expect(byes.map((m) => m.winnerId).sort()).toEqual(['A1', 'B1']);
    for (const m of byes) expect(m.teamAId === null || m.teamBId === null).toBe(true);
    const played = r1.filter((m) => m.status === 'ready');
    expect(played).toHaveLength(2);
    for (const m of played) expect(poolOf(m.teamAId!)).not.toBe(poolOf(m.teamBId!));
    const semis = round(ms, 2);
    const semiTeams = semis.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean).sort();
    expect(semiTeams).toEqual(['A1', 'B1']);
    expect(semis.every((m) => m.status === 'pending')).toBe(true);
  });

  it('two pools, winners only: a single ready final', () => {
    const ms = buildBracket([pool('A', 3), pool('B', 3)], 1, idGen());
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ round: 1, slot: 1, teamAId: 'A1', teamBId: 'B1', status: 'ready', nextMatchId: null });
  });

  it('marks a second-round match ready when both of its feeders are byes', () => {
    // 5 qualifiers into 8: seeds 6,7,8 are byes. Positions 2v7 and 3v6 are both byes => semi 2 is ready.
    const ms = buildBracket([pool('A', 3), pool('B', 3), pool('C', 3), pool('D', 3), pool('E', 3)], 1, idGen());
    const semis = round(ms, 2);
    expect(semis.filter((m) => m.status === 'ready')).toHaveLength(1);
  });

  it('every non-final match links to a match in the next round', () => {
    const ms = buildBracket([pool('A', 4), pool('B', 4), pool('C', 4), pool('D', 4)], 2, idGen());
    const byId = new Map(ms.map((m) => [m.id, m]));
    for (const m of ms) {
      if (m.round === 3) { expect(m.nextMatchId).toBeNull(); continue; }
      const next = byId.get(m.nextMatchId!)!;
      expect(next.round).toBe(m.round! + 1);
      expect(next.slot).toBe(Math.ceil(m.slot / 2));
      expect(m.nextMatchSide).toBe(m.slot % 2 === 1 ? 'a' : 'b');
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/bracket.test.ts
```

Expected: FAIL, cannot resolve `./bracket`.

- [ ] **Step 3: Implement the bracket module**

`packages/tournament-core/src/bracket.ts`:

```ts
import type { Match } from './types';

export interface PoolResult {
  poolId: string;
  /** Team ids in finishing order, best first. */
  ranked: string[];
}

export function bracketSize(qualifiers: number): number {
  let size = 2;
  while (size < qualifiers) size *= 2;
  return size;
}

/** Standard bracket seed layout: 1 and 2 in opposite halves, 1 v size in round one, etc. */
export function bracketOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) throw new Error('size must be a power of two');
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

function firstRoundClashes(seeds: readonly string[], poolOf: ReadonlyMap<string, string>): number {
  const order = bracketOrder(bracketSize(seeds.length));
  let clashes = 0;
  for (let i = 0; i < order.length; i += 2) {
    const x = seeds[order[i]! - 1];
    const y = seeds[order[i + 1]! - 1];
    if (x !== undefined && y !== undefined && poolOf.get(x) === poolOf.get(y)) clashes++;
  }
  return clashes;
}

/**
 * Global seed order: all pool winners (in pool order), then all runners-up, and so on.
 * Within each rank tier the pool order is rotated by rank*shift; the smallest shift
 * that yields no same-pool first-round match is used. Seeds beyond the qualifier
 * count are byes, so pool winners receive byes first.
 */
export function seedQualifiers(pools: readonly PoolResult[], advancePerPool: number): string[] {
  const poolCount = pools.length;
  const poolOf = new Map<string, string>();
  for (const p of pools) {
    if (p.ranked.length < advancePerPool) throw new Error(`pool ${p.poolId} has fewer than ${advancePerPool} teams`);
    for (const id of p.ranked.slice(0, advancePerPool)) poolOf.set(id, p.poolId);
  }

  const build = (shift: number): string[] => {
    const out: string[] = [];
    for (let rank = 0; rank < advancePerPool; rank++) {
      for (let i = 0; i < poolCount; i++) {
        const p = pools[(i + rank * shift) % poolCount]!;
        out.push(p.ranked[rank]!);
      }
    }
    return out;
  };

  let best = build(0);
  let bestClashes = firstRoundClashes(best, poolOf);
  for (let shift = 1; shift < poolCount && bestClashes > 0; shift++) {
    const candidate = build(shift);
    const clashes = firstRoundClashes(candidate, poolOf);
    if (clashes < bestClashes) { best = candidate; bestClashes = clashes; }
  }
  return best;
}

export function buildBracket(pools: readonly PoolResult[], advancePerPool: number, newId: () => string): Match[] {
  const seeds = seedQualifiers(pools, advancePerPool);
  if (seeds.length < 2) throw new Error('need at least two qualifiers');
  const size = bracketSize(seeds.length);
  const order = bracketOrder(size);
  const rounds = Math.log2(size);

  const byRound: Match[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    byRound.push(
      Array.from({ length: count }, (_, i): Match => ({
        id: newId(), stage: 'knockout', poolId: null, round: r, slot: i + 1,
        teamAId: null, teamBId: null, court: null, status: 'pending',
        winnerId: null, nextMatchId: null, nextMatchSide: null,
      })),
    );
  }

  for (let r = 0; r < rounds - 1; r++) {
    byRound[r]!.forEach((m, i) => {
      m.nextMatchId = byRound[r + 1]![Math.floor(i / 2)]!.id;
      m.nextMatchSide = i % 2 === 0 ? 'a' : 'b';
    });
  }

  const all = byRound.flat();
  const byId = new Map(all.map((m) => [m.id, m]));
  const first = byRound[0]!;
  first.forEach((m, i) => {
    m.teamAId = seeds[order[2 * i]! - 1] ?? null;
    m.teamBId = seeds[order[2 * i + 1]! - 1] ?? null;
  });

  for (const m of first) {
    if (m.teamAId && m.teamBId) { m.status = 'ready'; continue; }
    const only = m.teamAId ?? m.teamBId;
    if (!only || !m.nextMatchId) continue;
    m.status = 'done';
    m.winnerId = only;
    const next = byId.get(m.nextMatchId)!;
    if (m.nextMatchSide === 'a') next.teamAId = only;
    else next.teamBId = only;
  }
  for (let r = 1; r < rounds; r++) {
    for (const m of byRound[r]!) if (m.teamAId && m.teamBId) m.status = 'ready';
  }
  return all;
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/bracket.test.ts
```

Expected: all pass. If the four-pool exact-pairs assertion fails, print `r1.map(...)` and check `seedQualifiers` returns `['A1','B1','C1','D1','A2','B2','C2','D2']` for shift 0; with `bracketOrder(8) = [1,8,4,5,2,7,3,6]` that yields A1 v D2, D1 v A2, B1 v C2, C1 v B2.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add knockout bracket generation with byes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Advancing a winner

**Files:**
- Create: `packages/tournament-core/src/advance.ts`
- Test: `packages/tournament-core/src/advance.test.ts`

**Interfaces:**
- Consumes: `Match`, `makeMatch`.
- Produces: `advance(matches: readonly Match[], matchId: string, winnerId: string): Match[]` returning only the changed matches as new objects: the completed match (status `done`, `winnerId` set, `court` null) and, if linked, the next match with the winner placed on the correct side and status `ready` when both sides are now known.

- [ ] **Step 1: Write the failing tests**

`packages/tournament-core/src/advance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { advance } from './advance';
import { makeMatch } from './testUtils';

const ko = (over: Parameters<typeof makeMatch>[0]) => makeMatch({ stage: 'knockout', ...over });

describe('advance', () => {
  const semi1 = ko({ id: 's1', round: 1, slot: 1, teamAId: 'A1', teamBId: 'B2', status: 'live', court: 2, nextMatchId: 'f', nextMatchSide: 'a' });
  const semi2 = ko({ id: 's2', round: 1, slot: 2, teamAId: 'B1', teamBId: 'A2', status: 'ready', nextMatchId: 'f', nextMatchSide: 'b' });
  const final = ko({ id: 'f', round: 2, slot: 1 });

  it('marks the match done, clears the court and fills the next match side', () => {
    const changed = advance([semi1, semi2, final], 's1', 'B2');
    expect(changed).toHaveLength(2);
    expect(changed[0]).toMatchObject({ id: 's1', status: 'done', winnerId: 'B2', court: null });
    expect(changed[1]).toMatchObject({ id: 'f', teamAId: 'B2', teamBId: null, status: 'pending' });
  });

  it('does not mutate the inputs', () => {
    advance([semi1, semi2, final], 's1', 'B2');
    expect(semi1.status).toBe('live');
    expect(final.teamAId).toBeNull();
  });

  it('makes the next match ready once both sides are known', () => {
    const halfFilled = { ...final, teamAId: 'B2' };
    const changed = advance([semi1, semi2, halfFilled], 's2', 'A2');
    expect(changed[1]).toMatchObject({ id: 'f', teamAId: 'B2', teamBId: 'A2', status: 'ready' });
  });

  it('returns only the match itself for the final', () => {
    const readyFinal = { ...final, teamAId: 'B2', teamBId: 'A2', status: 'ready' as const };
    const changed = advance([readyFinal], 'f', 'A2');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: 'f', status: 'done', winnerId: 'A2' });
  });

  it('rejects a winner who is not in the match', () => {
    expect(() => advance([semi1, semi2, final], 's1', 'C1')).toThrow('winner is not in this match');
  });

  it('rejects an unknown match', () => {
    expect(() => advance([semi1], 'nope', 'A1')).toThrow('unknown match nope');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/advance.test.ts
```

Expected: FAIL, cannot resolve `./advance`.

- [ ] **Step 3: Implement advance**

`packages/tournament-core/src/advance.ts`:

```ts
import type { Match } from './types';

/**
 * Complete a match and push the winner into the linked next match.
 * Returns new copies of every match that changed (1 or 2 matches).
 */
export function advance(matches: readonly Match[], matchId: string, winnerId: string): Match[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const match = byId.get(matchId);
  if (!match) throw new Error(`unknown match ${matchId}`);
  if (winnerId !== match.teamAId && winnerId !== match.teamBId) throw new Error('winner is not in this match');

  const completed: Match = { ...match, status: 'done', winnerId, court: null };
  const changed: Match[] = [completed];

  if (match.nextMatchId) {
    const next = byId.get(match.nextMatchId);
    if (!next) throw new Error(`unknown next match ${match.nextMatchId}`);
    const filled: Match = { ...next };
    if (match.nextMatchSide === 'a') filled.teamAId = winnerId;
    else filled.teamBId = winnerId;
    if (filled.teamAId && filled.teamBId && filled.status === 'pending') filled.status = 'ready';
    changed.push(filled);
  }
  return changed;
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/advance.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add advance" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rolling back a result

**Files:**
- Modify: `packages/tournament-core/src/advance.ts`
- Test: `packages/tournament-core/src/advance.test.ts` (append)

**Interfaces:**
- Consumes: `advance`, `Match`.
- Produces: `rollback(matches: readonly Match[], matchId: string): RollbackResult` where `RollbackResult = { changed: Match[]; resetMatchIds: string[] }`. `changed` holds new copies of every downstream match whose team slot was cleared (status reset to `pending`, `winnerId` and `court` null). `resetMatchIds` lists the downstream matches that had progressed past `ready` (status `live`, `submitted`, `disputed` or `done`) and therefore lose their games and submissions; the caller deletes those rows. The edited match itself is not returned; the caller re-enters its result and calls `advance` again.

- [ ] **Step 1: Append the failing tests**

Append to `packages/tournament-core/src/advance.test.ts` (add `rollback` to the import):

```ts
describe('rollback', () => {
  // Round 1: q1, q2 feed semi s1; q3, q4 feed semi s2; semis feed final f.
  const q1 = ko({ id: 'q1', round: 1, slot: 1, teamAId: 'A1', teamBId: 'D2', status: 'done', winnerId: 'A1', nextMatchId: 's1', nextMatchSide: 'a' });
  const q2 = ko({ id: 'q2', round: 1, slot: 2, teamAId: 'D1', teamBId: 'A2', status: 'done', winnerId: 'D1', nextMatchId: 's1', nextMatchSide: 'b' });
  const q3 = ko({ id: 'q3', round: 1, slot: 3, teamAId: 'B1', teamBId: 'C2', status: 'done', winnerId: 'B1', nextMatchId: 's2', nextMatchSide: 'a' });
  const q4 = ko({ id: 'q4', round: 1, slot: 4, teamAId: 'C1', teamBId: 'B2', status: 'ready', nextMatchId: 's2', nextMatchSide: 'b' });
  const s1 = ko({ id: 's1', round: 2, slot: 1, teamAId: 'A1', teamBId: 'D1', status: 'done', winnerId: 'A1', nextMatchId: 'f', nextMatchSide: 'a' });
  const s2 = ko({ id: 's2', round: 2, slot: 2, teamAId: 'B1', teamBId: null, status: 'pending', nextMatchId: 'f', nextMatchSide: 'b' });
  const f = ko({ id: 'f', round: 3, slot: 1, teamAId: 'A1', teamBId: null, status: 'pending' });
  const all = [q1, q2, q3, q4, s1, s2, f];

  it('clears the winner from a ready next match without flagging a reset', () => {
    const { changed, resetMatchIds } = rollback(all, 'q3');
    expect(resetMatchIds).toEqual([]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: 's2', teamAId: null, teamBId: null, status: 'pending', winnerId: null });
  });

  it('cascades through a done semi into the final and flags the semi for reset', () => {
    const { changed, resetMatchIds } = rollback(all, 'q1');
    expect(resetMatchIds).toEqual(['s1']);
    const byId = new Map(changed.map((m) => [m.id, m]));
    expect(byId.get('s1')).toMatchObject({ teamAId: null, teamBId: 'D1', status: 'pending', winnerId: null });
    expect(byId.get('f')).toMatchObject({ teamAId: null, teamBId: null, status: 'pending', winnerId: null });
    expect(changed).toHaveLength(2);
  });

  it('flags a live downstream match for reset and clears its court', () => {
    const liveFinal = { ...f, teamBId: 'B1', status: 'live' as const, court: 1 };
    const { changed, resetMatchIds } = rollback([...all.filter((m) => m.id !== 'f'), liveFinal], 's1');
    expect(resetMatchIds).toEqual(['f']);
    expect(changed[0]).toMatchObject({ id: 'f', teamAId: null, teamBId: 'B1', court: null, status: 'pending' });
  });

  it('does nothing for a match without a winner or without a next match', () => {
    expect(rollback(all, 'q4')).toEqual({ changed: [], resetMatchIds: [] });
    const doneFinal = { ...f, teamBId: 'B1', status: 'done' as const, winnerId: 'A1' };
    expect(rollback([doneFinal], 'f')).toEqual({ changed: [], resetMatchIds: [] });
  });

  it('does not mutate the inputs', () => {
    rollback(all, 'q1');
    expect(s1.teamAId).toBe('A1');
    expect(f.teamAId).toBe('A1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/advance.test.ts
```

Expected: FAIL, `rollback` is not exported.

- [ ] **Step 3: Implement rollback**

Append to `packages/tournament-core/src/advance.ts`:

```ts
export interface RollbackResult {
  /** Downstream matches that changed, as new objects. */
  changed: Match[];
  /** Downstream matches that were past 'ready' and lose their games and submissions. */
  resetMatchIds: string[];
}

/**
 * Undo the downstream effects of a match's current winner so its result can be re-entered.
 * Recurses through every match the old winner had reached.
 */
export function rollback(matches: readonly Match[], matchId: string): RollbackResult {
  const working = new Map(matches.map((m) => [m.id, { ...m }]));
  const match = working.get(matchId);
  if (!match) throw new Error(`unknown match ${matchId}`);

  const changed = new Map<string, Match>();
  const resetMatchIds: string[] = [];

  const clearDownstream = (from: Match): void => {
    const winner = from.winnerId;
    if (!winner || !from.nextMatchId) return;
    const next = working.get(from.nextMatchId);
    if (!next) return;
    if (next.teamAId !== winner && next.teamBId !== winner) return;

    if (next.status === 'done') clearDownstream(next);
    if (next.status !== 'pending' && next.status !== 'ready') resetMatchIds.push(next.id);

    if (next.teamAId === winner) next.teamAId = null;
    else next.teamBId = null;
    next.winnerId = null;
    next.court = null;
    next.status = 'pending';
    changed.set(next.id, next);
  };

  clearDownstream(match);
  return { changed: [...changed.values()], resetMatchIds };
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/advance.test.ts
```

Expected: all advance and rollback tests pass. Note the cascade test expects `resetMatchIds` to equal `['s1']` only: the final was `pending`, so it is cleared but not reset.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add rollback with downstream cascade" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Live board

**Files:**
- Create: `packages/tournament-core/src/liveBoard.ts`
- Test: `packages/tournament-core/src/liveBoard.test.ts`

**Interfaces:**
- Consumes: `Match`, `Stage`.
- Produces: `liveBoard(matches: readonly Match[], stage: Stage, poolOrder?: readonly string[]): LiveBoard` where `LiveBoard = { nowPlaying: Match[]; upNext: Match[] }`. `nowPlaying` is every `live` match sorted by court. `upNext` is, for the given stage, the lowest-slot `ready` match with no court per pool (pool stage, ordered by `poolOrder`) or per round (knockout, earliest round first).

- [ ] **Step 1: Write the failing tests**

`packages/tournament-core/src/liveBoard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { liveBoard } from './liveBoard';
import { makeMatch } from './testUtils';

describe('liveBoard', () => {
  const matches = [
    makeMatch({ id: 'a1', poolId: 'A', slot: 1, status: 'done', teamAId: 't1', teamBId: 't2', winnerId: 't1' }),
    makeMatch({ id: 'a2', poolId: 'A', slot: 2, status: 'live', court: 2, teamAId: 't3', teamBId: 't4' }),
    makeMatch({ id: 'a3', poolId: 'A', slot: 3, status: 'ready', teamAId: 't1', teamBId: 't3' }),
    makeMatch({ id: 'a4', poolId: 'A', slot: 4, status: 'ready', teamAId: 't2', teamBId: 't4' }),
    makeMatch({ id: 'b1', poolId: 'B', slot: 1, status: 'live', court: 1, teamAId: 't5', teamBId: 't6' }),
    makeMatch({ id: 'b2', poolId: 'B', slot: 2, status: 'ready', teamAId: 't7', teamBId: 't8' }),
    makeMatch({ id: 'c1', poolId: 'C', slot: 1, status: 'submitted', teamAId: 't9', teamBId: 't10' }),
  ];

  it('lists live matches ordered by court', () => {
    expect(liveBoard(matches, 'pool', ['A', 'B', 'C']).nowPlaying.map((m) => m.id)).toEqual(['b1', 'a2']);
  });

  it('picks the lowest ready slot per pool in pool order', () => {
    expect(liveBoard(matches, 'pool', ['A', 'B', 'C']).upNext.map((m) => m.id)).toEqual(['a3', 'b2']);
    expect(liveBoard(matches, 'pool', ['B', 'A', 'C']).upNext.map((m) => m.id)).toEqual(['b2', 'a3']);
  });

  it('skips ready matches already sent to a court', () => {
    const withCourt = matches.map((m) => (m.id === 'a3' ? { ...m, court: 3 } : m));
    expect(liveBoard(withCourt, 'pool', ['A', 'B']).upNext.map((m) => m.id)).toEqual(['a4', 'b2']);
  });

  it('in the knockout picks the lowest ready slot per round, earliest round first', () => {
    const ko = [
      makeMatch({ id: 'r1s1', stage: 'knockout', round: 1, slot: 1, status: 'done', winnerId: 'x' }),
      makeMatch({ id: 'r1s2', stage: 'knockout', round: 1, slot: 2, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'r1s3', stage: 'knockout', round: 1, slot: 3, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'r2s1', stage: 'knockout', round: 2, slot: 1, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'r2s2', stage: 'knockout', round: 2, slot: 2, status: 'pending' }),
    ];
    expect(liveBoard(ko, 'knockout').upNext.map((m) => m.id)).toEqual(['r1s2', 'r2s1']);
  });

  it('only considers matches from the requested stage', () => {
    const mixed = [...matches, makeMatch({ id: 'k1', stage: 'knockout', round: 1, slot: 1, status: 'ready', teamAId: 'x', teamBId: 'y' })];
    expect(liveBoard(mixed, 'knockout').upNext.map((m) => m.id)).toEqual(['k1']);
    expect(liveBoard(mixed, 'knockout').nowPlaying).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```powershell
npm test -w @tournament/core -- src/liveBoard.test.ts
```

Expected: FAIL, cannot resolve `./liveBoard`.

- [ ] **Step 3: Implement liveBoard**

`packages/tournament-core/src/liveBoard.ts`:

```ts
import type { Match, Stage } from './types';

export interface LiveBoard {
  nowPlaying: Match[];
  upNext: Match[];
}

export function liveBoard(matches: readonly Match[], stage: Stage, poolOrder: readonly string[] = []): LiveBoard {
  const nowPlaying = matches
    .filter((m) => m.status === 'live')
    .sort((x, y) => (x.court ?? Number.MAX_SAFE_INTEGER) - (y.court ?? Number.MAX_SAFE_INTEGER));

  const groupKey = (m: Match) => (stage === 'pool' ? `pool:${m.poolId}` : `round:${m.round}`);
  const best = new Map<string, Match>();
  for (const m of matches) {
    if (m.stage !== stage || m.status !== 'ready' || m.court !== null) continue;
    const current = best.get(groupKey(m));
    if (!current || m.slot < current.slot) best.set(groupKey(m), m);
  }

  const upNext = [...best.values()].sort((x, y) =>
    stage === 'pool'
      ? poolOrder.indexOf(x.poolId ?? '') - poolOrder.indexOf(y.poolId ?? '')
      : (x.round ?? 0) - (y.round ?? 0),
  );

  return { nowPlaying, upNext };
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
npm test -w @tournament/core -- src/liveBoard.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(core): add liveBoard" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Public API, full-tournament simulation, README

**Files:**
- Modify: `packages/tournament-core/src/index.ts`
- Modify: `packages/tournament-core/src/index.test.ts`
- Create: `packages/tournament-core/src/simulation.test.ts`
- Create: `packages/tournament-core/README.md`

**Interfaces:**
- Produces: `@tournament/core` exports everything from `types`, `scoring`, `pools`, `standings`, `bracket`, `advance`, `liveBoard`. Later plans import only from the package root.

- [ ] **Step 1: Write the failing export test**

Replace `packages/tournament-core/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as core from './index';

describe('public API', () => {
  it('exports every rule function', () => {
    const expected = [
      'BADMINTON_DEFAULTS', 'validateGame', 'matchResult', 'gamesNeeded',
      'shuffle', 'assignPools', 'roundRobin', 'poolMatches',
      'poolStandings', 'bracketSize', 'bracketOrder', 'seedQualifiers', 'buildBracket',
      'advance', 'rollback', 'liveBoard',
    ];
    for (const name of expected) expect(core, name).toHaveProperty(name);
  });
});
```

- [ ] **Step 2: Write the failing simulation test**

`packages/tournament-core/src/simulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  BADMINTON_DEFAULTS, assignPools, poolMatches, poolStandings, buildBracket,
  advance, rollback, matchResult, liveBoard, type Match, type Game, type TeamRef, type PoolResult,
} from './index';
import { seededRng, idGen } from './testUtils';

/** Team strength = numeric suffix; lower number always wins 15-10, 15-10. */
const strength = (id: string) => Number(id.slice(1));
const playedGames = (): Game[] => [{ gameNo: 1, scoreA: 15, scoreB: 10 }, { gameNo: 2, scoreA: 15, scoreB: 10 }];

function playAll(matches: Match[], games: Record<string, Game[]>): Match[] {
  let state = matches;
  for (;;) {
    const next = state.find((m) => m.status === 'ready');
    if (!next) return state;
    const aStronger = strength(next.teamAId!) < strength(next.teamBId!);
    const g = playedGames();
    if (!aStronger) for (const x of g) [x.scoreA, x.scoreB] = [x.scoreB, x.scoreA];
    const result = matchResult(BADMINTON_DEFAULTS, g);
    if (!result.ok || !result.complete) throw new Error('bad simulated result');
    games[next.id] = g;
    const winner = result.winner === 'a' ? next.teamAId! : next.teamBId!;
    const changed = new Map(advance(state, next.id, winner).map((m) => [m.id, m]));
    state = state.map((m) => changed.get(m.id) ?? m);
  }
}

describe('a 16-team, 4-pool tournament', () => {
  const teams: TeamRef[] = Array.from({ length: 16 }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}` }));
  const newId = idGen();
  const games: Record<string, Game[]> = {};

  const poolIds = ['A', 'B', 'C', 'D'];
  const dealt = assignPools(teams.map((t) => t.id), 4, seededRng(2026));
  let pool = poolIds.flatMap((pid, i) => poolMatches(pid, dealt[i]!, newId));

  it('creates 24 pool matches', () => {
    expect(pool).toHaveLength(24);
    expect(liveBoard(pool, 'pool', poolIds).upNext).toHaveLength(4);
  });

  it('plays every pool match and ranks each pool by strength', () => {
    pool = playAll(pool, games);
    expect(pool.every((m) => m.status === 'done')).toBe(true);
    for (const [i, pid] of poolIds.entries()) {
      const rows = poolStandings(teams.filter((t) => dealt[i]!.includes(t.id)), pool.filter((m) => m.poolId === pid), games);
      const byStrength = [...dealt[i]!].sort((x, y) => strength(x) - strength(y));
      expect(rows.map((r) => r.teamId)).toEqual(byStrength);
      expect(rows[0]!.won).toBe(3);
    }
  });

  it('builds an 8-team bracket and crowns the strongest team', () => {
    const results: PoolResult[] = poolIds.map((pid, i) => ({
      poolId: pid,
      ranked: poolStandings(teams.filter((t) => dealt[i]!.includes(t.id)), pool.filter((m) => m.poolId === pid), games).map((r) => r.teamId),
    }));
    let ko = buildBracket(results, 2, newId);
    expect(ko).toHaveLength(7);
    ko = playAll(ko, games);
    const final = ko.find((m) => m.round === 3)!;
    expect(final.status).toBe('done');
    expect(final.winnerId).toBe('t1');
  });

  it('can roll back a quarter-final and replay it', () => {
    const results: PoolResult[] = poolIds.map((pid, i) => ({
      poolId: pid,
      ranked: poolStandings(teams.filter((t) => dealt[i]!.includes(t.id)), pool.filter((m) => m.poolId === pid), games).map((r) => r.teamId),
    }));
    let ko = playAll(buildBracket(results, 2, idGen('k')), {});
    const qf = ko.find((m) => m.round === 1 && m.teamAId === 't1' || m.round === 1 && m.teamBId === 't1')!;
    const { changed, resetMatchIds } = rollback(ko, qf.id);
    expect(resetMatchIds.sort()).toEqual(ko.filter((m) => m.round! > 1 && [m.teamAId, m.teamBId].includes('t1')).map((m) => m.id).sort());
    const changedMap = new Map(changed.map((m) => [m.id, m]));
    ko = ko.map((m) => changedMap.get(m.id) ?? m);
    // Re-enter the quarter-final with the other team winning this time.
    const loser = qf.teamAId === 't1' ? qf.teamBId! : qf.teamAId!;
    const redo = new Map(advance(ko, qf.id, loser).map((m) => [m.id, m]));
    ko = ko.map((m) => redo.get(m.id) ?? m);
    ko = playAll(ko, {});
    const final = ko.find((m) => m.round === 3)!;
    expect(final.status).toBe('done');
    expect(final.winnerId).not.toBe('t1');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```powershell
npm test -w @tournament/core
```

Expected: FAIL, `core` has no export `validateGame`, and `./index` has no export `assignPools`.

- [ ] **Step 4: Write the index**

Replace `packages/tournament-core/src/index.ts`:

```ts
export const VERSION = '0.1.0';

export * from './types';
export * from './scoring';
export * from './pools';
export * from './standings';
export * from './bracket';
export * from './advance';
export * from './liveBoard';
```

- [ ] **Step 5: Run the full suite and typecheck**

```powershell
npm test -w @tournament/core
npm run typecheck -w @tournament/core
```

Expected: all test files pass, `tsc` exits 0 with no output. If the rollback simulation's `resetMatchIds` assertion fails, check that the semi and final containing `t1` were both `done` before rollback; they should be, because `playAll` finished the bracket.

- [ ] **Step 6: Write the README**

`packages/tournament-core/README.md`:

```markdown
# @tournament/core

Pure tournament rules. No database, no UI, no runtime dependencies. Every function
takes plain objects in and returns new objects out; nothing is mutated.

Sport-specific behaviour lives in `Settings` (`gamesPerMatch`, `pointsPerGame`,
`winByTwo`, `maxPoints`). `BADMINTON_DEFAULTS` is best of 3 to 15, win by two, cap 21.

| Function | Purpose |
|---|---|
| `validateGame(settings, a, b)` | Is this a legal finished game score? Returns the winning side or a reason. |
| `matchResult(settings, games)` | Winner of a match from its games, or incomplete, or an error naming the bad game. |
| `assignPools(teamIds, poolCount, rng)` | Shuffle and deal teams into pools. Seeds are ignored on purpose. |
| `roundRobin(teamIds)` / `poolMatches(poolId, teamIds, newId)` | Every-team-plays-every-team schedule, as pairings or as ready `Match` rows. |
| `poolStandings(teams, matches, gamesByMatch)` | Table ordered by wins, point difference, head-to-head, name. |
| `buildBracket(poolResults, advancePerPool, newId)` | Single-elimination tree from pool finishing positions, with byes resolved and matches linked. |
| `advance(matches, matchId, winnerId)` | Complete a match and place the winner in the next one. |
| `rollback(matches, matchId)` | Undo a result's downstream effects before re-entering it. |
| `liveBoard(matches, stage, poolOrder)` | "Now playing" by court and "up next" per pool or round. |

Run tests: `npm test -w @tournament/core`.
```

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat(core): export public API, add full tournament simulation and README" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for this plan

- `npm test -w @tournament/core` passes with test files for scoring, pools, standings, bracket, advance, liveBoard, index and simulation.
- `npm run typecheck -w @tournament/core` passes.
- `packages/tournament-core/package.json` has no `dependencies` field.
- Plan 2 (Supabase schema and Next.js admin/public app) can import every function listed in the README from `@tournament/core`.
