import type { Game, Match, TeamRef } from './types';

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  /** Team points: one per game won, so a meeting is worth up to gamesPerMatch. */
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
 * Standings for one pool. A point is won per game, not per meeting: a meeting of three games is
 * worth three points, split the way the games were. So a game counts as soon as it is scored,
 * rather than waiting for the meeting it belongs to — the table moves through the night as the
 * courts finish — while played/won/lost still count whole meetings, and only finished ones.
 *
 * Order: points desc. Teams level on points are split only by a playoff match between exactly
 * the two tied teams; otherwise they stay level, in name order, with `tieUnresolved` set. Neither
 * head-to-head nor score difference ranks anyone (club rule).
 * Playoff matches are not counted in played/points/score. Pass only this pool's teams and matches.
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
  }
  // Games counted off every ordinary meeting of the pool, finished or still being played.
  for (const m of matches) {
    if (m.stage === 'playoff' || m.teamAId === null || m.teamBId === null) continue;
    const a = rows.get(m.teamAId);
    const b = rows.get(m.teamBId);
    if (!a || !b) continue;
    for (const g of gamesByMatch[m.id] ?? []) {
      a.pointsFor += g.scoreA; a.pointsAgainst += g.scoreB;
      b.pointsFor += g.scoreB; b.pointsAgainst += g.scoreA;
      if (g.scoreA > g.scoreB) { a.gamesWon++; b.gamesLost++; } else { b.gamesWon++; a.gamesLost++; }
    }
  }
  for (const r of rows.values()) { r.points = r.gamesWon; r.pointDiff = r.pointsFor - r.pointsAgainst; }

  if (options.manualOrder) {
    const pos = new Map(options.manualOrder.map((id, i) => [id, i]));
    const computed = orderComputed([...rows.values()], playoffs);
    return computed.sort((x, y) => (pos.get(x.teamId) ?? Number.MAX_SAFE_INTEGER) - (pos.get(y.teamId) ?? Number.MAX_SAFE_INTEGER)).map((r) => ({ ...r, tieUnresolved: false }));
  }
  return orderComputed([...rows.values()], playoffs);
}

function meetingWinner(list: readonly Match[], x: string, y: string): string | null {
  const m = list.find((m) => (m.teamAId === x && m.teamBId === y) || (m.teamAId === y && m.teamBId === x));
  return m ? m.winnerId : null;
}

/** Sort by points, then resolve each equal-points group with the tie chain. */
function orderComputed(rows: StandingRow[], playoffs: readonly Match[]): StandingRow[] {
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
    }
    // Club rule: teams level on points are split by a men's doubles playoff and nothing else —
    // not head-to-head, not score difference. Until one is played (or the organiser sets the
    // order) the group stays level, listed by name and flagged.
    for (const r of group) r.tieUnresolved = true;
    out.push(...[...group].sort((a, b) => a.name.localeCompare(b.name)));
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
    while (j + 1 < rows.length && rows[j + 1]!.tieUnresolved && rows[j + 1]!.points === rows[i]!.points) j++;
    const first = i + 1, last = j + 1; // 1-based positions
    if (first <= advancePerPool && last > advancePerPool) out.push({ teamIds: rows.slice(i, j + 1).map((r) => r.teamId), affects: 'qualification' });
    else if (first === 1 && last >= 2) out.push({ teamIds: rows.slice(i, j + 1).map((r) => r.teamId), affects: 'seeding' });
    i = j + 1;
  }
  return out;
}
