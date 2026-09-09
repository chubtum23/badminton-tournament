import { validateRoster } from '@tournament/core';
import { addTeam, deleteTeam, regenerateToken, reinstateTeam, setJoinCode, setRoster, setSeed, setSignupOpen, withdrawTeam } from '@/actions/teams';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import type { TeamWithPlayers } from '@/lib/db/queries';
import type { TournamentRow } from '@/lib/db/types';
import { rosterOf } from '@/lib/teams/roster';
import { CopyButton } from './CopyButton';
import { RosterFields } from './RosterFields';
import { SubmitButton } from './SubmitButton';
import { ui } from './ui';

export function TeamsAdmin({ slug, tournament: t, teams, tokens, baseUrl, joinCode }: {
  slug: string; tournament: TournamentRow; teams: TeamWithPlayers[]; tokens: Record<string, string>; baseUrl: string; joinCode: string;
}) {
  const here = `/admin/${slug}/teams`;
  const locked = t.status !== 'setup';
  const complete = teams.filter((x) => validateRoster(rosterOf(x)).ok);
  const joinLink = `${baseUrl}/t/${slug}/join`;
  const open = t.signup_open && !locked;

  async function add(fd: FormData) { 'use server'; redirectWithMsg(here, await addTeam(slug, fd), 'Team added'); }
  async function roster(fd: FormData) { 'use server'; redirectWithMsg(here, await setRoster(slug, String(fd.get('teamId')), fd), 'Players saved'); }
  async function seed(fd: FormData) {
    'use server';
    const raw = String(fd.get('seed') ?? '').trim();
    redirectWithMsg(here, await setSeed(slug, String(fd.get('teamId')), raw === '' ? null : Number(raw)), 'Seed saved');
  }
  async function remove(fd: FormData) { 'use server'; redirectWithMsg(here, await deleteTeam(slug, String(fd.get('teamId'))), 'Team removed'); }
  async function withdraw(fd: FormData) { 'use server'; redirectWithMsg(here, await withdrawTeam(slug, String(fd.get('teamId'))), 'Team withdrawn'); }
  async function reinstate(fd: FormData) { 'use server'; redirectWithMsg(here, await reinstateTeam(slug, String(fd.get('teamId'))), 'Team reinstated'); }
  async function regen(fd: FormData) { 'use server'; redirectWithMsg(here, await regenerateToken(slug, String(fd.get('teamId'))), 'New link generated'); }
  async function toggleSignup(fd: FormData) { 'use server'; redirectWithMsg(here, await setSignupOpen(slug, fd.get('open') === '1'), fd.get('open') === '1' ? 'Sign-ups opened' : 'Sign-ups closed'); }
  async function code(fd: FormData) { 'use server'; redirectWithMsg(here, await setJoinCode(slug, String(fd.get('joinCode') ?? '')), 'Join code saved'); }

  const byRole = (x: TeamWithPlayers, r: 'mixed1' | 'mixed2' | 'woman') => x.players.find((p) => p.role === r)?.name ?? '';

  return (
    <div className="space-y-6">
      {/* The sign-up link is the one thing an organiser copies out of this app, so it leads the
          page and the copy button is the only orange control on it. */}
      <section className={ui.card}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <h2 className={ui.eyebrow}>Sign-ups</h2>
          <span className={ui.eyebrow}>{open ? 'Open' : 'Closed'}</span>
        </div>
        <div className={`${ui.body} space-y-4`}>
          <p className="text-sm text-muted-strong">
            {teams.length} team{teams.length === 1 ? '' : 's'} signed up, {complete.length} complete roster{complete.length === 1 ? '' : 's'}.
            {' '}Share this link — teams sign themselves up.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <code className={ui.code}>{joinLink}</code>
            <CopyButton text={joinLink} className={ui.primary} label="Copy link" />
            {!locked && (
              <form action={toggleSignup}>
                <input type="hidden" name="open" value={t.signup_open ? '0' : '1'} />
                <SubmitButton className={ui.secondary}>{t.signup_open ? 'Close sign-ups' : 'Open sign-ups'}</SubmitButton>
              </form>
            )}
          </div>
          <form action={code} className="flex flex-wrap items-end gap-2.5">
            <label className={ui.label}>Join code <span className="font-normal normal-case tracking-normal text-muted">(optional)</span>
              <input name="joinCode" defaultValue={joinCode} maxLength={30} placeholder="blank = anyone with the link" className={ui.field} />
            </label>
            <SubmitButton className={ui.secondary}>Save code</SubmitButton>
          </form>
        </div>
      </section>

      <section className={ui.card}>
        <div className={ui.head}>
          <h2 className={ui.eyebrow}>Teams</h2>
          <span className={`${ui.eyebrow} text-muted`}>{teams.length}</span>
        </div>
        <div className="px-7">
          {teams.length === 0 && <p className="py-5 text-[15px] text-muted">No teams yet. Share the sign-up link or add one below.</p>}
          <ul className="divide-y divide-line-soft">
            {teams.map((x) => {
              const ok = validateRoster(rosterOf(x)).ok;
              return (
                <li key={x.id} data-testid="team-row" className="py-4">
                  <details>
                    <summary className="disclosure flex flex-wrap items-center gap-2.5">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: x.colour }} />
                      <span className={`font-display text-[15px] font-extrabold uppercase ${x.withdrawn ? 'text-muted-soft line-through' : ''}`}>{x.name}</span>
                      {x.tagline && <span className="text-[15px] text-muted">{x.tagline}</span>}
                      {!ok && <span className={ui.pillTodo}>Incomplete roster</span>}
                      {x.withdrawn && <span className={ui.pillLocked}>Withdrawn</span>}
                      <span className={`${ui.eyebrow} ml-auto text-muted`}>details</span>
                    </summary>
                    <div className="mt-4 space-y-5 border-l-2 border-line pl-5">
                      <form action={roster} className="space-y-4">
                        <input type="hidden" name="teamId" value={x.id} />
                        <RosterFields defaults={{ mixed1: byRole(x, 'mixed1'), mixed2: byRole(x, 'mixed2'), woman: byRole(x, 'woman') }} disabled={locked} />
                        {!locked && <SubmitButton className={ui.secondary}>Save players</SubmitButton>}
                      </form>
                      <div className="flex flex-wrap items-center gap-3">
                        <form action={seed} className="flex items-end gap-1.5">
                          <input type="hidden" name="teamId" value={x.id} />
                          <label className={ui.label}>Seed label
                            <input name="seed" type="number" min={1} max={64} defaultValue={x.seed ?? ''} className={`${ui.field} w-20`} />
                          </label>
                          <SubmitButton className={ui.tiny}>Set</SubmitButton>
                        </form>
                        {tokens[x.id] && (
                          <>
                            <code className={ui.code}>{baseUrl}/t/{slug}/team/{tokens[x.id]}</code>
                            <CopyButton text={`${baseUrl}/t/${slug}/team/${tokens[x.id]}`} className={ui.secondary} label="Copy link" />
                            <form action={regen}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage="Generate a new private link? The old one stops working." className={ui.tiny}>Regenerate link</SubmitButton></form>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {x.withdrawn ? (
                          <form action={reinstate}><input type="hidden" name="teamId" value={x.id} /><SubmitButton className={ui.secondary}>Reinstate</SubmitButton></form>
                        ) : (
                          <form action={withdraw}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage={`Withdraw ${x.name}? Their open matches are forfeited to the opponent.`} className={ui.danger}>Withdraw</SubmitButton></form>
                        )}
                        {!locked && (
                          <form action={remove}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage={`Remove ${x.name} and their players? This cannot be undone.`} className={ui.danger}>Remove team</SubmitButton></form>
                        )}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {!locked && (
        <section className={ui.card}>
          <div className={ui.head}>
            <h2 className={ui.eyebrow}>Add a team yourself</h2>
            <span className={`${ui.eyebrow} text-muted`}>For a team that could not use the link</span>
          </div>
          <form action={add} className={`${ui.body} space-y-6`}>
            <label className={ui.label}>Team name<input name="name" required maxLength={40} className={ui.field} placeholder="e.g. Net Ninjas" /></label>
            <RosterFields />
            <SubmitButton className={ui.solid}>Add team</SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}
