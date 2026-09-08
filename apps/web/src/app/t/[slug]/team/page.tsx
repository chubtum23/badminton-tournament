import { cookies, headers } from 'next/headers';
import { currentParticipant, cookieName } from '@/lib/participant/token';
import { updateMyTeam, updateMyRoster, swapMixed, submitScoresForm } from '@/actions/participant';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, listGames, listMatches, listPools, listSubmissions, listTeamsWithPlayers, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { MatchCard, pendingFor, teamName } from '@/components/MatchCard';
import { SubmitScoresForm } from '@/components/SubmitScoresForm';
import { FlashMessage } from '@/components/FlashMessage';
import { RecentOutcome } from '@/components/RecentOutcome';
import { SubmitButton } from '@/components/SubmitButton';
import { CopyButton } from '@/components/CopyButton';
import { RosterFields } from '@/components/RosterFields';
import { ui } from '@/components/ui';
import { siteOrigin } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { slug } = await params;
  const { welcome } = await searchParams;
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
    listTeamsWithPlayers(sb, me.tournament.id), listPools(sb, me.tournament.id), listMatches(sb, me.tournament.id),
    listGames(sb, me.tournament.id), listSubmissions(sb, me.tournament.id),
  ]);
  const games = gamesByMatch(gameRows);
  // Each meeting is three labelled games, so the cards list them rather than one score column.
  const slots = gameSlotsByMatch(gameRows);
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
  const canSubmit = (m: typeof mine[number]) =>
    !me.team.withdrawn && (m.status === 'ready' || m.status === 'live' || m.status === 'submitted' || m.status === 'disputed');

  // The private link is rebuilt from this request's own cookie, so it is only ever rendered for
  // the team that already holds the token.
  const token = (await cookies()).get(cookieName(slug))?.value ?? '';
  const privateLink = `${siteOrigin(await headers())}/t/${slug}/team/${token}`;
  const myTeam = teams.find((x) => x.id === me.team.id);
  const byRole = (r: 'mixed1' | 'mixed2' | 'woman') => myTeam?.players.find((p) => p.role === r)?.name ?? '';
  const rosterLocked = me.tournament.status !== 'setup';

  async function save(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyTeam(slug, formData), 'Team updated');
  }
  async function saveRoster(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyRoster(slug, formData), 'Players saved');
  }
  async function swap() {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await swapMixed(slug), 'Mixed pairs swapped');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      <RecentOutcome />
      {me.team.withdrawn && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">Your team has been withdrawn by the organiser</p>
      )}
      {welcome === '1' && (
        <div data-testid="welcome" className="rounded-xl border border-emerald-400 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold">You&apos;re in. Save this private link, it is the only way back to your team page:</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{privateLink}</code>
            <CopyButton text={privateLink} className={ui.secondary} />
          </div>
        </div>
      )}
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-4 flex items-center gap-2`}><span className="inline-block h-4 w-4 rounded-full" style={{ background: me.team.colour }} />{me.team.name}</h2>
        <form action={save} className="grid gap-4 md:grid-cols-2">
          <label className={ui.label}>Team name<input name="name" defaultValue={me.team.name} maxLength={40} required className={ui.field} /></label>
          <label className={ui.label}>Tagline<input name="tagline" defaultValue={me.team.tagline} maxLength={80} className={ui.field} /></label>
          <label className={ui.label}>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="mt-1 h-12 w-full rounded-lg border" /></label>
          <label className={`${ui.label} md:col-span-2`}>About your team<textarea name="description" defaultValue={me.team.description} maxLength={400} rows={2} className={ui.field} /></label>
          <div className="md:col-span-2"><SubmitButton className={ui.primary}>Save team</SubmitButton></div>
        </form>
      </section>
      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-1`}>Players</h2>
        {rosterLocked ? (
          <>
            <p className={ui.help}>The draw is locked, so players can&apos;t change. Ask the organiser if someone is injured.</p>
            <ul className="mt-3 space-y-1 text-base">
              <li><span className="text-slate-500">Mixed #1:</span> {byRole('mixed1')} &amp; {byRole('woman')}</li>
              <li><span className="text-slate-500">Mixed #2:</span> {byRole('mixed2')} &amp; {byRole('woman')}</li>
              <li><span className="text-slate-500">Men&apos;s doubles:</span> {byRole('mixed1')} &amp; {byRole('mixed2')}</li>
            </ul>
          </>
        ) : (
          <>
            <form action={saveRoster} className="space-y-4">
              <RosterFields defaults={{ mixed1: byRole('mixed1'), mixed2: byRole('mixed2'), woman: byRole('woman') }} />
              <SubmitButton className={ui.primary}>Save players</SubmitButton>
            </form>
            <form action={swap} className="mt-3">
              <SubmitButton className={ui.secondary}>Swap which man plays Mixed #1</SubmitButton>
            </form>
          </>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your next match</h2>
        {next ? (
          <>
            <MatchCard match={next} teams={teams} games={games[next.id] ?? []} label={label(next)} pending={pending(next)} tournament={me.tournament} slots={slots[next.id]} />
            {canSubmit(next) && (
              <>
                <SubmitScoresForm matchId={next.id} settings={settingsOf(next)} existing={(latest[next.id]?.[mySide] ?? { games: [] }).games} teamA={teamName(teams, next.teamAId)} teamB={teamName(teams, next.teamBId)} action={submitScoresForm.bind(null, slug)} submitLabel="Submit scores" />
                <p className="text-xs text-slate-500">Your scores show as unconfirmed until the other team submits the same result or an organiser confirms them.</p>
              </>
            )}
          </>
        ) : <p className="text-sm text-slate-500">No upcoming match right now.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your matches</h2>
        <div className="grid gap-2 md:grid-cols-2">{mine.map((m) => (
          <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} pending={pending(m)} tournament={me.tournament} slots={slots[m.id]}>
            {canSubmit(m) && (
              <SubmitScoresForm matchId={m.id} settings={settingsOf(m)} existing={(latest[m.id]?.[sideOf(m)] ?? { games: [] }).games}
                teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)} action={submitScoresForm.bind(null, slug)} submitLabel="Submit scores" />
            )}
          </MatchCard>
        ))}</div>
      </section>
    </div>
  );
}
