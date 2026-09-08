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
