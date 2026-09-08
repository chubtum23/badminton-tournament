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
    <>
      <section className={ui.card}>
        <h2 className={ui.h2}>Sign-ups</h2>
        <p className={ui.help}>{teams.length} team{teams.length === 1 ? '' : 's'} signed up, {complete.length} complete roster{complete.length === 1 ? '' : 's'}. Sign-ups are <b>{t.signup_open && !locked ? 'open' : 'closed'}</b>.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{joinLink}</code>
          <CopyButton text={joinLink} className={ui.secondary} label="Copy sign-up link" />
          {!locked && (
            <form action={toggleSignup}>
              <input type="hidden" name="open" value={t.signup_open ? '0' : '1'} />
              <SubmitButton className={ui.secondary}>{t.signup_open ? 'Close sign-ups' : 'Open sign-ups'}</SubmitButton>
            </form>
          )}
        </div>
        <form action={code} className="mt-4 flex flex-wrap items-end gap-2">
          <label className={ui.label}>Join code <span className="font-normal text-slate-500">(optional)</span>
            <input name="joinCode" defaultValue={joinCode} maxLength={30} placeholder="blank = anyone with the link" className={ui.field} />
          </label>
          <SubmitButton className={ui.secondary}>Save code</SubmitButton>
        </form>
      </section>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Teams ({teams.length})</h2>
        {teams.length === 0 && <p className={ui.help}>No teams yet. Share the sign-up link or add one below.</p>}
        <ul className="divide-y">
          {teams.map((x) => {
            const ok = validateRoster(rosterOf(x)).ok;
            return (
              <li key={x.id} data-testid="team-row" className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-base">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: x.colour }} />
                    <span className={`font-medium ${x.withdrawn ? 'text-slate-400 line-through' : ''}`}>{x.name}</span>
                    {x.tagline && <span className="text-sm text-slate-500">{x.tagline}</span>}
                    {!ok && <span className={ui.pillTodo}>Incomplete roster</span>}
                    {x.withdrawn && <span className={ui.pillLocked}>Withdrawn</span>}
                    <span className="ml-auto text-xs text-slate-500">▾ details</span>
                  </summary>
                  <div className="mt-3 space-y-4 pl-5">
                    <form action={roster} className="space-y-3">
                      <input type="hidden" name="teamId" value={x.id} />
                      <RosterFields defaults={{ mixed1: byRole(x, 'mixed1'), mixed2: byRole(x, 'mixed2'), woman: byRole(x, 'woman') }} disabled={locked} />
                      {!locked && <SubmitButton className={ui.secondary}>Save players</SubmitButton>}
                    </form>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <form action={seed} className="flex items-center gap-1">
                        <input type="hidden" name="teamId" value={x.id} />
                        <label className="text-slate-600">Seed label<input name="seed" type="number" min={1} max={64} defaultValue={x.seed ?? ''} className="ml-1 w-16 rounded border p-1" /></label>
                        <SubmitButton className={ui.secondary}>Set</SubmitButton>
                      </form>
                      {tokens[x.id] && (
                        <>
                          <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{baseUrl}/t/{slug}/team/{tokens[x.id]}</code>
                          <CopyButton text={`${baseUrl}/t/${slug}/team/${tokens[x.id]}`} className={ui.secondary} label="Copy link" />
                          <form action={regen}><input type="hidden" name="teamId" value={x.id} /><SubmitButton confirmMessage="Generate a new private link? The old one stops working." className={ui.secondary}>Regenerate link</SubmitButton></form>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
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
      </section>

      {!locked && (
        <section className={ui.card}>
          <h2 className={ui.h2}>Add a team yourself</h2>
          <p className={ui.help}>For a team that could not use the sign-up link.</p>
          <form action={add} className="mt-4 space-y-4">
            <label className={ui.label}>Team name<input name="name" required maxLength={40} className={ui.field} /></label>
            <RosterFields />
            <SubmitButton className={ui.primary}>Add team</SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
