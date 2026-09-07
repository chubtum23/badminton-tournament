import { currentParticipant } from '@/lib/participant/token';
import { updateMyTeam, submitScoresForm } from '@/actions/participant';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { createServerSupabase } from '@/lib/supabase/server';
import { listGames, listMatches, listPools, listSubmissions, listTeams, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { MatchCard, pendingFor, teamName } from '@/components/MatchCard';
import { ScoreForm } from '@/components/ScoreForm';
import { FlashMessage } from '@/components/FlashMessage';
import { RecentOutcome } from '@/components/RecentOutcome';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
  const poolName = (m: typeof mine[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof mine[number]) => m.stage === 'pool' ? poolName(m)
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round}`;
  // Rules are per stage, so each match card is rendered against its own settings.
  const settingsOf = (m: typeof mine[number]) => settingsFor(me!.tournament, m.stage);
  const myTeamId = me.team.id;
  const sideOf = (m: typeof mine[number]) => (m.teamAId === myTeamId ? 'a' : 'b');
  const mySide = next ? sideOf(next) : 'a';
  // Prefer the opponent's submission: a player wants to see what the other team claimed, not their
  // own numbers read back to them.
  const pending = (m: typeof mine[number]) => pendingFor(latest, teams, m, sideOf(m) === 'a' ? 'b' : 'a');
  // Match carries no timestamps, so the live clock reads started_at off the raw rows.
  const startedAtById: Record<string, string | null> = Object.fromEntries(matchRows.map((r) => [r.id, r.started_at]));
  const canSubmit = (m: typeof mine[number]) =>
    !me.team.withdrawn && (m.status === 'ready' || m.status === 'live' || m.status === 'submitted' || m.status === 'disputed');

  async function save(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyTeam(slug, formData), 'Team updated');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      <RecentOutcome />
      {me.team.withdrawn && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">Your team has been withdrawn by the organiser</p>
      )}
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><span className="inline-block h-3 w-3 rounded-full" style={{ background: me.team.colour }} />{me.team.name}</h2>
        <form action={save} className="grid gap-3 text-sm md:grid-cols-3">
          <label>Team name<input name="name" defaultValue={me.team.name} maxLength={40} required className="mt-1 w-full rounded border p-2" /></label>
          <label>Tagline<input name="tagline" defaultValue={me.team.tagline} maxLength={80} className="mt-1 w-full rounded border p-2" /></label>
          <label>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="mt-1 h-10 w-full rounded border" /></label>
          <div className="md:col-span-3"><SubmitButton className="rounded bg-slate-900 px-4 py-2 text-white">Save team</SubmitButton></div>
        </form>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your next match</h2>
        {next ? (
          <>
            <MatchCard match={next} teams={teams} games={games[next.id] ?? []} label={label(next)} pending={pending(next)} startedAt={startedAtById[next.id]} capMinutes={settingsOf(next).timeCapMinutes} />
            {canSubmit(next) && (
              <>
                <ScoreForm matchId={next.id} settings={settingsOf(next)} existing={(latest[next.id]?.[mySide] ?? { games: [] }).games} teamA={teamName(teams, next.teamAId)} teamB={teamName(teams, next.teamBId)} action={submitScoresForm.bind(null, slug)} submitLabel="Submit scores" />
                <p className="text-xs text-slate-500">Your scores show as unconfirmed until the other team submits the same result or an organiser confirms them.</p>
              </>
            )}
          </>
        ) : <p className="text-sm text-slate-500">No upcoming match right now.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your matches</h2>
        <div className="grid gap-2 md:grid-cols-2">{mine.map((m) => (
          <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} pending={pending(m)} startedAt={startedAtById[m.id]} capMinutes={settingsOf(m).timeCapMinutes}>
            {canSubmit(m) && (
              <ScoreForm matchId={m.id} settings={settingsOf(m)} existing={(latest[m.id]?.[sideOf(m)] ?? { games: [] }).games}
                teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)} action={submitScoresForm.bind(null, slug)} submitLabel="Submit scores" />
            )}
          </MatchCard>
        ))}</div>
      </section>
    </div>
  );
}
