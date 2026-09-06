import { currentParticipant } from '@/lib/participant/token';
import { updateMyTeam, submitScores } from '@/actions/participant';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { createServerSupabase } from '@/lib/supabase/server';
import { listGames, listMatches, listPools, listSubmissions, listTeams, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFromTournament } from '@/lib/db/mappers';
import { MatchCard, teamName } from '@/components/MatchCard';
import { ScoreForm } from '@/components/ScoreForm';

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
  const [teams, pools, matchRows, gameRows, subs] = await Promise.all([
    listTeams(sb, me.tournament.id), listPools(sb, me.tournament.id), listMatches(sb, me.tournament.id),
    listGames(sb, me.tournament.id), listSubmissions(sb, me.tournament.id),
  ]);
  const games = gamesByMatch(gameRows);
  const latest = latestByMatch(subs);
  const mine = matchRows.map(rowToMatch).filter((m) => m.teamAId === me.team.id || m.teamBId === me.team.id);
  const next = mine.find((m) => m.status === 'live') ?? mine.find((m) => m.status === 'ready' || m.status === 'submitted' || m.status === 'disputed');
  const label = (m: typeof mine[number]) => m.stage === 'pool' ? pools.find((p) => p.id === m.poolId)?.name ?? 'Pool' : `Round ${m.round}`;
  const settings = settingsFromTournament(me.tournament);
  const mySide = next && next.teamAId === me.team.id ? 'a' : 'b';
  const pendingFor = (m: typeof mine[number]) => {
    const l = latest[m.id]; const s = l?.a ?? l?.b; if (!s) return undefined;
    const by = s.submitted_by === 'team_a' ? teamName(teams, m.teamAId) : teamName(teams, m.teamBId);
    return { games: s.games, by };
  };

  async function save(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyTeam(slug, formData), 'Team updated');
  }

  async function submit(formData: FormData) {
    'use server';
    const r = await submitScores(slug, String(formData.get('matchId')), formData);
    redirectWithMsg(`/t/${slug}/team`, r, r.ok ? (r.data.outcome === 'confirmed' ? 'Result confirmed' : r.data.outcome === 'disputed' ? 'Scores differ from the other team; an organiser will resolve it' : 'Scores submitted, waiting for the other team') : '');
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
        {next ? (
          <>
            <MatchCard match={next} teams={teams} games={games[next.id] ?? []} label={label(next)} pending={pendingFor(next)} />
            {(next.status === 'ready' || next.status === 'live' || next.status === 'submitted' || next.status === 'disputed') && (
              <>
                <ScoreForm matchId={next.id} settings={settings} existing={(latest[next.id]?.[mySide] ?? { games: [] }).games} teamA={teamName(teams, next.teamAId)} teamB={teamName(teams, next.teamBId)} action={submit} submitLabel="Submit scores" />
                <p className="text-xs text-slate-500">Your scores show as unconfirmed until the other team submits the same result or an organiser confirms them.</p>
              </>
            )}
          </>
        ) : <p className="text-sm text-slate-500">No upcoming match right now.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your matches</h2>
        <div className="grid gap-2 md:grid-cols-2">{mine.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} pending={pendingFor(m)} />)}</div>
      </section>
    </div>
  );
}
