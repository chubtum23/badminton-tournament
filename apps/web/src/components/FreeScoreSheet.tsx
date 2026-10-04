'use client';
import { useEffect, useState } from 'react';
import type { Settings } from '@tournament/core';
import { blankSheet, decodeFreeSheet, encodeFreeSheet, FREE_SHEET_KEY, type FreeSheet, type FreeSide } from '@/lib/results/freeSheet';
import { ScoreSheet } from './ScoreSheet';
import { ui } from './ui';

/**
 * A score sheet that belongs to no match: pick or type the two sides and score one game. It is
 * kept on this phone only (so a refresh loses nothing) and never touches the tournament.
 */
export function FreeScoreSheet({ slug, settings, teams }: {
  slug: string;
  settings: Settings;
  /** Every team, already turned into the side it would bring. */
  teams: FreeSide[];
}) {
  const key = FREE_SHEET_KEY(slug);
  const [sheet, setSheet] = useState<FreeSheet>(blankSheet);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try { setSheet(decodeFreeSheet(localStorage.getItem(key))); } catch { /* storage blocked */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, encodeFreeSheet(sheet)); } catch { /* storage blocked */ }
  }, [key, sheet, loaded]);

  const setSide = (which: 'a' | 'b', side: FreeSide) => setSheet((s) => ({ ...s, [which]: side }));
  const pickTeam = (which: 'a' | 'b', teamId: string) =>
    setSide(which, teams.find((t) => t.teamId === teamId) ? { ...teams.find((t) => t.teamId === teamId)! } : { teamId: '', label: which === 'a' ? 'Side 1' : 'Side 2', players: ['', ''] });
  const setPlayer = (which: 'a' | 'b', i: 0 | 1, name: string) => {
    const side = sheet[which];
    setSide(which, { ...side, players: i === 0 ? [name, side.players[1]] : [side.players[0], name] });
  };

  const begun = sheet.rallies.length > 0;
  const nameOr = (name: string, fallback: string) => name.trim() || fallback;
  const names = [
    nameOr(sheet.a.players[0], `${sheet.a.label} player 1`), nameOr(sheet.a.players[1], `${sheet.a.label} player 2`),
    nameOr(sheet.b.players[0], `${sheet.b.label} player 1`), nameOr(sheet.b.players[1], `${sheet.b.label} player 2`),
  ] as const;

  return (
    <div className="space-y-6">
      <section className={ui.card}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <h2 className={ui.h2}>Sides</h2>
          <button type="button" className={ui.tiny} data-testid="free-sheet-new"
            onClick={() => { if (!begun || window.confirm('Clear the sides and the score and start a new sheet?')) setSheet(blankSheet()); }}>
            New sheet
          </button>
        </div>
        <div className={`${ui.body} grid gap-8 sm:grid-cols-2`}>
          {(['a', 'b'] as const).map((which, n) => (
            <fieldset key={which} className="space-y-4" data-testid={`free-sheet-side-${which}`}>
              <label className={ui.label}>
                Side {n + 1}
                <select className={ui.field} value={sheet[which].teamId} onChange={(e) => pickTeam(which, e.target.value)}>
                  <option value="">Anyone (type the names)</option>
                  {teams.map((t) => <option key={t.teamId} value={t.teamId}>{t.label}</option>)}
                </select>
              </label>
              {([0, 1] as const).map((i) => (
                <label key={i} className={ui.label}>
                  Player {i + 1}
                  <input className={ui.field} value={sheet[which].players[i]} maxLength={60}
                    onChange={(e) => setPlayer(which, i, e.target.value)} />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <p className={`${ui.help} px-7 pb-7`}>
          Picking a team fills in its two men for a men&apos;s doubles tiebreak. Nothing here is saved to the
          tournament — when it&apos;s done, put the winner first in the pool on the Standings page.
        </p>
      </section>

      <section className={ui.card}>
        <div className={ui.head}>
          <h2 className={ui.h2}>{sheet.a.label} v {sheet.b.label}</h2>
          <span className={`${ui.eyebrow} text-muted`}>
            One game to {settings.pointsPerGame}{settings.winByTwo ? `, win by 2${settings.maxPoints ? `, cap ${settings.maxPoints}` : ''}` : ''}
          </span>
        </div>
        <div className={ui.body}>
          {loaded && (
            <ScoreSheet
              settings={settings} teamA={sheet.a.label} teamB={sheet.b.label} names={names}
              start={sheet.start} rallies={sheet.rallies}
              onChange={(next) => setSheet((s) => ({ ...s, start: next.start, rallies: next.rallies }))}
              doneNote=" Nothing is saved; sort the pool on Standings if this settled a tie."
            />
          )}
        </div>
      </section>
    </div>
  );
}
