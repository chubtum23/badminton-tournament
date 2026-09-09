import Link from 'next/link';
import { BADMINTON_DEFAULTS } from '@tournament/core';
import { PlainShell } from '@/components/Shell';
import { ui } from '@/components/ui';

export default function Home() {
  const { gamesPerMatch, pointsPerGame, timeCapMinutes } = BADMINTON_DEFAULTS;
  return (
    <PlainShell title="Club tournament" status="Run a night · Follow it live">
      <div className={`${ui.card} max-w-xl`}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <span className={ui.eyebrow}>Default rules</span>
        </div>
        <div className={ui.body}>
          <p className="font-display text-2xl font-black uppercase leading-tight">
            {gamesPerMatch === 1 ? 'One game' : `Best of ${gamesPerMatch}`} to {pointsPerGame}
          </p>
          {timeCapMinutes !== null && (
            <p className={ui.help}>{timeCapMinutes} minutes on the clock.</p>
          )}
          <p className="mt-5">
            <Link href="/admin" className={`${ui.primary} inline-block`}>Organiser sign in</Link>
          </p>
        </div>
      </div>
    </PlainShell>
  );
}
