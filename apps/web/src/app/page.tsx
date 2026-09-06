import Link from 'next/link';
import { BADMINTON_DEFAULTS } from '@tournament/core';

export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Tournament</h1>
      <p className="text-slate-600">
        Default rules: best of {BADMINTON_DEFAULTS.gamesPerMatch} games to {BADMINTON_DEFAULTS.pointsPerGame}.
      </p>
      <Link className="underline" href="/admin">Admin</Link>
    </main>
  );
}
