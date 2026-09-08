import { requireAdmin } from '@/actions/guard';
import { updateSettings } from '@/actions/tournaments';
import { redirect } from 'next/navigation';
import { FlashMessage } from '@/components/FlashMessage';
import { gameLabel, settingsFor } from '@/lib/db/mappers';
import { LocalDateTimeInput } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';

export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const locked = t.status !== 'setup';

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
    const r = await updateSettings(slug, formData);
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'Settings saved' : r.message ?? r.error)}`);
  }

  const field = 'mt-1 w-full rounded border p-2';

  return (
    <div className="space-y-6">
      <FlashMessage />
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">Settings {locked && <span className="text-xs font-normal text-slate-500">(rules are locked after setup; date and venue stay editable)</span>}</h2>
        <form action={save} className="space-y-4 text-sm">
          <fieldset className="rounded border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Event</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label>Date and time<LocalDateTimeInput name="startsAt" defaultIso={t.starts_at} className={field} /></label>
              <label>Venue<input name="venue" maxLength={120} defaultValue={t.venue ?? ''} className={field} /></label>
            </div>
          </fieldset>

          <fieldset className="rounded border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pool stage</legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <label>Games per match<input name="pool_gamesPerMatch" type="number" defaultValue={pool.gamesPerMatch} disabled={locked} className={field} /></label>
              <label>Points per game<input name="pool_pointsPerGame" type="number" defaultValue={pool.pointsPerGame} disabled={locked} className={field} /></label>
              <label>Points cap (blank = none)<input name="pool_maxPoints" type="number" defaultValue={pool.maxPoints ?? ''} disabled={locked} className={field} /></label>
              <label>Clock minutes per game (blank = no clock)<input name="pool_timeCap" type="number" defaultValue={pool.timeCapMinutes ?? ''} disabled={locked} className={field} /></label>
              <label className="flex items-end gap-2 pb-2"><input name="pool_winByTwo" type="checkbox" defaultChecked={pool.winByTwo} disabled={locked} /> Win by two</label>
              <label className="flex items-end gap-2 pb-2"><input name="pool_playAllGames" type="checkbox" defaultChecked={pool.playAllGames} disabled={locked} /> Play every game</label>
            </div>
          </fieldset>

          <fieldset className="rounded border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Game names</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {gameNumbers.map((n) => (
                <label key={n}>Game {n}<input name={`gameLabel${n}`} maxLength={40} defaultValue={gameLabel(t, n)} disabled={locked} className={field} /></label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Knockout stage</legend>
            <label className="mb-3 flex items-center gap-2"><input name="ko_same" type="checkbox" defaultChecked={koSame} disabled={locked} /> Same as the pool stage</label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <label>Games per match<input name="ko_gamesPerMatch" type="number" defaultValue={knockout.gamesPerMatch} disabled={locked} className={field} /></label>
              <label>Points per game<input name="ko_pointsPerGame" type="number" defaultValue={knockout.pointsPerGame} disabled={locked} className={field} /></label>
              <label>Points cap (blank = none)<input name="ko_maxPoints" type="number" defaultValue={knockout.maxPoints ?? ''} disabled={locked} className={field} /></label>
              <label>Clock minutes per game (blank = no clock)<input name="ko_timeCap" type="number" defaultValue={knockout.timeCapMinutes ?? ''} disabled={locked} className={field} /></label>
              <label className="flex items-end gap-2 pb-2"><input name="ko_winByTwo" type="checkbox" defaultChecked={knockout.winByTwo} disabled={locked} /> Win by two</label>
            </div>
            <p className="mt-2 text-xs text-slate-500">These are ignored while &ldquo;same as the pool stage&rdquo; is ticked.</p>
          </fieldset>

          <fieldset className="rounded border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Draw</legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <label>Courts<input name="courtCount" type="number" defaultValue={t.court_count} disabled={locked} className={field} /></label>
              <label>Advance per pool<input name="advancePerPool" type="number" defaultValue={t.advance_per_pool} disabled={locked} className={field} /></label>
            </div>
          </fieldset>

          {/* Disabled inputs are not posted, so once the rules are locked the form still has to
              carry them: updateSettings validates the whole form and then writes only the date and
              venue. These mirrors keep the submitted values identical to what is already stored. */}
          {locked && (
            <>
              <input type="hidden" name="pool_gamesPerMatch" value={pool.gamesPerMatch} />
              <input type="hidden" name="pool_pointsPerGame" value={pool.pointsPerGame} />
              <input type="hidden" name="pool_maxPoints" value={pool.maxPoints ?? ''} />
              <input type="hidden" name="pool_timeCap" value={pool.timeCapMinutes ?? ''} />
              {pool.winByTwo && <input type="hidden" name="pool_winByTwo" value="on" />}
              {pool.playAllGames && <input type="hidden" name="pool_playAllGames" value="on" />}
              {gameNumbers.map((n) => <input key={n} type="hidden" name={`gameLabel${n}`} value={gameLabel(t, n)} />)}
              {koSame ? <input type="hidden" name="ko_same" value="on" /> : (
                <>
                  <input type="hidden" name="ko_gamesPerMatch" value={knockout.gamesPerMatch} />
                  <input type="hidden" name="ko_pointsPerGame" value={knockout.pointsPerGame} />
                  <input type="hidden" name="ko_maxPoints" value={knockout.maxPoints ?? ''} />
                  <input type="hidden" name="ko_timeCap" value={knockout.timeCapMinutes ?? ''} />
                  {knockout.winByTwo && <input type="hidden" name="ko_winByTwo" value="on" />}
                </>
              )}
              <input type="hidden" name="courtCount" value={t.court_count} />
              <input type="hidden" name="advancePerPool" value={t.advance_per_pool} />
            </>
          )}
          <div className="flex items-center gap-3">
            <SubmitButton className="rounded bg-slate-900 px-4 py-2 text-white">{locked ? 'Save date and venue' : 'Save settings'}</SubmitButton>
            <a href={`/admin/${slug}/teams`} className={ui.secondary}>Manage teams</a>
          </div>
        </form>
      </section>
    </div>
  );
}
