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
 *
 * The caller must pass only this pool's teams and matches: this function does not filter
 * by pool, so a knockout meeting between two teams that are tied in the pool table would
 * otherwise be picked up as their head-to-head result. Two tied teams that never played
 * each other fall through to name order.
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
