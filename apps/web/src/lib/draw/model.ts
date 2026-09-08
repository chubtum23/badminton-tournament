import type { Match, StandingRow } from '@tournament/core';
import type { PoolRow, TeamRow } from '@/lib/db/types';

/** One line of a pool box on the draw tree. */
export interface DrawPoolRow {
  teamId: string;
  name: string;
  colour: string;
  points: number;
  /** Inside the qualifying places, so the box highlights it. */
  qualifies: boolean;
  withdrawn: boolean;
}

export interface DrawPool { id: string; name: string; rows: DrawPoolRow[] }

/** Which half of the mirrored layout a knockout match sits in. The final is the centre. */
export type DrawSide = 'left' | 'right' | 'centre';

export interface DrawModel {
  pools: DrawPool[];
  /** Knockout matches by round, index 0 = first round. Empty until the knockout starts. */
  rounds: Match[][];
  /** Side per match id. Only meaningful when `mirrored`. */
  sides: Record<string, DrawSide>;
  /**
   * The mirrored layout applies: an even number of pools, and every knockout round splits
   * evenly between the two halves. Anything else (3 pools, an odd bracket, a bracket built
   * before this layout existed) falls back to plain left-to-right.
   */
  mirrored: boolean;
}

/**
 * The whole draw as one screen: every pool table on the outside, the knockout in the middle.
 *
 * The side of a first-round match comes from the pool its teams qualified out of — the first
 * half of the pools feed the left, the rest feed the right — and every later round inherits
 * the side of the matches feeding it, so a match whose two feeders disagree is the final.
 */
export function drawModel(input: {
  pools: readonly PoolRow[];
  teams: readonly TeamRow[];
  matches: readonly Match[];
  /** Finishing order per pool id, best first, as computePool returns it. */
  standings: Readonly<Record<string, readonly StandingRow[]>>;
  advancePerPool: number;
}): DrawModel {
  const teamById = new Map(input.teams.map((t) => [t.id, t]));
  const pools: DrawPool[] = input.pools.map((p) => ({
    id: p.id,
    name: p.name,
    rows: (input.standings[p.id] ?? []).map((r, i) => {
      const t = teamById.get(r.teamId);
      return {
        teamId: r.teamId,
        name: r.name,
        colour: t?.colour ?? '#94a3b8',
        points: r.points,
        qualifies: i < input.advancePerPool,
        withdrawn: t?.withdrawn ?? false,
      };
    }),
  }));

  const ko = input.matches.filter((m) => m.stage === 'knockout');
  const totalRounds = ko.length === 0 ? 0 : Math.max(...ko.map((m) => m.round ?? 1));
  const rounds = Array.from({ length: totalRounds }, (_, i) =>
    ko.filter((m) => m.round === i + 1).sort((x, y) => x.slot - y.slot));

  const half = Math.ceil(input.pools.length / 2);
  const leftPoolIds = new Set(input.pools.slice(0, half).map((p) => p.id));
  const sideOfTeam = (id: string | null): DrawSide | null => {
    const poolId = id ? teamById.get(id)?.pool_id ?? null : null;
    return poolId === null ? null : leftPoolIds.has(poolId) ? 'left' : 'right';
  };

  const sides: Record<string, DrawSide> = {};
  for (const m of rounds[0] ?? []) {
    const s = sideOfTeam(m.teamAId) ?? sideOfTeam(m.teamBId);
    if (s) sides[m.id] = s;
  }
  for (let r = 1; r < rounds.length; r++) {
    for (const m of rounds[r]!) {
      const feeders = rounds[r - 1]!.filter((c) => c.nextMatchId === m.id).map((c) => sides[c.id]);
      const known = feeders.filter((s): s is DrawSide => s !== undefined);
      sides[m.id] = known.length > 0 && known.every((s) => s === known[0]) ? known[0]! : 'centre';
    }
  }

  // Every match placed, the halves balanced in each round, and exactly one match in the middle.
  const placed = ko.every((m) => sides[m.id] !== undefined);
  const balanced = rounds.every((list, i) => {
    if (i === rounds.length - 1) return true; // the final round holds the centre
    const l = list.filter((m) => sides[m.id] === 'left').length;
    return l * 2 === list.length;
  });
  const centres = ko.filter((m) => sides[m.id] === 'centre').length;
  const mirrored = input.pools.length >= 2 && input.pools.length % 2 === 0
    && (ko.length === 0 || (placed && balanced && centres === 1));

  return { pools, rounds, sides, mirrored };
}

/** The knockout rounds of one half, ordered outermost first for the left, innermost first for the right. */
export function halfRounds(model: DrawModel, side: 'left' | 'right'): Match[][] {
  const out = model.rounds
    .map((list) => list.filter((m) => model.sides[m.id] === side))
    .filter((list) => list.length > 0);
  return side === 'left' ? out : out.reverse();
}

/** The single match in the middle of a mirrored draw, if the knockout has reached it. */
export function centreMatch(model: DrawModel): Match | null {
  for (const list of model.rounds) {
    const m = list.find((x) => model.sides[x.id] === 'centre');
    if (m) return m;
  }
  return null;
}

/** "Quarter-finals", "Semi-finals", "Final", or "Round n" further back. */
export function roundTitle(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round ${round}`;
}
