import { describe, it, expect } from 'vitest';
import { hubTiles, statusLine, type HubInput } from './hub';

const base: HubInput = {
  status: 'setup', startsAt: '2026-09-12T08:30:00.000Z', venue: 'Main Hall',
  rules: '3 games to 15 · 13 min clock · 4 courts · top 2 per pool',
  teamCount: 6, completeCount: 6, signupOpen: true, poolCount: 0, meetingCount: 0, liveCount: 0, championName: null,
};

describe('hubTiles', () => {
  it('lists the four tiles in order with their states during setup', () => {
    const tiles = hubTiles(base);
    expect(tiles.map((t) => t.title)).toEqual(['1. Event details', '2. Rules', '3. Teams', '4. Pools and draw']);
    expect(tiles.map((t) => t.pill)).toEqual(['Done', 'Done', 'Done', 'To do']);
    expect(tiles[2]!.summary).toBe('6 signed up · 6 complete · sign-ups open');
    expect(tiles[3]!.summary).toBe('Not drawn');
  });
  it('event is To do until date and venue are both set', () => {
    expect(hubTiles({ ...base, venue: null })[0]!.pill).toBe('To do');
    expect(hubTiles({ ...base, venue: null })[0]!.summary).toBe('Not set');
  });
  it('teams is Done from two complete teams, and To do below that or with an incomplete roster', () => {
    // lockPools needs two teams in a pool, so a three-team club night has to be able to lock.
    expect(hubTiles({ ...base, teamCount: 3, completeCount: 3 })[2]!.pill).toBe('Done');
    expect(hubTiles({ ...base, teamCount: 2, completeCount: 2 })[2]!.pill).toBe('Done');
    expect(hubTiles({ ...base, teamCount: 1, completeCount: 1 })[2]!.pill).toBe('To do');
    expect(hubTiles({ ...base, teamCount: 0, completeCount: 0 })[2]!.pill).toBe('To do');
    expect(hubTiles({ ...base, completeCount: 5 })[2]!.pill).toBe('To do');
  });
  it('rules and draw show Locked / Done once the pools are locked', () => {
    const tiles = hubTiles({ ...base, status: 'pools', signupOpen: false, poolCount: 2, meetingCount: 12 });
    expect(tiles[1]!.pill).toBe('Locked');
    expect(tiles[3]!.pill).toBe('Done');
    expect(tiles[3]!.summary).toBe('2 pools, 12 meetings');
  });
  it('draw says the knockout has started', () => {
    expect(hubTiles({ ...base, status: 'knockout', poolCount: 2, meetingCount: 15 })[3]!.summary).toBe('Knockout started');
  });
});

describe('statusLine', () => {
  it('describes each stage', () => {
    expect(statusLine(base)).toBe('Setup · 6 teams signed up');
    expect(statusLine({ ...base, status: 'pools', liveCount: 3 })).toBe('Pool stage · 3 games on court');
    expect(statusLine({ ...base, status: 'knockout', liveCount: 0 })).toBe('Knockout · no game on court');
    expect(statusLine({ ...base, status: 'finished', championName: 'Smashers' })).toBe('Finished · Champion: Smashers');
  });
});
