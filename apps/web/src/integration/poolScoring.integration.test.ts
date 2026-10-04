import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { listGames, listMatches, loadTournamentBundle } from '@/lib/db/queries';
import { computePool } from '@/lib/standings/compute';
import type { GameRow, MatchRow, TournamentRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

// The real server actions run here. Only the request plumbing is stood in for: the cookie-bound
// client becomes a client signed in as the organiser, and page revalidation is a no-op.
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => session.client }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { addTeam } = await import('@/actions/teams');
const { generatePools, lockPools } = await import('@/actions/pools');
const { restartMatch, saveGameScore, startGame } = await import('@/actions/games');

type Planned = { matchId: string; gameNo: number; scoreA: number; scoreB: number; timeExpired: boolean };

const scoreForm = (p: Pick<Planned, 'scoreA' | 'scoreB' | 'timeExpired'>): FormData => {
  const fd = new FormData();
  fd.set('scoreA', String(p.scoreA));
  fd.set('scoreB', String(p.scoreB));
  if (p.timeExpired) fd.set('timeExpired', 'on');
  return fd;
};

/**
 * A whole pool stage played through the organiser's own actions: scores typed in one game at a
 * time, many courts finishing at once, and the pool tables read back the way the public Pools page
 * reads them. A table point is one game won, not one meeting won.
 */
describe.skipIf(!enabled)('scoring a pool stage through the organiser actions', () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let tournament: TournamentRow;
  let matches: MatchRow[];
  let plan: Planned[];
  const slug = `pool-scoring-${Date.now().toString(36)}`;

  const slots = async (): Promise<GameRow[]> => listGames(service, tournament.id);
  const slotOf = (all: GameRow[], matchId: string, gameNo: number) => all.find((g) => g.match_id === matchId && g.game_no === gameNo)!;

  /** The pool tables exactly as /t/[slug]/pools computes them, keyed by pool id then team id. */
  const publicTables = async () => {
    const bundle = await loadTournamentBundle(anon, slug);
    if (!bundle) throw new Error('tournament not visible to the public');
    const ms = bundle.matches.map(rowToMatch);
    const games = gamesByMatch(bundle.games);
    return new Map(bundle.pools.map((p) => [
      p.id,
      computePool({ pool: p, teams: bundle.teams, matches: ms, games, advancePerPool: bundle.tournament.advance_per_pool }).rows,
    ]));
  };

  /** Tallied straight from the score plan, independent of the app: one point per game won. */
  const expectedTables = (scored: readonly Planned[]) => {
    const tables = new Map<string, Map<string, { points: number; gamesWon: number; gamesLost: number; pointsFor: number; pointsAgainst: number; played: number; won: number; lost: number }>>();
    const blank = () => ({ points: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, played: 0, won: 0, lost: 0 });
    for (const m of matches) {
      const t = tables.get(m.pool_id!) ?? tables.set(m.pool_id!, new Map()).get(m.pool_id!)!;
      for (const id of [m.team_a_id!, m.team_b_id!]) if (!t.has(id)) t.set(id, blank());
    }
    for (const m of matches) {
      const t = tables.get(m.pool_id!)!;
      const a = t.get(m.team_a_id!)!;
      const b = t.get(m.team_b_id!)!;
      const games = scored.filter((p) => p.matchId === m.id);
      for (const g of games) {
        a.pointsFor += g.scoreA; a.pointsAgainst += g.scoreB;
        b.pointsFor += g.scoreB; b.pointsAgainst += g.scoreA;
        if (g.scoreA > g.scoreB) { a.points++; a.gamesWon++; b.gamesLost++; } else { b.points++; b.gamesWon++; a.gamesLost++; }
      }
      if (games.length === 3) {
        const aGames = games.filter((g) => g.scoreA > g.scoreB).length;
        a.played++; b.played++;
        if (aGames >= 2) { a.won++; b.lost++; } else { b.won++; a.lost++; }
      }
    }
    return tables;
  };

  const expectTablesToMatch = async (scored: readonly Planned[]) => {
    const actual = await publicTables();
    const expected = expectedTables(scored);
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [poolId, rows] of actual) {
      const want = expected.get(poolId)!;
      // Every team in the table belongs to this pool, and no team is missing from it.
      expect(rows.map((r) => r.teamId).sort()).toEqual([...want.keys()].sort());
      for (const r of rows) {
        expect({ team: r.name, ...pick(r) }).toEqual({ team: r.name, ...want.get(r.teamId)! });
      }
      // Ordered by table points, highest first.
      const pts = rows.map((r) => r.points);
      expect(pts).toEqual([...pts].sort((x, y) => y - x));
    }
  };
  const pick = (r: { points: number; gamesWon: number; gamesLost: number; pointsFor: number; pointsAgainst: number; played: number; won: number; lost: number }) =>
    ({ points: r.points, gamesWon: r.gamesWon, gamesLost: r.gamesLost, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst, played: r.played, won: r.won, lost: r.lost });

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
    session.client = admin;

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'pool scoring test' });
    if (t.error) throw t.error;

    // Six teams of three, drawn into two pools of three, then locked: three meetings per pool,
    // three games per meeting.
    for (let i = 1; i <= 6; i++) {
      const fd = new FormData();
      fd.set('name', `Team ${i}`);
      fd.set('mixed1', `Man ${i}a`);
      fd.set('mixed2', `Man ${i}b`);
      fd.set('woman', `Woman ${i}`);
      const added = await addTeam(slug, fd);
      expect(added).toMatchObject({ ok: true });
    }
    expect(await generatePools(slug, 2)).toEqual({ ok: true, value: undefined });
    expect(await lockPools(slug)).toEqual({ ok: true, value: undefined });

    const loaded = await service.from('tournaments').select('*').eq('id', t.data as string).single();
    if (loaded.error) throw loaded.error;
    tournament = loaded.data as TournamentRow;
    expect(tournament.status).toBe('pools');

    matches = (await listMatches(service, tournament.id)).filter((m) => m.stage === 'pool').sort((x, y) => (x.pool_id! + x.slot).localeCompare(y.pool_id! + y.slot));
    expect(matches).toHaveLength(6);
    expect((await slots()).filter((g) => matches.some((m) => m.id === g.match_id))).toHaveLength(18);

    // A spread of results so a team's table points and its meetings won disagree: sweeps, 2-1s,
    // a dead third game, and one game stopped by the clock short of 15.
    const patterns = ['aaa', 'abb', 'bab', 'aab', 'bbb', 'aba'];
    plan = matches.flatMap((m, i) => [...patterns[i]!].map((w, g) => {
      const timeExpired = i === 2 && g === 2;
      const loser = 3 + i + g;
      const [scoreA, scoreB] = timeExpired ? (w === 'a' ? [12, 10] : [10, 12]) : (w === 'a' ? [15, loser] : [loser, 15]);
      return { matchId: m.id, gameNo: g + 1, scoreA, scoreB, timeExpired };
    }));
  });

  it('a typed score lands on its own game, takes it off court, and gives the winner one point', async () => {
    const first = plan[0]!;
    expect(await startGame(slug, first.matchId, first.gameNo, null)).toEqual({ ok: true, value: undefined });
    const onCourt = slotOf(await slots(), first.matchId, first.gameNo);
    expect(onCourt.court).toBe(1);
    expect(onCourt.started_at).not.toBeNull();

    const before = await slots();
    expect(await saveGameScore(slug, first.matchId, first.gameNo, scoreForm(first))).toEqual({ ok: true, value: undefined });

    const after = await slots();
    expect(slotOf(after, first.matchId, first.gameNo)).toMatchObject({ score_a: first.scoreA, score_b: first.scoreB, court: null, started_at: null });
    // Nothing else in the tournament moved.
    for (const g of after) {
      if (g.match_id === first.matchId && g.game_no === first.gameNo) continue;
      expect(g).toEqual(before.find((b) => b.match_id === g.match_id && b.game_no === g.game_no));
    }
    // One game of three is not a finished meeting, but it is already a point on the table.
    expect((await listMatches(service, tournament.id)).find((m) => m.id === first.matchId)!.status).not.toBe('done');
    await expectTablesToMatch([first]);
  });

  it('two people saving the same game at once leave exactly one score, counted once', async () => {
    const target = plan[1]!;
    const [x, y] = await Promise.all([
      saveGameScore(slug, target.matchId, target.gameNo, scoreForm({ scoreA: 15, scoreB: 1, timeExpired: false })),
      saveGameScore(slug, target.matchId, target.gameNo, scoreForm({ scoreA: 2, scoreB: 15, timeExpired: false })),
    ]);
    expect(x).toMatchObject({ ok: true });
    expect(y).toMatchObject({ ok: true });
    const g = slotOf(await slots(), target.matchId, target.gameNo);
    expect([[15, 1], [2, 15]]).toContainEqual([g.score_a, g.score_b]);
    await expectTablesToMatch([plan[0]!, { ...target, scoreA: g.score_a!, scoreB: g.score_b! }]);

    // Typing the right score over it corrects the table rather than adding to it.
    expect(await saveGameScore(slug, target.matchId, target.gameNo, scoreForm(target))).toEqual({ ok: true, value: undefined });
    await expectTablesToMatch(plan.slice(0, 2));
  });

  it('several games started at once each get their own court', async () => {
    const waiting = plan.slice(2).filter((p, i, all) => all.findIndex((q) => q.matchId === p.matchId) === i);
    const batch = waiting.slice(0, Math.min(tournament.court_count, waiting.length));
    const results = await Promise.all(batch.map((p) => startGame(slug, p.matchId, p.gameNo, null)));
    expect(results).toEqual(batch.map(() => ({ ok: true, value: undefined })));
    const now = await slots();
    const taken = batch.map((p) => slotOf(now, p.matchId, p.gameNo).court);
    expect(taken.every((c) => c !== null)).toBe(true);
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('every remaining game saved at the same moment lands in the right pool with the right points', async () => {
    const rest = plan.slice(2);
    const results = await Promise.all(rest.map((p) => saveGameScore(slug, p.matchId, p.gameNo, scoreForm(p))));
    const failures = results.map((r, i) => ({ r, p: rest[i]! })).filter(({ r }) => !r.ok);
    expect(failures).toEqual([]);

    // Every game holds exactly the score typed for it, and nothing is left on a court.
    const all = await slots();
    for (const p of plan) {
      expect(slotOf(all, p.matchId, p.gameNo)).toMatchObject({
        score_a: p.scoreA, score_b: p.scoreB, time_expired: p.timeExpired, court: null, started_at: null,
      });
    }

    // Every meeting is finished, won by whoever took two of the three games.
    const rows = await listMatches(service, tournament.id);
    for (const m of matches) {
      const row = rows.find((r) => r.id === m.id)!;
      const aGames = plan.filter((p) => p.matchId === m.id && p.scoreA > p.scoreB).length;
      expect(row.status).toBe('done');
      expect(row.winner_id).toBe(aGames >= 2 ? m.team_a_id : m.team_b_id);
    }

    await expectTablesToMatch(plan);

    // Each pool's three meetings are worth nine points between them, one per game.
    const tables = await publicTables();
    for (const rows of tables.values()) {
      expect(rows.reduce((n, r) => n + r.points, 0)).toBe(9);
      expect(rows.reduce((n, r) => n + r.won, 0)).toBe(3);
    }
  });

  /** "Change" on a scored game: the organiser types a new score over a finished meeting's game. */
  const change = async (index: number, scoreA: number, scoreB: number) => {
    const p = plan[index]!;
    expect(await saveGameScore(slug, p.matchId, p.gameNo, scoreForm({ scoreA, scoreB, timeExpired: false }))).toEqual({ ok: true, value: undefined });
    plan[index] = { ...p, scoreA, scoreB, timeExpired: false };
  };
  const winnerOf = async (m: MatchRow) => (await listMatches(service, tournament.id)).find((r) => r.id === m.id)!;

  it('changing a finished game that does not flip the meeting moves the point and keeps the winner', async () => {
    // Meeting 0 was a 3-0 sweep for side A; its dead third game now goes to B.
    const m = matches[0]!;
    await change(2, 9, 15);
    expect(await winnerOf(m)).toMatchObject({ status: 'done', winner_id: m.team_a_id });
    await expectTablesToMatch(plan);
  });

  it('changing a finished game that flips the meeting hands it, and the points, to the other side', async () => {
    // Meeting 3 was A 2-1 (games a, a, b); game 2 now goes to B, so B wins 2-1.
    const m = matches[3]!;
    expect(await winnerOf(m)).toMatchObject({ winner_id: m.team_a_id });
    await change(3 * 3 + 1, 11, 15);
    expect(await winnerOf(m)).toMatchObject({ status: 'done', winner_id: m.team_b_id });
    await expectTablesToMatch(plan);

    // And back again.
    await change(3 * 3 + 1, 15, 11);
    expect(await winnerOf(m)).toMatchObject({ status: 'done', winner_id: m.team_a_id });
    await expectTablesToMatch(plan);
  });

  it('a mistyped change is refused and leaves the saved score alone', async () => {
    const p = plan[4]!;
    const res = await saveGameScore(slug, p.matchId, p.gameNo, scoreForm({ scoreA: 15, scoreB: 15, timeExpired: false }));
    expect(res).toMatchObject({ ok: false });
    expect(slotOf(await slots(), p.matchId, p.gameNo)).toMatchObject({ score_a: p.scoreA, score_b: p.scoreB });
    await expectTablesToMatch(plan);
  });

  it('restarting a finished match wipes its games and takes its points off the table, then it can be replayed', async () => {
    const m = matches[5]!;
    const others = await slots();
    expect(await restartMatch(slug, m.id)).toEqual({ ok: true, value: undefined });

    const after = await slots();
    for (const g of after.filter((x) => x.match_id === m.id)) {
      expect(g).toMatchObject({ score_a: null, score_b: null, court: null, started_at: null });
    }
    // Only that match was touched.
    for (const g of after.filter((x) => x.match_id !== m.id)) {
      expect(g).toEqual(others.find((b) => b.match_id === g.match_id && b.game_no === g.game_no));
    }
    expect(await winnerOf(m)).toMatchObject({ winner_id: null });
    expect((await winnerOf(m)).status).not.toBe('done');
    await expectTablesToMatch(plan.filter((p) => p.matchId !== m.id));

    // Played again with the result reversed: B wins all three this time.
    for (const [i, p] of plan.entries()) {
      if (p.matchId !== m.id) continue;
      await change(i, 7, 15);
    }
    expect(await winnerOf(m)).toMatchObject({ status: 'done', winner_id: m.team_b_id });
    await expectTablesToMatch(plan);
  });
});

/**
 * Tonight's worst case for the result lock: every court's clock runs out together, so each court's
 * deciding game is saved at the same moment, over a slow hall connection, while the next games are
 * being called on. Every one has to land without "Someone else is saving".
 */
describe.skipIf(!enabled)('four courts deciding their meetings at once over a slow connection', () => {
  const slug = `slow-courts-${Date.now().toString(36)}`;
  const LATENCY_MS = 80;

  it('saves every deciding game and every start, and the table adds up', async () => {
    const service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const email = `admin-${slug}@example.com`;
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    // Every request the organiser's actions make is held back, as on patchy venue wifi.
    const slowFetch: typeof fetch = async (...args) => { await new Promise((r) => setTimeout(r, LATENCY_MS)); return fetch(...args); };
    const admin = createClient(url!, anonKey!, { auth: { persistSession: false }, global: { fetch: slowFetch } });
    const signed = await admin.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    session.client = admin;

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'slow courts test' });
    if (t.error) throw t.error;
    for (let i = 1; i <= 8; i++) {
      const fd = new FormData();
      fd.set('name', `Side ${i}`); fd.set('mixed1', `M ${i}a`); fd.set('mixed2', `M ${i}b`); fd.set('woman', `W ${i}`);
      expect(await addTeam(slug, fd)).toMatchObject({ ok: true });
    }
    expect(await generatePools(slug, 2)).toEqual({ ok: true, value: undefined });
    expect(await lockPools(slug)).toEqual({ ok: true, value: undefined });
    const tournamentId = t.data as string;
    const matches = (await listMatches(service, tournamentId)).filter((m) => m.stage === 'pool');
    expect(matches).toHaveLength(12);

    // Four meetings, one per court, with games 1 and 2 already in (split 1-1, so game 3 decides).
    const deciding = matches.slice(0, 4);
    for (const m of deciding) {
      expect(await saveGameScore(slug, m.id, 1, scoreForm({ scoreA: 15, scoreB: 8, timeExpired: false }))).toMatchObject({ ok: true });
      expect(await saveGameScore(slug, m.id, 2, scoreForm({ scoreA: 9, scoreB: 15, timeExpired: false }))).toMatchObject({ ok: true });
    }

    // The clock runs out on all four courts: four deciding saves, and the next four games called.
    const next = matches.slice(4, 8);
    const results = await Promise.all([
      ...deciding.map((m, i) => saveGameScore(slug, m.id, 3, scoreForm(i % 2 ? { scoreA: 12, scoreB: 10, timeExpired: true } : { scoreA: 13, scoreB: 15, timeExpired: false }))),
      ...next.map((m) => startGame(slug, m.id, 1, null)),
    ]);
    expect(results.filter((r) => !r.ok)).toEqual([]);

    const rows = await listMatches(service, tournamentId);
    for (const [i, m] of deciding.entries()) {
      const row = rows.find((r) => r.id === m.id)!;
      expect(row.status).toBe('done');
      expect(row.winner_id).toBe(i % 2 ? m.team_a_id : m.team_b_id);
    }
    // Twelve games scored across the two pools: twelve table points, one per game.
    const bundle = (await loadTournamentBundle(service, slug))!;
    const ms = bundle.matches.map(rowToMatch);
    const games = gamesByMatch(bundle.games);
    const total = bundle.pools
      .flatMap((p) => computePool({ pool: p, teams: bundle.teams, matches: ms, games, advancePerPool: 2 }).rows)
      .reduce((n, r) => n + r.points, 0);
    expect(total).toBe(12);
  }, 120_000);
});
