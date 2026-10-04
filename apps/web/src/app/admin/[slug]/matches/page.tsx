import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { confirmSubmission } from '@/actions/matches';
import { restartMatch } from '@/actions/games';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { gameSlotsByMatch, listGames, listMatches, listPools, listSubmissions, listTeamsWithPlayers, latestByMatch } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { scheduleBoard } from '@/lib/schedule/board';
import { MatchCard, teamName } from '@/components/MatchCard';
import { GameLine } from '@/components/GameLine';
import { NowPlaying } from '@/components/NowPlaying';
import { SubmissionCompare } from '@/components/SubmissionCompare';
import { SubmitButton } from '@/components/SubmitButton';
import { FlashMessage } from '@/components/FlashMessage';
import { RecentOutcome } from '@/components/RecentOutcome';
import { poolTone, ui } from '@/components/ui';

export default async function MatchesAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ pool?: string }> }) {
  const { slug } = await params;
  const { pool: poolFilter = 'all' } = await searchParams;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows, subs] = await Promise.all([
    listPools(ctx.sb, t.id), listTeamsWithPlayers(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id), listSubmissions(ctx.sb, t.id),
  ]);
  const matches = matchRows.map(rowToMatch);
  // Rules are per stage, so each meeting's games are rendered against their own settings.
  const settingsOf = (m: typeof matches[number]) => settingsFor(t, m.stage);
  // Every game row of a meeting, played or not: these are what go to court and take a score.
  const slots = gameSlotsByMatch(gameRows);
  const board = scheduleBoard({
    tournament: t, matches, slots: gameRows, poolOrder: pools.map((p) => p.id),
    stage: t.status === 'pools' ? 'pool' : 'knockout',
  });
  const latest = latestByMatch(subs);
  // One tab per pool, plus All and Knockout: the organiser runs one pool at a time on the night.
  const inTab = (m: typeof matches[number]) =>
    poolFilter === 'all' ? true : poolFilter === 'knockout' ? m.stage === 'knockout' : m.poolId === poolFilter;
  const visible = matches.filter(inTab);
  const ready = visible.filter((m) => m.status !== 'done' && m.status !== 'pending');
  const waiting = visible.filter((m) => m.status === 'pending');
  const finished = visible.filter((m) => m.status === 'done');
  const attention = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');
  const poolIndex = (m: typeof matches[number]) => pools.findIndex((p) => p.id === m.poolId);
  const poolName = (m: typeof matches[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? `${poolName(m)} · #${m.slot}`
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round} · #${m.slot}`;
  /** A knockout meeting has no pool, so it takes the neutral head rather than a pool's colour. */
  const tone = (m: typeof matches[number]) => (poolIndex(m) >= 0 ? poolTone(poolIndex(m)).head : undefined);
  const here = `/admin/${slug}/matches?pool=${poolFilter}`;
  const tabsList = [['all', 'All'], ...pools.map((p) => [p.id, p.name] as const), ['knockout', 'Knockout']] as const;

  async function confirm(formData: FormData) {
    'use server';
    redirectWithMsg(here, await confirmSubmission(slug, String(formData.get('matchId')), String(formData.get('submissionId'))), 'Result confirmed');
  }
  async function restart(formData: FormData) {
    'use server';
    redirectWithMsg(here, await restartMatch(slug, String(formData.get('matchId'))), 'Match restarted');
  }
  /** Started at all: a game on court, a point on its sheet, or a score. */
  const begun = (m: typeof matches[number]) => (slots[m.id] ?? []).some((s) => s.started_at !== null || s.score_a !== null);
  /** The playable card: one row per game. Finished meetings get the same one so a score entered by
      mistake can still be changed. */
  const card = (m: typeof matches[number]) => (
    <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} tone={tone(m)} slots={slots[m.id]} gameList={false}>
      {m.teamAId && m.teamBId ? (
        <div className="flex flex-col gap-2.5">
          {(slots[m.id] ?? []).map((s) => (
            <GameLine key={s.game_no} tournament={t} match={m} slot={s} settings={settingsOf(m)} teams={teams} admin={m.status !== 'pending'} collapsible />
          ))}
          {begun(m) && (
            <form action={restart} className="flex justify-end">
              <input type="hidden" name="matchId" value={m.id} />
              <SubmitButton
                confirmMessage="Restart this whole match? Every game's score, clock and point-by-point sheet is wiped and the games come off court."
                className={ui.tiny}
              >Restart match</SubmitButton>
            </form>
          )}
        </div>
      ) : <p className="text-xs font-bold uppercase tracking-label text-muted">Waiting on both teams.</p>}
    </MatchCard>
  );

  /** A heading with the count set apart, as the design has it: "Ready to play (6)". */
  const heading = (text: string, n: number) => (
    <h2 className={ui.h2}>{text} <span className="text-muted-soft">({n})</span></h2>
  );

  return (
    <div className="space-y-6">
      <FlashMessage />
      <RecentOutcome />
      <NowPlaying tournament={t} games={board.nowPlaying} teams={teams} settings={settingsOf} admin />

      {attention.length > 0 && (
        <section className={`${ui.card} border-orange`}>
          <div className={`${ui.head} ${ui.headOrange} border-orange`}>
            <h2 className={ui.eyebrow}>Needs attention</h2>
            <span data-testid="attention-count" className={ui.eyebrow}>{attention.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-6 p-4 sm:p-7 lg:grid-cols-2">
            {attention.map((m) => (
              <MatchCard key={m.id} match={m} teams={teams} games={[]} label={`${label(m)} · ${m.status}`} tone={tone(m)} slots={slots[m.id]} gameList={false}>
                <SubmissionCompare a={latest[m.id]?.a} b={latest[m.id]?.b} teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)}
                  onConfirm={(id) => (
                    <form action={confirm}>
                      <input type="hidden" name="matchId" value={m.id} />
                      <input type="hidden" name="submissionId" value={id} />
                      <SubmitButton className="bg-navy px-3 py-1.5 text-xs font-bold uppercase tracking-label text-white hover:bg-ink">Confirm this</SubmitButton>
                    </form>
                  )} />
                <p className={ui.help}>Or enter the games yourself in the list below.</p>
              </MatchCard>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading('Ready to play', ready.length)}
        <nav aria-label="Filter by pool" className="flex flex-wrap gap-2">
          {tabsList.map(([key, name]) => (
            <a
              key={key}
              href={`/admin/${slug}/matches?pool=${key}`}
              aria-current={key === poolFilter ? 'page' : undefined}
              className={`px-4 py-1.5 text-xs font-bold uppercase tracking-label ${
                key === poolFilter ? 'bg-navy text-white' : 'border-hair border-line-strong text-muted-strong hover:border-navy hover:text-navy'
              }`}
            >{name}</a>
          ))}
        </nav>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {ready.map((m) => card(m))}
        {ready.length === 0 && <p className={`${ui.empty} lg:col-span-2`}>Nothing waiting.</p>}
      </div>

      {waiting.length > 0 && (
        <section className="space-y-4">
          {heading('Waiting on an earlier result', waiting.length)}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {waiting.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} tone={tone(m)} slots={slots[m.id]} gameList={false} />)}
          </div>
        </section>
      )}

      <details className={ui.card} open={finished.length > 0 && ready.length === 0}>
        <summary className={`${ui.head} disclosure`}>
          <span className={ui.eyebrow}>Finished</span>
          <span data-testid="finished-count" className={`${ui.eyebrow} ml-auto text-muted`}>{finished.length}</span>
        </summary>
        <div className="grid grid-cols-1 gap-6 p-4 sm:p-7 lg:grid-cols-2">
          {finished.map((m) => card(m))}
        </div>
      </details>
    </div>
  );
}
