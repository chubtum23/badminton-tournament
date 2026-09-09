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
import { poolTone, ui } from '@/components/ui';
import { siteOrigin } from '@/lib/siteUrl';
import { validateRoster } from '@tournament/core';
import { rosterOf } from '@/lib/teams/roster';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { slug } = await params;
  const { welcome } = await searchParams;
  const me = await currentParticipant(slug);
  if (!me) {
    return (
      <section className={`${ui.card} max-w-prose`}>
        <div className={ui.head}><h2 className={ui.eyebrow}>My team</h2></div>
        <p className={`${ui.body} text-sm`}>Open the private link your organiser gave you to unlock this page. It is unique to your team; do not share it.</p>
      </section>
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
  // Pool colour, matching the Pools and Live pages. A knockout meeting has no pool.
  const tone = (m: typeof mine[number]) => {
    const i = pools.findIndex((p) => p.id === m.poolId);
    return i >= 0 ? poolTone(i).head : undefined;
  };
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
  // A team entered before roles existed has no mixed1/mixed2/woman, so the three pair lines would
  // read "Mixed #1:  &". Say so plainly instead; only the organiser can repair it once locked.
  const rosterComplete = myTeam !== undefined && validateRoster(rosterOf(myTeam)).ok;

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
        <p className={ui.alarm}>Your team has been withdrawn by the organiser.</p>
      )}
      {welcome === '1' && (
        <div data-testid="welcome" className={`${ui.card} border-orange`}>
          <div className={`${ui.head} ${ui.headOrange} border-orange`}><span className={ui.eyebrow}>You&apos;re in</span></div>
          <div className={ui.body}>
            <p className="text-sm font-semibold">Save this private link — it is the only way back to your team page.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <code className={ui.code}>{privateLink}</code>
              <CopyButton text={privateLink} className={ui.primary} label="Copy link" />
            </div>
          </div>
        </div>
      )}

      <section className={ui.card}>
        <div className={ui.head}>
          <h2 className="flex items-center gap-2.5 font-display text-base font-extrabold uppercase tracking-tight">
            <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: me.team.colour }} />{me.team.name}
          </h2>
          <span className={`${ui.eyebrow} text-muted`}>Your team</span>
        </div>
        <form action={save} className={`${ui.body} grid gap-4 md:grid-cols-2`}>
          <label className={ui.label}>Team name<input name="name" defaultValue={me.team.name} maxLength={40} required className={ui.field} /></label>
          <label className={ui.label}>Tagline<input name="tagline" defaultValue={me.team.tagline} maxLength={80} className={ui.field} /></label>
          <label className={ui.label}>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="mt-1.5 h-12 w-full cursor-pointer border-hair border-line bg-white p-1" /></label>
          <label className={`${ui.label} md:col-span-2`}>About your team<textarea name="description" defaultValue={me.team.description} maxLength={400} rows={2} className={`${ui.field} resize-y font-normal normal-case tracking-normal`} /></label>
          <div className="md:col-span-2"><SubmitButton className={ui.primary}>Save team</SubmitButton></div>
        </form>
      </section>

      <section className={ui.card}>
        <div className={ui.head}>
          <h2 className={ui.eyebrow}>Players</h2>
          {rosterLocked && <span className={ui.pillLocked}>Locked</span>}
        </div>
        <div className={ui.body}>
          {rosterLocked ? (
            <>
              <p className="text-[15px] text-muted">The draw is locked, so players can&apos;t change. Ask the organiser if someone is injured.</p>
              {rosterComplete ? (
                <ul className="mt-4 divide-y divide-line-soft">
                  {([['Mixed #1', `${byRole('mixed1')} & ${byRole('woman')}`],
                     ['Mixed #2', `${byRole('mixed2')} & ${byRole('woman')}`],
                     ["Men's doubles", `${byRole('mixed1')} & ${byRole('mixed2')}`]] as const).map(([role, pair]) => (
                    <li key={role} className="flex flex-wrap justify-between gap-3 py-2.5">
                      <span className={`${ui.eyebrow} text-muted`}>{role}</span>
                      <span className="text-sm font-bold">{pair}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm">Your team was entered before players were split into mixed and men&apos;s doubles pairs. Ask the organiser to re-enter your three players.</p>
              )}
            </>
          ) : (
            <>
              <form action={saveRoster} className="space-y-4">
                <RosterFields defaults={{ mixed1: byRole('mixed1'), mixed2: byRole('mixed2'), woman: byRole('woman') }} />
                <SubmitButton className={ui.primary}>Save players</SubmitButton>
              </form>
              <form action={swap} className="mt-4">
                <SubmitButton className={ui.secondary}>Swap which man plays Mixed #1</SubmitButton>
              </form>
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className={ui.h2}>Your next match</h2>
        {next ? (
          <>
            <MatchCard match={next} teams={teams} games={games[next.id] ?? []} label={label(next)} tone={tone(next)} pending={pending(next)} tournament={me.tournament} slots={slots[next.id]} />
            {canSubmit(next) && (
              <div className={`${ui.card} ${ui.body} space-y-3`}>
                <SubmitScoresForm matchId={next.id} settings={settingsOf(next)} existing={(latest[next.id]?.[mySide] ?? { games: [] }).games} teamA={teamName(teams, next.teamAId)} teamB={teamName(teams, next.teamBId)} action={submitScoresForm.bind(null, slug)} submitLabel="Submit scores" />
                <p className="text-xs text-muted">Your scores show as unconfirmed until the other team submits the same result or an organiser confirms them.</p>
              </div>
            )}
          </>
        ) : <p className={ui.empty}>No upcoming match right now.</p>}
      </section>

      <section className="space-y-4">
        <h2 className={ui.h2}>Your matches <span className="text-muted-soft">({mine.length})</span></h2>
        <div className="grid gap-6 md:grid-cols-2">{mine.map((m) => (
          <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} tone={tone(m)} pending={pending(m)} tournament={me.tournament} slots={slots[m.id]}>
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
