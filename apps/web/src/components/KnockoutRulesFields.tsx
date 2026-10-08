'use client';
import { useState } from 'react';
import type { Settings } from '@tournament/core';
import { ui } from './ui';

export interface RelayTargets { quarter: number; semi: number; final: number }

/**
 * The knockout half of the rules form.
 *
 * Relay replaces the ordinary knockout format: one game per match to a target per round, the pairs
 * swapping at each third of it. Otherwise "same as the pool stage" greys the knockout boxes out,
 * because the server ignores them then: an organiser changing the clock with the box still ticked
 * would otherwise see "Rules saved" and nothing change.
 */
export function KnockoutRulesFields({ knockout, same, relay, targets, locked }: {
  knockout: Settings; same: boolean; relay: boolean; targets: RelayTargets; locked: boolean;
}) {
  const [isSame, setSame] = useState(same);
  const [isRelay, setRelay] = useState(relay);
  return (
    <>
      <label className={ui.check}>
        <input name="ko_relay" type="checkbox" className={ui.checkbox} checked={isRelay} onChange={(e) => setRelay(e.target.checked)} disabled={locked} />
        Relay matches
      </label>
      {isRelay ? (
        <>
          <fieldset disabled={locked} className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="ko-relay">
            <label className={ui.label}>Quarter-finals to<input name="ko_relay_quarter" type="number" step={3} defaultValue={targets.quarter} className={ui.field} /><span className={ui.help}>Earlier rounds use this too.</span></label>
            <label className={ui.label}>Semi-finals to<input name="ko_relay_semi" type="number" step={3} defaultValue={targets.semi} className={ui.field} /></label>
            <label className={ui.label}>Final to<input name="ko_relay_final" type="number" step={3} defaultValue={targets.final} className={ui.field} /></label>
          </fieldset>
          <p className={ui.help}>
            Each knockout match is one game, first to the target; at one point short each, the next point wins. No clock. The
            pairs swap the moment either team reaches a third of the target (15 and 30 in a game to 45): Mixed #1, then
            Mixed #2, then the men&apos;s doubles. Targets must divide by 3.
          </p>
        </>
      ) : (
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
      )}
    </>
  );
}
