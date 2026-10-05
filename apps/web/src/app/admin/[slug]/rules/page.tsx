import { redirect } from 'next/navigation';
import { PAIR_SLOT_LABEL, pairSlotForGame } from '@tournament/core';
import { requireAdmin } from '@/actions/guard';
import { updateSettings } from '@/actions/tournaments';
import { redirectBackOnSuccess } from '@/actions/redirectWithMsg';
import { BackLink } from '@/components/BackLink';
import { FlashMessage } from '@/components/FlashMessage';
import { gameLabel, settingsFor } from '@/lib/db/mappers';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';
import { KnockoutRulesFields } from '@/components/KnockoutRulesFields';
import { listGames, listMatches } from '@/lib/db/queries';
import { knockoutHasPlay } from '@/lib/bracket/undo';

const fieldset = 'space-y-5 border-hair border-line p-6';
const legend = 'px-2 text-xs font-bold uppercase tracking-eyebrow text-navy';

export default async function RulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  // Two locks, not one: pool scoring would rewrite finished results the moment the pools start,
  // but the knockout has not been played yet, so its rules (and how many teams advance to it) stay
  // open right up until the knockout is started.
  // Once the bracket exists, its rules stay open until the first knockout game is scored or put on
  // court (the same test the knockout undo uses); who qualifies is fixed from the start.
  const locked = t.status !== 'setup';
  const koStarted = t.status === 'knockout' || t.status === 'finished';
  const koLocked = t.status === 'finished' || (koStarted && await (async () => {
    const [rows, gameRows] = await Promise.all([listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id)]);
    return knockoutHasPlay(rows, gameRows);
  })());

  const pool = settingsFor(t, 'pool');
  const knockout = settingsFor(t, 'knockout');
  // "Same as the pool stage" is the stored state when no ko_* override is set at all.
  const koSame = t.ko_games_per_match === null && t.ko_points_per_game === null && t.ko_win_by_two === null
    && t.ko_max_points === null && t.ko_time_cap_minutes === null;
  // One name field per game. The stored list can be longer than the current games per match (it
  // holds the club default of three), so show those too: raising games per match then saving keeps
  // the names the organiser can already see, and parseSettingsForm ignores anything past the count.
  const labelCount = Math.max(pool.gamesPerMatch, t.game_labels.length, 1);
  const gameNumbers = Array.from({ length: labelCount }, (_, i) => i + 1);

  async function save(formData: FormData) {
    'use server';
    redirectBackOnSuccess(`/admin/${slug}/rules`, `/admin/${slug}`, await updateSettings(slug, formData), 'Rules saved');
  }

  return (
    <div className="space-y-6">
      <BackLink href={`/admin/${slug}`}>Setup checklist</BackLink>
      <FlashMessage />
      <section className={ui.card}>
      <div className={`${ui.head} ${ui.headOrange}`}>
        <h2 className={ui.eyebrow}>Rules</h2>
        <span className={ui.eyebrow}>{koLocked ? 'Locked — the knockout has started' : locked ? 'Pool rules locked — the knockout is still open' : 'Step 2'}</span>
      </div>
      <form action={save} className={`${ui.body} space-y-6`}>
        <fieldset className={fieldset}>
          <legend className={legend}>Pool stage</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className={ui.label}>Games per match<input name="pool_gamesPerMatch" type="number" defaultValue={pool.gamesPerMatch} disabled={locked} className={ui.field} /></label>
            <label className={ui.label}>Points per game<input name="pool_pointsPerGame" type="number" defaultValue={pool.pointsPerGame} disabled={locked} className={ui.field} /></label>
            <label className={ui.label}>Points cap<input name="pool_maxPoints" type="number" defaultValue={pool.maxPoints ?? ''} disabled={locked} className={ui.field} /><span className={ui.help}>Blank for none.</span></label>
            <label className={ui.label}>Clock minutes per game<input name="pool_timeCap" type="number" defaultValue={pool.timeCapMinutes ?? ''} disabled={locked} className={ui.field} /><span className={ui.help}>Blank for no clock.</span></label>
            <label className={ui.check}><input name="pool_winByTwo" type="checkbox" className={ui.checkbox} defaultChecked={pool.winByTwo} disabled={locked} /> Win by two</label>
            <label className={ui.check}><input name="pool_playAllGames" type="checkbox" className={ui.checkbox} defaultChecked={pool.playAllGames} disabled={locked} /> Play every game</label>
          </div>
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>Game names</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {gameNumbers.map((n) => (
              <label key={n} className={ui.label}>Game {n}
                <input name={`gameLabel${n}`} maxLength={40} defaultValue={gameLabel(t, n)} disabled={locked} className={ui.field} />
                <span className={ui.help}>Played by: {PAIR_SLOT_LABEL[pairSlotForGame(n)]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>Knockout stage</legend>
          <KnockoutRulesFields knockout={knockout} same={koSame} locked={koLocked} />
          {t.status === 'knockout' && !koLocked && (
            <p className={ui.help}>The knockout has started but nothing in it has been played, so its rules can still change. They fix once the first knockout game is scored or put on court. Pool results are not affected.</p>
          )}
          {koLocked && t.status === 'knockout' && (
            <p className={ui.help}>Knockout games have been played under these rules. To change them, undo the knockout start on the Draw page; pool results are kept.</p>
          )}
        </fieldset>

        <fieldset className={fieldset}>
          <legend className={legend}>Draw</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className={ui.label}>Courts<input name="courtCount" type="number" defaultValue={t.court_count} className={ui.field} /><span className={ui.help}>Editable at any time. A game can always start without a court, so this is not a limit on how many run at once.</span></label>
            <label className={ui.label}>Advance per pool<input name="advancePerPool" type="number" defaultValue={t.advance_per_pool} disabled={koStarted} className={ui.field} /><span className={ui.help}>How many of each pool reach the knockout.{koStarted ? ' Fixed once the knockout starts.' : ''}</span></label>
          </div>
        </fieldset>

        {/* The date and venue live on the Event page now, but updateSettings still validates the
            whole settings form and writes them back, so this form has to carry what is stored. */}
        <input type="hidden" name="startsAt" value={t.starts_at ?? ''} />
        <input type="hidden" name="venue" value={t.venue ?? ''} />

        {/* Disabled inputs are not posted, so once the rules are locked the form still has to
            carry them: the mirrors keep the submitted values identical to what is already stored. */}
        {locked && (
          <>
            <input type="hidden" name="pool_gamesPerMatch" value={pool.gamesPerMatch} />
            <input type="hidden" name="pool_pointsPerGame" value={pool.pointsPerGame} />
            <input type="hidden" name="pool_maxPoints" value={pool.maxPoints ?? ''} />
            <input type="hidden" name="pool_timeCap" value={pool.timeCapMinutes ?? ''} />
            {pool.winByTwo && <input type="hidden" name="pool_winByTwo" value="on" />}
            {pool.playAllGames && <input type="hidden" name="pool_playAllGames" value="on" />}
            {gameNumbers.map((n) => <input key={n} type="hidden" name={`gameLabel${n}`} value={gameLabel(t, n)} />)}
          </>
        )}
        {koLocked && (
          <>
            {koSame ? <input type="hidden" name="ko_same" value="on" /> : (
              <>
                <input type="hidden" name="ko_gamesPerMatch" value={knockout.gamesPerMatch} />
                <input type="hidden" name="ko_pointsPerGame" value={knockout.pointsPerGame} />
                <input type="hidden" name="ko_maxPoints" value={knockout.maxPoints ?? ''} />
                <input type="hidden" name="ko_timeCap" value={knockout.timeCapMinutes ?? ''} />
                {knockout.winByTwo && <input type="hidden" name="ko_winByTwo" value="on" />}
              </>
            )}
          </>
        )}
        {koStarted && <input type="hidden" name="advancePerPool" value={t.advance_per_pool} />}

        {/* Courts stay editable at every stage, so there is always something to save. */}
        <SubmitButton className={ui.primary}>Save rules</SubmitButton>
      </form>
      </section>
    </div>
  );
}
