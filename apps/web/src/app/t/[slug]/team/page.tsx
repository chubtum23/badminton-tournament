import { cookies, headers } from 'next/headers';
import { currentParticipant, cookieName } from '@/lib/participant/token';
import { updateMyTeam, updateMyRoster, swapMixed, submitScoresForm } from '@/actions/participant';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, listGames, listMatches, listPools, listSubmissions, listTeamsWithPlayers, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor, stageGameLabel } from '@/lib/db/mappers';
import { roundTitle } from '@/lib/draw/model';
import { MatchCard, pendingFor, teamName } from '@/components/MatchCard';
import { SubmitScoresForm } from '@/components/SubmitScoresForm';
import { FlashMessage } from '@/components/FlashMessage';
import { RecentOutcome } from '@/components/RecentOutcome';
import { SubmitButton } from '@/components/SubmitButton';
import { CopyButton } from '@/components/CopyButton';
import { RosterFields } from '@/components/RosterFields';
import { TeamAvatar } from '@/components/TeamAvatar';
import { LimitedField } from '@/components/LimitedField';
import { PhotoField } from '@/components/PhotoField';
import { PhotoForm } from '@/components/PhotoForm';
import { poolTone, ui } from '@/components/ui';
import { siteOrigin } from '@/lib/siteUrl';
import { validateRoster } from '@tournament/core';
import { rosterOf } from '@/lib/teams/roster';
import { PROFILE_LIMITS } from '@/lib/participant/profile';

export const dynamic = 'force-dynamic';

const LOST_LINK = 'Lost your link? Ask the organiser — they can copy it from their Teams page.';

/** Why the private-link route sent the player here instead of letting them in (`?link=`). */
const LINK_PROBLEM: Record<string, string> = {
  invalid: "That team link isn't valid. It may have been cut short when it was copied, or the team may have been removed.",
  limited: 'Too many team links have been tried from this network in the last minute. Wait a minute, then open your link again.',
};

export default async function MyTeamPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string; link?: string }> }) {
  const { slug } = await params;
  const { welcome, link } = await searchParams;
  const linkProblem = link ? LINK_PROBLEM[link] : undefined;
  const linkNotice = linkProblem && (
    <p data-testid="link-problem" role="alert" className={`${ui.alarm} max-w-prose`}>{linkProblem}</p>
  );
  const me = await currentParticipant(slug);
  if (!me) {
    return (
      <div className="space-y-4">
        {linkNotice}
        <section className={`${ui.card} max-w-prose`}>
          <div className={ui.head}><h2 className={ui.eyebrow}>My team</h2></div>
          <div className={`${ui.body} space-y-3 text-sm`}>
            <p>Open your team&apos;s private link to unlock this page. You got it when you signed your team up, or from the organiser if they entered your team for you. It is unique to your team, so share it only with your own players.</p>
            <p className="font-semibold">{LOST_LINK}</p>
          </div>
        </section>
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
  const all = matchRows.map(rowToMatch);
  const mine = all.filter((m) => m.teamAId === me.team.id || m.teamBId === me.team.id);
  const next = mine.find((m) => m.status === 'live') ?? mine.find((m) => m.status === 'ready' || m.status === 'submitted' || m.status === 'disputed');
  const poolName = (m: typeof mine[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  // Named like the Bracket page ("Semi-finals", "Final"), which needs the depth of the whole draw.
  const totalRounds = Math.max(0, ...all.filter((m) => m.stage === 'knockout').map((m) => m.round ?? 1));
  const label = (m: typeof mine[number]) => m.stage === 'pool' ? poolName(m)
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : roundTitle(m.round ?? 1, totalRounds);
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
  // the team that already holds the token, and only on this page.
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

  const scoreForm = (m: typeof mine[number]) => (
    <SubmitScoresForm matchId={m.id} settings={settingsOf(m)} existing={(latest[m.id]?.[sideOf(m)] ?? { games: [] }).games}
      teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)} action={submitScoresForm.bind(null, slug)} submitLabel="Submit scores"
      gameLabels={Array.from({ length: settingsOf(m).gamesPerMatch }, (_, i) => stageGameLabel(me!.tournament, m.stage, i + 1))} />
  );

  return (
    <div className="space-y-4">
      <FlashMessage />
      <RecentOutcome />
      {linkNotice}
      {me.team.withdrawn && (
        <p className={ui.alarm}>Your team has been withdrawn by the organiser.</p>
      )}
      {welcome === '1' && (
        <div data-testid="welcome" className={`${ui.card} border-orange`}>
          <div className={`${ui.head} ${ui.headOrange} border-orange`}><span className={ui.eyebrow}>You&apos;re in</span></div>
          <div className={ui.body}>
            <p className="text-sm font-semibold">Save this private link — it is how you get back to your team page on another phone. You can always find it again below while this phone stays signed in.</p>
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
            <TeamAvatar teamName={me.team.name} colour={me.team.colour} path={me.team.photo_path} size={46} />{me.team.name}
          </h2>
          <span className={`${ui.eyebrow} text-muted`}>Your team</span>
        </div>
        {/* PhotoForm holds the save while a photo is resizing and reports a failed save inline. */}
        <PhotoForm action={save} className={`${ui.body} grid gap-4 md:grid-cols-2`} footerClassName="md:col-span-2" submitLabel="Save team">
          <label className={ui.label}>Team name<LimitedField name="name" defaultValue={me.team.name} limit={PROFILE_LIMITS.name} required className={ui.field} /></label>
          <label className={ui.label}>Tagline<LimitedField name="tagline" defaultValue={me.team.tagline} limit={PROFILE_LIMITS.tagline} className={ui.field} /></label>
          <label className={ui.label}>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="colour-dot mt-2 block" /></label>
          <label className={ui.label}>Team photo
            <PhotoField teamName={me.team.name} colour={me.team.colour} currentPath={me.team.photo_path} />
          </label>
          <label className={`${ui.label} md:col-span-2`}>About your team<LimitedField name="description" defaultValue={me.team.description} limit={PROFILE_LIMITS.description} rows={2} className={`${ui.field} resize-y font-normal normal-case tracking-normal`} /></label>
        </PhotoForm>
      </section>

      {/* Always here, folded away: a team that closed the welcome card, or wants its link on a
          second phone, would otherwise have no way to see it again. */}
      <details data-testid="private-link" className={`${ui.card} group`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-7 py-4 [&::-webkit-details-marker]:hidden">
          <h2 className={ui.eyebrow}>Your team&apos;s private link</h2>
          <span className={`${ui.eyebrow} text-muted`}><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span>
        </summary>
        <div className={`${ui.body} border-t-2 border-navy`}>
          <p className="text-sm">Open it on any phone to get back to this page. Share it only with your own players: anyone holding it can edit your team and submit your scores.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <code className={ui.code}>{privateLink}</code>
            <CopyButton text={privateLink} className={ui.secondary} label="Copy link" />
          </div>
          <p className={ui.help}>{LOST_LINK}</p>
        </div>
      </details>

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
                <RosterFields
                  defaults={{ mixed1: byRole('mixed1'), mixed2: byRole('mixed2'), woman: byRole('woman') }}
                />
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
                {scoreForm(next)}
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
            {/* The next match already has its form above; two copies of one form on a page would
                each keep their own half-typed scores and read as two separate submissions. */}
            {canSubmit(m) && m.id !== next?.id && scoreForm(m)}
          </MatchCard>
        ))}</div>
      </section>
    </div>
  );
}
