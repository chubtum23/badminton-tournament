'use client';
import { useState } from 'react';
import type { Settings } from '@tournament/core';
import { ui } from './ui';

/**
 * The knockout half of the rules form. While "same as the pool stage" is ticked the knockout boxes
 * are greyed out, because the server ignores them then: an organiser changing the clock with the
 * box still ticked would otherwise see "Rules saved" and nothing change.
 */
export function KnockoutRulesFields({ knockout, same, locked }: { knockout: Settings; same: boolean; locked: boolean }) {
  const [isSame, setSame] = useState(same);
  return (
    <>
      <label className={ui.check}>
        <input name="ko_same" type="checkbox" className={ui.checkbox} checked={isSame} onChange={(e) => setSame(e.target.checked)} disabled={locked} />
        Same as the pool stage
      </label>
      <fieldset disabled={locked || isSame} className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="ko-rules">
        <label className={ui.label}>Games per match<input name="ko_gamesPerMatch" type="number" defaultValue={knockout.gamesPerMatch} className={ui.field} /></label>
        <label className={ui.label}>Points per game<input name="ko_pointsPerGame" type="number" defaultValue={knockout.pointsPerGame} className={ui.field} /></label>
        <label className={ui.label}>Points cap<input name="ko_maxPoints" type="number" defaultValue={knockout.maxPoints ?? ''} className={ui.field} /><span className={ui.help}>Blank for none.</span></label>
        <label className={ui.label}>Clock minutes per game<input name="ko_timeCap" type="number" defaultValue={knockout.timeCapMinutes ?? ''} className={ui.field} /><span className={ui.help}>Blank for no clock.</span></label>
        <label className={ui.check}><input name="ko_winByTwo" type="checkbox" className={ui.checkbox} defaultChecked={knockout.winByTwo} /> Win by two</label>
      </fieldset>
      {!locked && <p className={ui.help}>{isSame ? 'Untick “same as the pool stage” to give the knockout its own clock and scoring.' : 'The knockout is scored with these rules.'}</p>}
    </>
  );
}
