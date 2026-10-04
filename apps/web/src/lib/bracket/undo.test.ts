import { describe, expect, it } from 'vitest';
import { knockoutHasPlay } from './undo';

const ko = (id: string, status = 'ready', decided_by = 'played') => ({ id, stage: 'knockout' as const, status, decided_by }) as never;
const pool = (id: string) => ({ id, stage: 'pool' as const, status: 'done', decided_by: 'played' }) as never;
const game = (match_id: string, score_a: number | null = null, started_at: string | null = null) => ({ match_id, score_a, started_at });

describe('knockoutHasPlay', () => {
  it('is false for a fresh bracket, whatever the pools hold', () =>
    expect(knockoutHasPlay([pool('p1'), ko('k1'), ko('k2', 'done', 'bye')], [game('p1', 15), game('k1')])).toBe(false));
  it('is true once a knockout game is scored', () => expect(knockoutHasPlay([ko('k1')], [game('k1', 15)])).toBe(true));
  it('is true once a knockout game is on court', () => expect(knockoutHasPlay([ko('k1')], [game('k1', null, '2026-10-04T10:00:00Z')])).toBe(true));
  it('is true for an awarded knockout match', () => expect(knockoutHasPlay([ko('k1', 'done', 'awarded')], [])).toBe(true));
});
