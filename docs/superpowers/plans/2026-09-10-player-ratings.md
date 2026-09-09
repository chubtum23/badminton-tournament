# Player Ratings and Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every player a 1.0-10.0 rating for each game they play, entered by the organiser alongside the score, and publish the averages as a public leaderboard with an individual and a team view.

**Architecture:** The arithmetic is pure and lives in `packages/tournament-core/src/ratings.ts` beside `leaderboard.ts`. Ratings are stored one row per `(match, game, player)` in a new `player_ratings` table with the same public-read / admin-write RLS as `games`. The organiser enters them in the existing `GameScoreForm`, and `saveGameScore` writes score and ratings in one call. A new public `/t/[slug]/players` page renders the two leaderboards.

**Tech Stack:** TypeScript, Next.js 15 App Router (server components + server actions), Supabase Postgres with RLS, Vitest for unit and integration tests, Playwright for end to end.

Spec: `docs/superpowers/specs/2026-09-10-player-ratings-design.md`.

## Global Constraints

- A rating is `numeric(3,1)`, between 1 and 10 inclusive, one decimal place. Never an integer type.
- The suggestion formula is exactly `clamp(1, 10, round1(5.5 + 4 * clamp(-1, 1, (own - opp) / pointsPerGame)))`.
- `pointsPerGame` always comes from `settingsFor(tournament, match.stage)`, never from the tournament row directly, so knockout overrides apply.
- Who plays a game is never stored or entered: it is derived with `pairFor(rosterOf(team), pairSlotForGame(gameNo))`.
- Every interactive element and table the Playwright specs touch carries a `data-testid`. Specs never select on CSS classes.
- Styling uses the tokens in `apps/web/src/components/ui.ts` and `tailwind.config.ts`. No new colours, no border radius.
- Comments explain *why*, matching the density and voice of the surrounding files.
- Run unit tests with `npm test -w @tournament/core` and `npm test -w @tournament/web`; typecheck with `npm run typecheck`.

---

### Task 1: The rating arithmetic in tournament-core

**Files:**
- Create: `packages/tournament-core/src/ratings.ts`
- Create: `packages/tournament-core/src/ratings.test.ts`
- Modify: `packages/tournament-core/src/index.ts` (add one export line)

**Interfaces:**
- Consumes: `Settings` from `./types`.
- Produces:
  - `round1(n: number): number`
  - `suggestRating(settings: Settings, own: number, opp: number): number`
  - `interface RatedPlayer { id: string; name: string; teamId: string; teamName: string }`
  - `interface RatingEntry { playerId: string; rating: number }`
  - `interface PlayerRatingRow { playerId: string; name: string; teamId: string; teamName: string; gamesRated: number; average: number | null; rank: number | null }`
  - `interface TeamRatingRow { teamId: string; name: string; playersRated: number; average: number | null; rank: number | null }`
  - `playerRatings(players: readonly RatedPlayer[], ratings: readonly RatingEntry[]): PlayerRatingRow[]`
  - `teamRatings(rows: readonly PlayerRatingRow[]): TeamRatingRow[]`

- [ ] **Step 1: Write the failing test**

Create `packages/tournament-core/src/ratings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BADMINTON_DEFAULTS } from './types';
import { playerRatings, round1, suggestRating, teamRatings, type RatedPlayer } from './ratings';

const S = BADMINTON_DEFAULTS; // 15 points a game

describe('suggestRating', () => {
  it('suggests the middle of the scale for a level game', () => {
    expect(suggestRating(S, 10, 10)).toBe(5.5);
  });

  it('matches the worked examples in the spec', () => {
    expect(suggestRating(S, 15, 13)).toBe(6);
    expect(suggestRating(S, 13, 15)).toBe(5);
    expect(suggestRating(S, 15, 9)).toBe(7.1);
    expect(suggestRating(S, 9, 15)).toBe(3.9);
    expect(suggestRating(S, 15, 3)).toBe(8.7);
    expect(suggestRating(S, 3, 15)).toBe(2.3);
    expect(suggestRating(S, 15, 0)).toBe(9.5);
    expect(suggestRating(S, 0, 15)).toBe(1.5);
  });

  it('clamps a margin wider than a whole game', () => {
    // A game that ran past pointsPerGame (win by two) cannot push the suggestion past its ends.
    expect(suggestRating(S, 30, 0)).toBe(9.5);
    expect(suggestRating(S, 0, 30)).toBe(1.5);
  });

  it('scales with the stage settings rather than a fixed 15', () => {
    const ko = { ...S, pointsPerGame: 21 };
    expect(suggestRating(ko, 21, 0)).toBe(9.5);
    expect(suggestRating(ko, 21, 15)).toBe(6.6); // 6/21 = 0.2857 -> 5.5 + 1.143
  });

  it('always returns one decimal place', () => {
    expect(round1(7.249)).toBe(7.2);
    expect(round1(7.25)).toBe(7.3);
    expect(Number.isInteger(suggestRating(S, 15, 5) * 10)).toBe(true);
  });
});

const PLAYERS: RatedPlayer[] = [
  { id: 'p1', name: 'Ana', teamId: 't1', teamName: 'Alpha' },
  { id: 'p2', name: 'Ben', teamId: 't1', teamName: 'Alpha' },
  { id: 'p3', name: 'Cara', teamId: 't1', teamName: 'Alpha' },
  { id: 'p4', name: 'Dan', teamId: 't2', teamName: 'Bravo' },
];

describe('playerRatings', () => {
  it('averages a player over every game they were rated in', () => {
    const rows = playerRatings(PLAYERS, [
      { playerId: 'p1', rating: 8 }, { playerId: 'p1', rating: 7 }, { playerId: 'p1', rating: 6 },
    ]);
    const ana = rows.find((r) => r.playerId === 'p1')!;
    expect(ana.gamesRated).toBe(3);
    expect(ana.average).toBe(7);
    expect(ana.rank).toBe(1);
  });

  it('keeps one decimal place on the average', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'p1', rating: 8 }, { playerId: 'p1', rating: 7.1 }]);
    expect(rows[0]!.average).toBe(7.6); // 7.55 rounds up
  });

  it('gives players showing the same average the same rank, and the next player the next rank', () => {
    const rows = playerRatings(PLAYERS, [
      { playerId: 'p1', rating: 7.4 }, { playerId: 'p2', rating: 7.4 }, { playerId: 'p4', rating: 6 },
    ]);
    const ranks = Object.fromEntries(rows.map((r) => [r.playerId, r.rank]));
    expect(ranks).toMatchObject({ p1: 1, p2: 1, p4: 2 });
  });

  it('orders equal averages by name', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'p2', rating: 7 }, { playerId: 'p1', rating: 7 }]);
    expect(rows.slice(0, 2).map((r) => r.name)).toEqual(['Ana', 'Ben']);
  });

  it('sorts unrated players last, with no average and no rank', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'p4', rating: 2 }]);
    expect(rows[0]!.playerId).toBe('p4');
    const unrated = rows.slice(1);
    expect(unrated).toHaveLength(3);
    expect(unrated.every((r) => r.average === null && r.rank === null && r.gamesRated === 0)).toBe(true);
  });

  it('returns nothing for a tournament with no players', () => {
    expect(playerRatings([], [])).toEqual([]);
  });

  it('ignores a rating for a player it was not given', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'ghost', rating: 9 }]);
    expect(rows.every((r) => r.average === null)).toBe(true);
  });
});

describe('teamRatings', () => {
  it('averages the players averages, not the raw ratings', () => {
    // Ana plays twice at 9 and 9, Ben once at 3. Player averages are 9 and 3, so the team is 6 -
    // an average over the three ratings would have been 7.
    const rows = teamRatings(playerRatings(PLAYERS, [
      { playerId: 'p1', rating: 9 }, { playerId: 'p1', rating: 9 }, { playerId: 'p2', rating: 3 },
    ]));
    expect(rows.find((r) => r.teamId === 't1')).toMatchObject({ average: 6, playersRated: 2, rank: 1 });
  });

  it('leaves an unrated player out of the mean rather than counting them as zero', () => {
    const rows = teamRatings(playerRatings(PLAYERS, [{ playerId: 'p1', rating: 8 }]));
    expect(rows.find((r) => r.teamId === 't1')).toMatchObject({ average: 8, playersRated: 1 });
  });

  it('sorts a team with nobody rated last, with no average and no rank', () => {
    const rows = teamRatings(playerRatings(PLAYERS, [{ playerId: 'p1', rating: 8 }]));
    expect(rows.map((r) => r.teamId)).toEqual(['t1', 't2']);
    expect(rows[1]).toMatchObject({ average: null, rank: null, playersRated: 0 });
  });

  it('gives level teams the same rank', () => {
    const rows = teamRatings(playerRatings(PLAYERS, [{ playerId: 'p1', rating: 5 }, { playerId: 'p4', rating: 5 }]));
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -w @tournament/core -- ratings`
Expected: FAIL — `Failed to resolve import "./ratings"`.

- [ ] **Step 3: Write the implementation**

Create `packages/tournament-core/src/ratings.ts`:

```ts
import type { Settings } from './types';

/** A player as the leaderboard needs them: the person plus the team they played for. */
export interface RatedPlayer {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
}

/** One rating the organiser gave, flattened out of its game. */
export interface RatingEntry {
  playerId: string;
  rating: number;
}

export interface PlayerRatingRow {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  gamesRated: number;
  /** null until the player has been rated at least once. */
  average: number | null;
  /** Dense rank over the average as displayed; null while the player has no average. */
  rank: number | null;
}

export interface TeamRatingRow {
  teamId: string;
  name: string;
  playersRated: number;
  average: number | null;
  rank: number | null;
}

/** One decimal place, which is the whole precision of the scale: nothing stores more than this. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * What to put in the box before the organiser touches it, from the margin of that game alone.
 *
 * 5.5 is the exact middle of 1-10, so a level game suggests the middle to all four players and the
 * two sides are always symmetrical about it. The margin is measured against the game's own target
 * score, so a knockout played to 21 scales the same way a pool game to 15 does, and a game that ran
 * past its target (win by two) is clamped rather than pushed off the end of the scale.
 */
export function suggestRating(settings: Settings, own: number, opp: number): number {
  const d = clamp((own - opp) / settings.pointsPerGame, -1, 1);
  return round1(clamp(5.5 + 4 * d, 1, 10));
}

/**
 * Dense ranks down a list already in display order: equal averages share a number and the next
 * distinct average takes the next one. Rows with no average are never ranked.
 */
function denseRank<T extends { average: number | null }>(rows: T[]): (T & { rank: number | null })[] {
  let rank = 0;
  let previous: number | null = null;
  return rows.map((row) => {
    if (row.average === null) return { ...row, rank: null };
    if (row.average !== previous) { rank += 1; previous = row.average; }
    return { ...row, rank };
  });
}

/** Rated rows first by average descending, then by name; everyone unrated after them, by name. */
function byAverageThenName(a: { average: number | null; name: string }, b: { average: number | null; name: string }): number {
  if (a.average === null && b.average === null) return a.name.localeCompare(b.name);
  if (a.average === null) return 1;
  if (b.average === null) return -1;
  if (a.average !== b.average) return b.average - a.average;
  return a.name.localeCompare(b.name);
}

/**
 * Every player of the tournament with the mean of their ratings. Raw averages, deliberately: a
 * player rated once sits wherever that one rating puts them, and the `gamesRated` column beside it
 * is what tells the reader how much to trust the number.
 *
 * Ranks compare the average as displayed (one decimal), so two players both showing 7.4 always
 * share a rank even though the underlying means differ in the third decimal.
 */
export function playerRatings(players: readonly RatedPlayer[], ratings: readonly RatingEntry[]): PlayerRatingRow[] {
  const byPlayer = new Map<string, number[]>();
  for (const r of ratings) {
    const list = byPlayer.get(r.playerId);
    if (list) list.push(r.rating); else byPlayer.set(r.playerId, [r.rating]);
  }
  const rows = players.map((p) => {
    const mine = byPlayer.get(p.id) ?? [];
    return {
      playerId: p.id, name: p.name, teamId: p.teamId, teamName: p.teamName,
      gamesRated: mine.length,
      average: mine.length === 0 ? null : round1(mine.reduce((s, v) => s + v, 0) / mine.length),
    };
  });
  return denseRank(rows.sort(byAverageThenName));
}

/**
 * A team scores the mean of its players' averages, so a substitute who played one game counts as
 * much as someone who played four. A player nobody has rated is left out of the mean rather than
 * counted as a zero, which would drag a team down for a game that was never played.
 */
export function teamRatings(rows: readonly PlayerRatingRow[]): TeamRatingRow[] {
  const teams = new Map<string, { teamId: string; name: string; averages: number[] }>();
  for (const r of rows) {
    const team = teams.get(r.teamId) ?? { teamId: r.teamId, name: r.teamName, averages: [] };
    if (r.average !== null) team.averages.push(r.average);
    teams.set(r.teamId, team);
  }
  const out = [...teams.values()].map((t) => ({
    teamId: t.teamId, name: t.name, playersRated: t.averages.length,
    average: t.averages.length === 0 ? null : round1(t.averages.reduce((s, v) => s + v, 0) / t.averages.length),
  }));
  return denseRank(out.sort(byAverageThenName));
}
```

- [ ] **Step 4: Export it**

Add to the end of `packages/tournament-core/src/index.ts`:

```ts
export * from './ratings';
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm test -w @tournament/core && npm run typecheck -w @tournament/core`
Expected: every test passes (the whole core suite, not only the new file), typecheck silent.

- [ ] **Step 6: Commit**

```bash
git add packages/tournament-core/src/ratings.ts packages/tournament-core/src/ratings.test.ts packages/tournament-core/src/index.ts
git commit -m "feat(core): rate a player out of 10 and average it into two leaderboards"
```

---

### Task 2: The player_ratings table and the query that reads it

**Files:**
- Create: `supabase/migrations/20260910120000_player_ratings.sql`
- Modify: `apps/web/src/lib/db/types.ts` (add `RatingRow` after `ScoredGameRow`)
- Modify: `apps/web/src/lib/db/queries.ts` (add `listPlayerRatings`, extend `TournamentBundle` and `loadTournamentBundle`)
- Modify: `apps/web/src/integration/rls.integration.test.ts` (add the ratings cases)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface RatingRow { match_id: string; game_no: number; player_id: string; rating: number }`
  - `listPlayerRatings(sb: SupabaseClient, tournamentId: string): Promise<RatingRow[]>`
  - `TournamentBundle.ratings: RatingRow[]`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260910120000_player_ratings.sql`:

```sql
-- v1.4: the organiser rates every player out of 10 for each game they play.
--
-- Who played a game is not recorded here, because it is already known: a team is two men and one
-- woman with fixed roles, so the pair on court follows from the game number. This table only
-- carries the judgement.

create table public.player_ratings (
  match_id  uuid not null,
  game_no   int  not null,
  player_id uuid not null references public.players(id) on delete cascade,
  rating    numeric(3,1) not null check (rating >= 1 and rating <= 10),
  primary key (match_id, game_no, player_id),
  foreign key (match_id, game_no) references public.games(match_id, game_no) on delete cascade
);

-- The leaderboard groups by player; the primary key already covers reads by game.
create index player_ratings_player_idx on public.player_ratings (player_id);

alter table public.player_ratings enable row level security;

-- Same shape as games: no tournament_id of its own, so the admin check resolves through the match.
create policy player_ratings_read on public.player_ratings for select using (true);
create policy player_ratings_write on public.player_ratings for all to authenticated
  using (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)))
  with check (public.is_tournament_admin((select tournament_id from public.matches where id = match_id)));
```

- [ ] **Step 2: Apply it and confirm the constraint bites**

Run: `npx supabase db push` (or `npx supabase db reset` locally, which re-seeds).
Then check the check constraint holds, using the service role in `psql` or the Supabase SQL editor:

```sql
insert into public.player_ratings (match_id, game_no, player_id, rating)
values ('00000000-0000-0000-0000-000000000000', 1, '00000000-0000-0000-0000-000000000000', 11);
```

Expected: the statement is rejected. Either error is a pass — the foreign key fires first on an
empty database, and the `rating >= 1 and rating <= 10` check fires when the ids are real.

Note: a local `db reset` wipes the seeded admin user. Re-run `npm run seed:admin -w @tournament/web` afterwards.

- [ ] **Step 3: Add the row type**

In `apps/web/src/lib/db/types.ts`, directly after the `ScoredGameRow` type:

```ts
/**
 * One player's mark out of 10 for one game. `rating` is `numeric(3,1)` in Postgres, so it arrives
 * as a JSON number with a single decimal place; nothing in the app widens it.
 */
export interface RatingRow {
  match_id: string;
  game_no: number;
  player_id: string;
  rating: number;
}
```

- [ ] **Step 4: Add the query**

In `apps/web/src/lib/db/queries.ts`, import `RatingRow` alongside the other row types, and add this
function directly after `listGames`:

```ts
// NOT cached: `saveGameScore` deletes and re-inserts a game's ratings, and the Players page is
// rendered from a fresh request, so memoising this would only risk handing an action stale rows.
export async function listPlayerRatings(sb: SupabaseClient, tournamentId: string): Promise<RatingRow[]> {
  // player_ratings has no tournament_id; join through matches, exactly as listGames does.
  const res = await sb
    .from('player_ratings')
    .select('match_id, game_no, player_id, rating, matches!inner(tournament_id)')
    .eq('matches.tournament_id', tournamentId);
  const rows = must(res, 'player ratings') as Array<RatingRow & { matches: unknown }>;
  return rows.map(({ match_id, game_no, player_id, rating }) => ({ match_id, game_no, player_id, rating: Number(rating) }));
}
```

Then extend the bundle. In `interface TournamentBundle`, after `submissions: SubmissionRow[];`, add:

```ts
  ratings: RatingRow[];
```

and in `loadTournamentBundle`, change the destructuring and the `Promise.all` to include it:

```ts
  const [pools, teams, matches, games, submissions, announcements, ratings] = await Promise.all([
    listPools(sb, tournament.id), listTeamsWithPlayers(sb, tournament.id), listMatches(sb, tournament.id), listGames(sb, tournament.id),
    listSubmissions(sb, tournament.id), listAnnouncements(sb, tournament.id), listPlayerRatings(sb, tournament.id),
  ]);
  return { tournament, pools, teams, matches, games, submissions, announcements, ratings };
```

- [ ] **Step 5: Write the RLS test**

In `apps/web/src/integration/rls.integration.test.ts`, add this nested describe at the end of the
outer `describe` block. It builds the match, game and player it needs, because the existing setup
creates only a team:

```ts
  describe('player ratings', () => {
    let matchId: string;
    let playerId: string;

    beforeAll(async () => {
      const player = await service.from('players')
        .insert({ tournament_id: tournamentId, name: 'Rated One', gender: 'male' }).select('id').single();
      if (player.error) throw player.error;
      playerId = player.data.id;
      const match = await service.from('matches')
        .insert({ tournament_id: tournamentId, stage: 'knockout', round: 1, slot: 1 }).select('id').single();
      if (match.error) throw match.error;
      matchId = match.data.id;
      const game = await service.from('games').insert({ match_id: matchId, game_no: 1 });
      if (game.error) throw game.error;
    });

    it('an admin can write a rating', async () => {
      const res = await admin.from('player_ratings')
        .insert({ match_id: matchId, game_no: 1, player_id: playerId, rating: 7.4 }).select('rating').single();
      expect(res.error).toBeNull();
      expect(Number(res.data!.rating)).toBe(7.4);
    });

    it('anon can read ratings', async () => {
      const res = await anon.from('player_ratings').select('rating').eq('match_id', matchId);
      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
    });

    it('anon cannot write a rating', async () => {
      const res = await anon.from('player_ratings')
        .insert({ match_id: matchId, game_no: 1, player_id: playerId, rating: 5 });
      expect(res.error).not.toBeNull();
    });

    it('a signed-in non-admin cannot write a rating', async () => {
      const res = await outsider.from('player_ratings')
        .insert({ match_id: matchId, game_no: 1, player_id: playerId, rating: 5 });
      expect(res.error).not.toBeNull();
    });

    it('the database refuses a rating off the scale', async () => {
      const res = await admin.from('player_ratings')
        .insert({ match_id: matchId, game_no: 1, player_id: playerId, rating: 10.5 });
      expect(res.error).not.toBeNull();
    });
  });
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npm test -w @tournament/web && npm run typecheck -w @tournament/web`
Expected: the RLS suite runs (it self-skips without `.env.local`; with local Supabase up, the five new cases pass) and typecheck is silent.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260910120000_player_ratings.sql apps/web/src/lib/db/types.ts apps/web/src/lib/db/queries.ts apps/web/src/integration/rls.integration.test.ts
git commit -m "feat(db): store a rating per player per game, public to read and admin to write"
```

---

### Task 3: Parsing and persisting ratings with the score

**Files:**
- Create: `apps/web/src/lib/results/ratings.ts`
- Create: `apps/web/src/lib/results/ratings.test.ts`
- Modify: `apps/web/src/actions/games.ts` (`saveGameScore`, `clearGameScore`)
- Modify: `apps/web/src/lib/results/persist.ts` (`applyResultPlan`'s `clearGamesFor` loop)

**Interfaces:**
- Consumes: `pairFor`, `pairSlotForGame` from `@tournament/core` (existing); `rosterOf` from `@/lib/teams/roster` (existing).
- Produces:
  - `interface RatingSlot { playerId: string; name: string; teamId: string; teamName: string; side: 'a' | 'b' }`
  - `type RatableTeam = Pick<TeamRow, 'id' | 'name'> & { players?: RosterPlayerRow[] }` — deliberately looser than `TeamWithPlayers`, because `GameLine` types its teams as `TeamMaybeRoster`, whose `players` is optional. Both satisfy this.
  - `ratingSlots(teamA: RatableTeam | undefined, teamB: RatableTeam | undefined, gameNo: number): RatingSlot[]`
  - `RATING_FIELD_PREFIX = 'rating:'`
  - `parseRatings(fd: FormData, slots: readonly RatingSlot[]): { ok: true; value: { playerId: string; rating: number }[] } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/results/ratings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { parseRatings, ratingSlots, RATING_FIELD_PREFIX, type RatingSlot } from './ratings';

function team(id: string, name: string): TeamWithPlayers {
  return {
    id, tournament_id: 't', name, tagline: '', colour: '#2563eb', description: '', seed: null,
    pool_id: null, pool_order: 0, withdrawn: false, pool_rank_override: null,
    players: [
      { id: `${id}-m1`, tournament_id: 't', name: `${name} One`, gender: 'male', role: 'mixed1' },
      { id: `${id}-m2`, tournament_id: 't', name: `${name} Two`, gender: 'male', role: 'mixed2' },
      { id: `${id}-w`, tournament_id: 't', name: `${name} Ella`, gender: 'female', role: 'woman' },
    ],
  };
}

const A = team('a', 'Alpha');
const B = team('b', 'Bravo');

describe('ratingSlots', () => {
  it('gives the Mixed #1 man and the woman for game 1', () => {
    expect(ratingSlots(A, B, 1).map((s) => s.playerId)).toEqual(['a-m1', 'a-w', 'b-m1', 'b-w']);
  });

  it('gives the Mixed #2 man and the woman for game 2', () => {
    expect(ratingSlots(A, B, 2).map((s) => s.playerId)).toEqual(['a-m2', 'a-w', 'b-m2', 'b-w']);
  });

  it('gives the two men for game 3', () => {
    expect(ratingSlots(A, B, 3).map((s) => s.playerId)).toEqual(['a-m1', 'a-m2', 'b-m1', 'b-m2']);
  });

  it('marks which side each player is on', () => {
    expect(ratingSlots(A, B, 1).map((s) => s.side)).toEqual(['a', 'a', 'b', 'b']);
  });

  it('leaves out a team whose roster is incomplete', () => {
    const broken = { ...A, players: A.players.slice(0, 2) };
    expect(ratingSlots(broken, B, 1).map((s) => s.playerId)).toEqual(['b-m1', 'b-w']);
  });

  it('returns nothing when neither team is known', () => {
    expect(ratingSlots(undefined, undefined, 1)).toEqual([]);
  });
});

const SLOTS: RatingSlot[] = ratingSlots(A, B, 1);
const form = (values: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(`${RATING_FIELD_PREFIX}${k}`, v);
  return fd;
};

describe('parseRatings', () => {
  it('reads one rating per slot', () => {
    const r = parseRatings(form({ 'a-m1': '7.4', 'a-w': '6', 'b-m1': '5.5', 'b-w': '5' }), SLOTS);
    expect(r).toEqual({ ok: true, value: [
      { playerId: 'a-m1', rating: 7.4 }, { playerId: 'a-w', rating: 6 },
      { playerId: 'b-m1', rating: 5.5 }, { playerId: 'b-w', rating: 5 },
    ] });
  });

  it('treats a blank box as no rating for that player', () => {
    const r = parseRatings(form({ 'a-m1': '7.4', 'a-w': '  ', 'b-m1': '', 'b-w': '5' }), SLOTS);
    expect(r.ok && r.value.map((v) => v.playerId)).toEqual(['a-m1', 'b-w']);
  });

  it('accepts a form with no rating boxes at all', () => {
    expect(parseRatings(new FormData(), SLOTS)).toEqual({ ok: true, value: [] });
  });

  it('rejects a rating below the scale', () => {
    expect(parseRatings(form({ 'a-m1': '0' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating must be between 1 and 10' });
  });

  it('rejects a rating above the scale', () => {
    expect(parseRatings(form({ 'a-m1': '10.5' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating must be between 1 and 10' });
  });

  it('rejects more than one decimal place', () => {
    expect(parseRatings(form({ 'a-m1': '7.25' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating takes at most one decimal place' });
  });

  it('rejects something that is not a number', () => {
    expect(parseRatings(form({ 'a-m1': 'good' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating must be a number' });
  });

  it('ignores a field for a player who is not on court', () => {
    const fd = form({ 'a-m1': '7' });
    fd.set(`${RATING_FIELD_PREFIX}a-m2`, '10'); // plays game 3, not game 1
    const r = parseRatings(fd, SLOTS);
    expect(r.ok && r.value).toEqual([{ playerId: 'a-m1', rating: 7 }]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -w @tournament/web -- ratings`
Expected: FAIL — `Failed to resolve import "./ratings"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/results/ratings.ts`:

```ts
import { pairFor, pairSlotForGame } from '@tournament/core';
import type { RosterPlayerRow, TeamRow } from '@/lib/db/types';
import { rosterOf } from '@/lib/teams/roster';

/** One box on the score form: the player it belongs to and the side they are playing for. */
export interface RatingSlot {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  side: 'a' | 'b';
}

/**
 * Looser than `TeamWithPlayers` on purpose: the schedule screens type their teams as
 * `TeamMaybeRoster`, whose roster is only present on the pages that loaded it. A team without one
 * simply yields no boxes.
 */
export type RatableTeam = Pick<TeamRow, 'id' | 'name'> & { players?: RosterPlayerRow[] };

/** Rating inputs are named `rating:<playerId>`, so the four boxes need no index of their own. */
export const RATING_FIELD_PREFIX = 'rating:';

function slotsForSide(team: RatableTeam | undefined, gameNo: number, side: 'a' | 'b'): RatingSlot[] {
  if (!team?.players) return [];
  // A team with an incomplete roster yields no pair, so it simply contributes no boxes: the
  // organiser can still score the game, and the other side is still rated.
  const pair = pairFor(rosterOf({ players: team.players }), pairSlotForGame(gameNo));
  if (!pair) return [];
  return pair.map((p) => ({ playerId: p.id, name: p.name, teamId: team.id, teamName: team.name, side }));
}

/**
 * The four players on court for one game, side A first. Nobody enters a line-up: a team is two men
 * and one woman with fixed roles, so the game number decides the pair.
 */
export function ratingSlots(
  teamA: RatableTeam | undefined,
  teamB: RatableTeam | undefined,
  gameNo: number,
): RatingSlot[] {
  return [...slotsForSide(teamA, gameNo, 'a'), ...slotsForSide(teamB, gameNo, 'b')];
}

/**
 * Reads the rating boxes out of a submitted score form.
 *
 * Only the slots passed in are read, so a field naming someone who is not on court is ignored
 * rather than trusted. A blank box is how the organiser skips a player, and is not an error.
 */
export function parseRatings(
  fd: FormData,
  slots: readonly RatingSlot[],
): { ok: true; value: { playerId: string; rating: number }[] } | { ok: false; reason: string } {
  const value: { playerId: string; rating: number }[] = [];
  for (const slot of slots) {
    const raw = String(fd.get(`${RATING_FIELD_PREFIX}${slot.playerId}`) ?? '').trim();
    if (raw === '') continue;
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, reason: `${slot.name}: a rating must be a number` };
    if (!/^\d+(\.\d)?$/.test(raw)) return { ok: false, reason: `${slot.name}: a rating takes at most one decimal place` };
    const rating = Number(raw);
    if (rating < 1 || rating > 10) return { ok: false, reason: `${slot.name}: a rating must be between 1 and 10` };
    value.push({ playerId: slot.playerId, rating });
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -w @tournament/web -- ratings`
Expected: PASS, all cases.

- [ ] **Step 5: Write the ratings alongside the score**

In `apps/web/src/actions/games.ts`, add `listTeamsWithPlayers` to the existing
`@/lib/db/queries` import (keep it as one import statement) and add one new import:

```ts
import { listGames, listMatches, listTeamsWithPlayers } from '@/lib/db/queries';
import { parseRatings, ratingSlots } from '@/lib/results/ratings';
```

In `saveGameScore`, immediately after the `validateGame` check that returns `invalid_score`, add:

```ts
  // Ratings are parsed before the score is written, so a bad rating fails the whole save and the
  // organiser never ends up with a score whose ratings were silently dropped.
  const teams = await listTeamsWithPlayers(ctx.sb, ctx.tournament.id);
  const slots = ratingSlots(teams.find((t) => t.id === row.team_a_id), teams.find((t) => t.id === row.team_b_id), gameNo);
  const rated = parseRatings(formData, slots);
  if (!rated.ok) return fail('invalid_input', rated.reason);
```

Then, immediately after the `games` update that writes the score succeeds (after the
`stale_state` guard on `upd`), add:

```ts
  // Replaced wholesale rather than upserted: a box the organiser cleared has to leave the table,
  // and this game's ratings are only ever written here.
  const dropped = await ctx.sb.from('player_ratings').delete().eq('match_id', matchId).eq('game_no', gameNo);
  if (dropped.error) return fail('invalid_input', dropped.error.message);
  if (rated.value.length > 0) {
    const added = await ctx.sb.from('player_ratings')
      .insert(rated.value.map((r) => ({ match_id: matchId, game_no: gameNo, player_id: r.playerId, rating: r.rating })));
    if (added.error) return fail('invalid_input', added.error.message);
  }
```

- [ ] **Step 6: Take the ratings away when the score goes**

In `clearGameScore` in the same file, inside the `for (const id of rb.resetMatchIds)` loop, after
the `games` blanking and before the `score_submissions` delete, add:

```ts
      // The games rows are blanked rather than deleted, so the foreign key's cascade never fires
      // and a reset match would otherwise keep ratings for scores that no longer exist.
      const unrate = await ctx.sb.from('player_ratings').delete().eq('match_id', id);
      if (unrate.error) return fail('invalid_input', unrate.error.message);
```

and after the final `cleared` update near the end of the function (the one that blanks this game's
own row) and its `stale_state` guard, add:

```ts
  const unrated = await ctx.sb.from('player_ratings').delete().eq('match_id', matchId).eq('game_no', gameNo);
  if (unrated.error) return fail('invalid_input', unrated.error.message);
```

In `apps/web/src/lib/results/persist.ts`, inside `for (const id of plan.clearGamesFor)`, after the
`blank` update and its error check, add:

```ts
    // Same reason as in clearGameScore: blanking leaves the games rows in place, so the ratings
    // hanging off them have to be removed by hand.
    const unrate = await sb.from('player_ratings').delete().eq('match_id', id);
    if (unrate.error) return fail('invalid_input', unrate.error.message);
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npm test -w @tournament/web && npm run typecheck -w @tournament/web`
Expected: all green. With local Supabase running, `applyResultPlan.integration.test.ts` and
`perGame.integration.test.ts` still pass — they submit forms without rating fields, which
`parseRatings` accepts as "no ratings".

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/results/ratings.ts apps/web/src/lib/results/ratings.test.ts apps/web/src/actions/games.ts apps/web/src/lib/results/persist.ts
git commit -m "feat(web): save a game's player ratings with its score, and clear them with it"
```

---

### Task 4: The rating boxes on the score form

**Files:**
- Modify: `apps/web/src/components/GameScoreForm.tsx`
- Modify: `apps/web/src/components/GameLine.tsx:190` (the `<GameScoreForm />` call)

**Interfaces:**
- Consumes: `suggestRating` (Task 1); `ratingSlots`, `RATING_FIELD_PREFIX`, `RatingSlot` (Task 3).
- Produces: `GameScoreForm` takes one new optional prop, `slots?: readonly RatingSlot[]`.

- [ ] **Step 1: Add the boxes to the form**

In `apps/web/src/components/GameScoreForm.tsx`:

Extend the imports:

```ts
import { suggestRating, validateGame, type Settings } from '@tournament/core';
import { RATING_FIELD_PREFIX, type RatingSlot } from '@/lib/results/ratings';
```

Add a token beside `scoreBox` at the top of the file:

```ts
/** Narrower than a score box and quieter: a rating is a judgement beside the fact, not the fact. */
const ratingBox = 'w-14 border-hair border-line bg-white px-2 py-1 text-center font-display text-base font-bold tabular-nums text-ink outline-none focus:border-navy';
```

Add the prop to the destructured signature and its doc comment:

```ts
  /** The four players on court, if both rosters are complete; no slots means no rating row. */
  slots?: readonly RatingSlot[];
```

Add the state, directly after the `expired` state:

```ts
  // A box the organiser has typed in keeps their number; every other box follows the score as it
  // is edited, so correcting a typo does not leave four stale suggestions behind.
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, true>>({});
```

After the `hint` line, add the suggestion helpers:

```ts
  const suggestionFor = (slot: RatingSlot): string => {
    if (!ready) return '';
    const own = slot.side === 'a' ? Number(a) : Number(b);
    const opp = slot.side === 'a' ? Number(b) : Number(a);
    return String(suggestRating(settings, own, opp));
  };
  const ratingValue = (slot: RatingSlot): string => (touched[slot.playerId] ? ratings[slot.playerId] ?? '' : suggestionFor(slot));
```

Then, between the `{clocked && (...)}` label block and the Save button, render the row:

```tsx
      {ready && slots && slots.length > 0 && (
        <div data-testid="rating-row" className="flex w-full flex-wrap items-center gap-3 border-t-hair border-line-soft pt-2">
          <span className="text-xs font-bold uppercase tracking-label text-muted">Out of 10</span>
          {slots.map((slot) => (
            <label key={slot.playerId} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-label text-muted-strong">
              <span className="max-w-[9rem] truncate">{slot.name}</span>
              <input
                name={`${RATING_FIELD_PREFIX}${slot.playerId}`}
                data-testid="rating-input"
                data-player={slot.playerId}
                inputMode="decimal"
                aria-label={`${label} · ${slot.name} rating out of 10`}
                value={ratingValue(slot)}
                onChange={(e) => {
                  setTouched((t) => ({ ...t, [slot.playerId]: true }));
                  setRatings((r) => ({ ...r, [slot.playerId]: e.target.value }));
                }}
                className={ratingBox}
              />
            </label>
          ))}
        </div>
      )}
```

The form is already `flex flex-wrap`, so `w-full` on this div puts the ratings on their own line
under the scores.

- [ ] **Step 2: Hand the form its slots**

`GameLine` already receives `teams: readonly TeamMaybeRoster[]` and the core `match`, so both rows
are reachable by `match.teamAId` / `match.teamBId`. The admin Matches page loads them through
`listTeamsWithPlayers`, so the rosters are present there; the public pages pass `admin={false}` and
never render this form.

Add the import:

```ts
import { ratingSlots } from '@/lib/results/ratings';
```

and pass the prop on the existing `<GameScoreForm ... />` call at `GameLine.tsx:190`:

```tsx
              slots={ratingSlots(teams.find((t) => t.id === match.teamAId), teams.find((t) => t.id === match.teamBId), slot.game_no)}
```

- [ ] **Step 3: Check it by hand**

Run: `npm run dev -w @tournament/web`, sign in, open a tournament in play, and expand an unscored
game on `/admin/<slug>/matches`.

Expected: no rating row until both scores are valid. Type `15` and `9` — four boxes appear showing
`7.1`, `7.1`, `3.9`, `3.9` against the four names. Change the `9` to `3` and the untouched boxes
become `8.7` / `2.3`. Type over one box and it keeps your number while the other three still follow
the score. Save, then press Change: the score comes back for editing.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -w @tournament/web && npm run typecheck -w @tournament/web`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/GameScoreForm.tsx apps/web/src/components/GameLine.tsx
git commit -m "feat(web): rate the four players on court from the game score form"
```

---

### Task 5: The public Players leaderboard

**Files:**
- Create: `apps/web/src/components/RatingLeaderboard.tsx`
- Create: `apps/web/src/app/t/[slug]/players/page.tsx`
- Modify: `apps/web/src/app/t/[slug]/layout.tsx` (one tab)

**Interfaces:**
- Consumes: `playerRatings`, `teamRatings`, `PlayerRatingRow`, `TeamRatingRow`, `RatedPlayer` (Task 1); `loadTournamentBundle` with `ratings` (Task 2).
- Produces: `RatingLeaderboard({ players, teams }: { players: readonly PlayerRatingRow[]; teams: readonly TeamRatingRow[] })`.

- [ ] **Step 1: Write the leaderboard component**

Create `apps/web/src/components/RatingLeaderboard.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { PlayerRatingRow, TeamRatingRow } from '@tournament/core';
import { ui } from './ui';

const th = 'pb-3 pt-1 text-xs font-bold uppercase tracking-label text-muted';
const num = 'px-1 text-center tabular-nums text-muted-strong';
/** An average is the point of the table, so it is set in the display face like a score. */
const score = 'px-1 text-right font-display text-lg font-black tabular-nums';

/** A rating always reads with its decimal, so 7 shows as 7.0 rather than sitting a digit short. */
const show = (n: number | null) => (n === null ? '—' : n.toFixed(1));

function Tab({ active, onClick, label, testId }: { active: boolean; onClick: () => void; label: string; testId: string }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-pressed={active}
      className={`px-6 py-3 text-sm font-bold uppercase tracking-label ${active ? 'bg-navy text-white' : 'border-hair border-navy text-navy hover:bg-line-soft'}`}
    >{label}</button>
  );
}

/**
 * Every player of the tournament by their average mark out of 10, with a team view that averages
 * each team's players. The two views are one component because they are one question asked two
 * ways, and the filter has to feel instant — a link per view would reload the page.
 */
export function RatingLeaderboard({ players, teams }: { players: readonly PlayerRatingRow[]; teams: readonly TeamRatingRow[] }) {
  const [view, setView] = useState<'players' | 'teams'>('players');
  const nobodyRated = players.every((p) => p.average === null);

  return (
    <section className={ui.card}>
      <div className={ui.head}>
        <h2 className={ui.eyebrow}>Form</h2>
        <div className="flex" data-testid="rating-filter">
          <Tab active={view === 'players'} onClick={() => setView('players')} label="Players" testId="rating-filter-players" />
          <Tab active={view === 'teams'} onClick={() => setView('teams')} label="Teams" testId="rating-filter-teams" />
        </div>
      </div>
      <div className={ui.body}>
        {nobodyRated && (
          <p className="mb-5 text-sm text-muted">
            Nobody has been rated yet. The organiser marks each player out of 10 as they score each game.
          </p>
        )}
        {view === 'players' ? (
          <table className="w-full text-base" data-testid="player-leaderboard">
            <thead>
              <tr className="border-b-hair border-line text-left">
                <th className={`${th} w-7`}>#</th>
                <th className={th}>Player</th>
                <th className={th}>Team</th>
                <th className={`${th} w-12 text-center`}>Gms</th>
                <th className={`${th} w-16 text-right`}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.playerId} data-testid="rating-row" data-player={p.playerId} className="border-b-hair border-line-soft">
                  <td className="py-4 font-display text-lg font-extrabold">{p.rank ?? '—'}</td>
                  <td className="py-4 font-bold">{p.name}</td>
                  <td className="py-4 text-sm text-muted">{p.teamName}</td>
                  <td className={num}>{p.gamesRated}</td>
                  <td className={score} data-testid="rating-average">{show(p.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-base" data-testid="team-leaderboard">
            <thead>
              <tr className="border-b-hair border-line text-left">
                <th className={`${th} w-7`}>#</th>
                <th className={th}>Team</th>
                <th className={`${th} w-16 text-center`}>Rated</th>
                <th className={`${th} w-16 text-right`}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.teamId} data-testid="rating-row" data-team={t.teamId} className="border-b-hair border-line-soft">
                  <td className="py-4 font-display text-lg font-extrabold">{t.rank ?? '—'}</td>
                  <td className="py-4 font-bold">{t.name}</td>
                  <td className={num}>{t.playersRated}</td>
                  <td className={score} data-testid="rating-average">{show(t.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-muted">
          An average of every mark out of 10 the organiser has given that player. A team scores the average of its players.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write the page**

Create `apps/web/src/app/t/[slug]/players/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { playerRatings, teamRatings, type RatedPlayer } from '@tournament/core';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle } from '@/lib/db/queries';
import { RatingLeaderboard } from '@/components/RatingLeaderboard';
import { ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PlayersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  // A player only reaches the leaderboard through a team, which is also where their team name
  // comes from: the players table has no team of its own.
  const people: RatedPlayer[] = bundle.teams.flatMap((t) =>
    t.players.map((p) => ({ id: p.id, name: p.name, teamId: t.id, teamName: t.name })),
  );
  if (people.length === 0) return <p className={ui.empty}>No teams have signed up yet.</p>;
  const rows = playerRatings(people, bundle.ratings.map((r) => ({ playerId: r.player_id, rating: r.rating })));
  return <RatingLeaderboard players={rows} teams={teamRatings(rows)} />;
}
```

- [ ] **Step 3: Add the tab**

In `apps/web/src/app/t/[slug]/layout.tsx`, change the `tabs` line to include Players after Bracket:

```ts
  const tabs: Array<readonly [string, string]> = [['', 'Live'], ['/pools', 'Pools'], ['/bracket', 'Bracket'], ['/players', 'Players'], ['/announcements', 'Announcements']];
```

- [ ] **Step 4: Check it by hand**

Run: `npm run dev -w @tournament/web`, open `/t/<slug>/players` on a tournament where you have
scored at least one game with ratings.

Expected: the Players tab is marked active; the individual table lists everyone, the rated ones
first with their average to one decimal and their games count, the unrated below showing a dash for
both rank and average. Clicking Teams swaps to the team table without a page load. A tournament
with no teams shows the dashed empty panel instead.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm test -w @tournament/web && npm run typecheck -w @tournament/web`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/RatingLeaderboard.tsx "apps/web/src/app/t/[slug]/players/page.tsx" "apps/web/src/app/t/[slug]/layout.tsx"
git commit -m "feat(web): publish the player and team form tables on a Players tab"
```

---

### Task 6: End-to-end proof

**Files:**
- Create: `apps/web/e2e/ratings.spec.ts`

**Interfaces:**
- Consumes: `signIn`, `addTeams`, `drawAndLock`, `meetingCard`, `openFirstGame`, `fillScores`, `playersOf` from `apps/web/e2e/helpers.ts`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/ratings.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { addTeams, drawAndLock, fillScores, meetingCard, openFirstGame, playersOf, signIn } from './helpers';

const slug = `rate-${Date.now().toString(36)}`;
const teams = ['Alpha & Ana', 'Bravo & Bea'];

test('ratings: suggested from the score, edited by the organiser, averaged on the Players tab', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);

  await page.fill('input[name="name"]', 'Rating Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await addTeams(page, slug, teams);
  await drawAndLock(page, slug, 1);

  // Game 1 is Mixed #1 + the woman on both sides, so those four boxes appear and no others.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const card = meetingCard(page, teams[0]!, teams[1]!);
  const form = await openFirstGame(card);
  const boxes = form.getByTestId('rating-input');
  await expect(boxes).toHaveCount(0); // nothing to rate until the game has a score

  await fillScores(form, 15, 9);
  await expect(boxes).toHaveCount(4);
  // 6/15 = 0.4, so 5.5 + 1.6 on the winning side and 5.5 - 1.6 on the losing one.
  await expect(boxes.nth(0)).toHaveValue('7.1');
  await expect(boxes.nth(2)).toHaveValue('3.9');

  // Editing the score re-suggests, and a box typed in by hand keeps its number.
  await fillScores(form, 15, 3);
  await expect(boxes.nth(0)).toHaveValue('8.7');
  await boxes.nth(1).fill('6.4');
  await fillScores(form, 15, 9);
  await expect(boxes.nth(0)).toHaveValue('7.1');
  await expect(boxes.nth(1)).toHaveValue('6.4');

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // The public tab averages them. The Mixed #1 man of Alpha played that one game at 7.1.
  const alpha = playersOf(teams[0]!);
  await page.goto(`/t/${slug}/players`);
  const table = page.getByTestId('player-leaderboard');
  await expect(table).toBeVisible();
  const topRow = table.getByTestId('rating-row').first();
  await expect(topRow).toContainText(alpha.mixed1);
  await expect(topRow.getByTestId('rating-average')).toHaveText('7.1');
  // Alpha's Mixed #2 man does not play game 1, so he is unrated and sorts to the bottom.
  const lastRow = table.getByTestId('rating-row').last();
  await expect(lastRow.getByTestId('rating-average')).toHaveText('—');

  // Alpha averages its two rated players: 7.1 and the 6.4 typed by hand, so 6.8 (6.75 rounds up).
  await page.getByTestId('rating-filter-teams').click();
  const teamTable = page.getByTestId('team-leaderboard');
  await expect(teamTable).toBeVisible();
  const topTeam = teamTable.getByTestId('rating-row').first();
  await expect(topTeam).toContainText(teams[0]!);
  await expect(topTeam.getByTestId('rating-average')).toHaveText('6.8');

  // Clearing the score takes its ratings with it: nobody is rated again.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const scored = page.locator('[data-testid="game-row"][data-scored="true"]').first();
  const toggle = scored.getByTestId('game-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await scored.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('[data-testid="game-row"][data-scored="true"]')).toHaveCount(0);

  await page.goto(`/t/${slug}/players`);
  await expect(page.getByTestId('player-leaderboard').getByTestId('rating-average').first()).toHaveText('—');
});
```

- [ ] **Step 2: Run it**

Run: `npm run e2e -w @tournament/web -- ratings.spec.ts`
Expected: one test passes. It needs local Supabase up and the seeded admin from
`npm run seed:admin -w @tournament/web`.

- [ ] **Step 3: Run the whole suite once**

Run: `npm test && npm run typecheck && npm run e2e -w @tournament/web`
Expected: every unit, integration and end-to-end test passes. The three existing specs are
unaffected: they score games without touching the rating boxes, which is the "left blank" path.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/ratings.spec.ts
git commit -m "test(web): prove ratings suggest, persist and average end to end"
```
