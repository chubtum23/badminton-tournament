import { redirect } from 'next/navigation';
import { currentParticipant } from '@/lib/participant/token';
import { updateMyTeam } from '@/actions/participant';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { createServerSupabase } from '@/lib/supabase/server';
import { listMatches, listPools, listTeams } from '@/lib/db/queries';
import { rowToMatch } from '@/lib/db/mappers';
import { MatchCard } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const me = await currentParticipant(slug);
  if (!me) {
    return (
      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">My team</h2>
        <p>Open the private link your organiser gave you to unlock this page. It is unique to your team; do not share it.</p>
      </div>
    );
  }
  const sb = await createServerSupabase();
  const [teams, pools, matchRows] = await Promise.all([listTeams(sb, me.tournament.id), listPools(sb, me.tournament.id), listMatches(sb, me.tournament.id)]);
  const mine = matchRows.map(rowToMatch).filter((m) => m.teamAId === me.team.id || m.teamBId === me.team.id);
  const next = mine.find((m) => m.status === 'live') ?? mine.find((m) => m.status === 'ready' || m.status === 'submitted' || m.status === 'disputed');
  const label = (m: typeof mine[number]) => m.stage === 'pool' ? pools.find((p) => p.id === m.poolId)?.name ?? 'Pool' : `Round ${m.round}`;

  async function save(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyTeam(slug, formData), 'Team updated');
  }

  return (
    <div className="space-y-4">
      {msg && <p className="rounded bg-slate-100 p-2 text-sm">{msg}</p>}
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><span className="inline-block h-3 w-3 rounded-full" style={{ background: me.team.colour }} />{me.team.name}</h2>
        <form action={save} className="grid gap-3 text-sm md:grid-cols-3">
          <label>Team name<input name="name" defaultValue={me.team.name} maxLength={40} required className="mt-1 w-full rounded border p-2" /></label>
          <label>Tagline<input name="tagline" defaultValue={me.team.tagline} maxLength={80} className="mt-1 w-full rounded border p-2" /></label>
          <label>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="mt-1 h-10 w-full rounded border" /></label>
          <div className="md:col-span-3"><button className="rounded bg-slate-900 px-4 py-2 text-white">Save team</button></div>
        </form>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your next match</h2>
        {next ? <MatchCard match={next} teams={teams} games={[]} label={label(next)} /> : <p className="text-sm text-slate-500">No upcoming match right now.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your matches</h2>
        <div className="grid gap-2 md:grid-cols-2">{mine.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} />)}</div>
      </section>
    </div>
  );
}
