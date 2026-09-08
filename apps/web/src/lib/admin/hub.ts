import type { TournamentStatus } from '@/lib/db/types';

export interface HubInput {
  status: TournamentStatus;
  startsAt: string | null;
  venue: string | null;
  /** Pre-rendered rules summary, e.g. "3 games to 15 · 13 min clock · 4 courts · top 2 per pool". */
  rules: string;
  teamCount: number;
  completeCount: number;
  signupOpen: boolean;
  poolCount: number;
  meetingCount: number;
  liveCount: number;
  championName: string | null;
}

export type Pill = 'Done' | 'To do' | 'Locked';
export interface HubTile { key: 'event' | 'rules' | 'teams' | 'draw'; title: string; summary: string; pill: Pill; href: string }

/** The four checklist tiles of the organiser's home page. `href` is relative to /admin/[slug]. */
export function hubTiles(i: HubInput): HubTile[] {
  const locked = i.status !== 'setup';
  const eventDone = i.startsAt !== null && i.venue !== null && i.venue !== '';
  const teamsDone = i.teamCount >= 4 && i.completeCount === i.teamCount;
  return [
    { key: 'event', title: '1. Event details', href: '/event', summary: eventDone ? 'date and venue set' : 'Not set', pill: eventDone ? 'Done' : 'To do' },
    { key: 'rules', title: '2. Rules', href: '/rules', summary: i.rules, pill: locked ? 'Locked' : 'Done' },
    { key: 'teams', title: '3. Teams', href: '/teams', summary: `${i.teamCount} signed up · ${i.completeCount} complete · sign-ups ${i.signupOpen && !locked ? 'open' : 'closed'}`, pill: teamsDone ? 'Done' : 'To do' },
    {
      key: 'draw', title: '4. Pools and draw', href: '/standings',
      summary: i.status === 'setup' ? 'Not drawn' : i.status === 'pools' ? `${i.poolCount} pools, ${i.meetingCount} meetings` : 'Knockout started',
      pill: locked ? 'Done' : 'To do',
    },
  ];
}

export function statusLine(i: HubInput): string {
  const onCourt = i.liveCount === 0 ? 'no game on court' : `${i.liveCount} game${i.liveCount === 1 ? '' : 's'} on court`;
  switch (i.status) {
    case 'setup': return `Setup · ${i.teamCount} team${i.teamCount === 1 ? '' : 's'} signed up`;
    case 'pools': return `Pool stage · ${onCourt}`;
    case 'knockout': return `Knockout · ${onCourt}`;
    case 'finished': return `Finished · Champion: ${i.championName ?? 'TBD'}`;
  }
}
