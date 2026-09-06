# Participants, Submissions, Announcements and Realtime (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let participants open their private team link to customise their team and submit per-game scores for their own matches (confirmed by the opponent or an admin, disputed on mismatch), give admins a "Needs attention" queue and announcements, show unconfirmed scores publicly, and make every public page update live.

**Architecture:** Participant identity is a private token per team. Visiting `/t/[slug]/team/[token]` sets an httpOnly cookie scoped to that tournament and redirects to `/t/[slug]/team`; every participant action re-resolves the cookie token through the service-role client, scoped by tournament, and then acts. Submission decisions are a pure function (`decideSubmission`); confirmed results reuse `planResult` and a new `applyResultPlan` writer extracted from the admin action so admin and participant paths share one persistence routine. Public pages stay server components; a small client component subscribes to Supabase realtime and calls `router.refresh()`.

**Tech Stack:** Same as plan 2: Next.js 15.5 App Router, React 19, Tailwind 3, Supabase (`@supabase/ssr` `createBrowserClient` for realtime), Vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md` sections 2 (participant role), 3 (realtime), 5 (submitted/disputed lifecycle), 7 (Participant screen, Announcements, "Needs attention", unconfirmed tags), 8 (rate limiting, reconnect indicator), 9 (e2e with a submitted and a disputed match).

## Global Constraints

- Everything from plan 2's Global Constraints still applies (package names, versions, typed errors, `TEAM_PUBLIC_COLUMNS`, rules only from `@tournament/core`, commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`).
- Participant authorization: a request is a participant of team T only if the cookie `tt_<slug>` holds a 24-character token that matches `teams.edit_token` for a team in the tournament with that slug. Resolution always goes through the service-role client and always filters by `tournament_id` first (the unique constraint is per tournament).
- The service-role client is used only inside server code that has already resolved the token (or `requireAdmin`), never from a public read path.
- Participant capabilities (spec 2): edit own team `name` (1-40 chars), `tagline` (0-80), `colour` (`#rrggbb`); submit game scores for a match the team is in while that match is `ready`, `live` or `submitted`. Nothing else.
- Lifecycle (spec 5): team submission on `ready|live` → `submitted`; opponent submits identical games → `done` (via `planResult` + `applyResultPlan`); opponent submits different games → `disputed`; admin confirms a submission or enters a result → `done`. A team may resubmit; only its latest submission counts. Submitted but unconfirmed scores are shown on all views tagged "unconfirmed"; the bracket does not advance until `done`.
- Typed action errors: `invalid_score`, `match_not_editable`, `not_your_match`, `stale_state`, `not_admin`, `invalid_input`, plus a new `not_participant` for a missing or invalid team cookie (add it to `ActionError`).
- Rate limit (spec 8): token-link visits are limited per client IP to 30 per minute in an in-memory sliding window (single-instance v1; noted in README).
- Realtime (spec 3, 8): public pages refresh within about a second of a change; a small "reconnecting" indicator shows while the channel is not subscribed.
- Cookie: name `tt_<slug>`, `httpOnly`, `sameSite: 'lax'`, `path: /t/<slug>`, 30 days.

---

## File structure

```
apps/web/src/
  actions/errors.ts                          add 'not_participant'
  actions/matches.ts                         enterResult now delegates to applyResultPlan; add confirmSubmission
  actions/participant.ts                     updateMyTeam, submitScores (cookie-authorised)
  actions/announcements.ts                   postAnnouncement, togglePinned, deleteAnnouncement
  lib/results/persist.ts                     applyResultPlan(sb, input)  <- extracted from enterResult
  lib/participant/token.ts                   resolveTeamByToken, TOKEN_RE, cookieName
  lib/participant/rateLimit.ts (+ .test.ts)  allow(key, limit, windowMs)
  lib/participant/profile.ts (+ .test.ts)    parseProfileForm
  lib/submissions/decide.ts (+ .test.ts)     sameGames, decideSubmission
  lib/db/types.ts                            SubmissionRow, AnnouncementRow
  lib/db/queries.ts                          listSubmissions, latestSubmissionsByMatch, listAnnouncements; bundle gains submissions + announcements
  lib/supabase/browser.ts                    createBrowserSupabase()
  components/RealtimeRefresh.tsx             client: subscribe + router.refresh()
  components/MatchCard.tsx                   optional `pending` (unconfirmed) display
  components/Bracket.tsx                     unconfirmed tag
  components/SubmissionCompare.tsx           side-by-side submissions for admins
  components/AnnouncementList.tsx
  app/t/[slug]/layout.tsx                    My team tab when cookie present; Announcements tab; <RealtimeRefresh/>
  app/t/[slug]/team/[token]/route.ts         sets cookie, redirects
  app/t/[slug]/team/page.tsx                 My team panel + score entry
  app/t/[slug]/announcements/page.tsx
  app/t/[slug]/page.tsx                      pinned banner; pass pending submissions to cards
  app/t/[slug]/pools/page.tsx, bracket/page.tsx   pass pending submissions
  app/admin/[slug]/layout.tsx                Announcements tab
  app/admin/[slug]/matches/page.tsx          Needs attention section
  app/admin/[slug]/announcements/page.tsx
  e2e/participant.spec.ts                    participant + dispute + announcement flow
  README.md                                  participant links, rate limit note, realtime
```

---

### Task 1: Extract `applyResultPlan` so admin and participant paths share one writer

**Files:**
- Create: `apps/web/src/lib/results/persist.ts`
- Modify: `apps/web/src/actions/matches.ts` (`enterResult` body), `apps/web/src/actions/errors.ts`
- Test: existing `apps/web/src/lib/results/apply.test.ts`, `apps/web/src/integration/enterResult.integration.test.ts` must stay green; add one integration test.

**Interfaces:**
- Consumes: `ResultPlan` from `lib/results/apply.ts`, `MatchRow`, `matchToRow`.
- Produces:
  - `applyResultPlan(sb: SupabaseClient, input: { tournamentId: string; matchId: string; rows: MatchRow[]; plan: ResultPlan; tournamentStatus: TournamentStatus; now?: string }): Promise<{ ok: true } | { ok: false; error: ActionError; message: string }>` — performs the conditional claim on the primary match, deletes games and submissions for rolled-back matches AND for the primary match itself, writes the primary match's games, updates the remaining planned matches (with `finished_at` handling), and applies the `finished`/`knockout` status transitions exactly as `enterResult` did.
  - `ActionError` gains `'not_participant'`.

- [ ] **Step 1: Add the error kind**

In `apps/web/src/actions/errors.ts` extend the union:

```ts
export type ActionError =
  | 'invalid_score' | 'match_not_editable' | 'not_your_match' | 'stale_state'
  | 'not_admin' | 'invalid_settings' | 'invalid_input' | 'not_participant';
```

- [ ] **Step 2: Write `persist.ts`**

`apps/web/src/lib/results/persist.ts` (this is the body of the current `enterResult` from the claim onward, moved verbatim except for the two marked additions):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionError } from '@/actions/errors';
import type { MatchRow, TournamentStatus } from '@/lib/db/types';
import { matchToRow } from '@/lib/db/mappers';
import type { ResultPlan } from './apply';

export type PersistResult = { ok: true } | { ok: false; error: ActionError; message: string };

/**
 * Writes a ResultPlan. Shared by the admin result action and the participant confirmation path.
 * The caller has already authorised the write and loaded `rows` (all matches of the tournament).
 */
export async function applyResultPlan(
  sb: SupabaseClient,
  input: { tournamentId: string; matchId: string; rows: MatchRow[]; plan: ResultPlan; tournamentStatus: TournamentStatus; now?: string },
): Promise<PersistResult> {
  const { tournamentId, matchId, rows, plan } = input;
  const now = input.now ?? new Date().toISOString();
  const wasFinished = input.tournamentStatus === 'finished';
  const fail = (error: ActionError, message: string): PersistResult => ({ ok: false, error, message });

  // Claim the edited match: the update only matches if it is still in the state we planned against.
  const before = rows.find((r) => r.id === matchId)!;
  const primary = plan.updates.find((m) => m.id === matchId)!;
  const primaryRow = matchToRow(primary, tournamentId);
  let claimQuery = sb.from('matches')
    .update({ team_a_id: primaryRow.team_a_id, team_b_id: primaryRow.team_b_id, court: primaryRow.court, status: primaryRow.status, winner_id: primaryRow.winner_id, finished_at: primaryRow.status === 'done' ? now : null })
    .eq('id', matchId).eq('status', before.status);
  claimQuery = before.winner_id === null ? claimQuery.is('winner_id', null) : claimQuery.eq('winner_id', before.winner_id);
  const claim = await claimQuery.select('id');
  if (claim.error) return fail('invalid_input', claim.error.message);
  if ((claim.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');

  for (const id of plan.clearGamesFor) {
    const del = await sb.from('games').delete().eq('match_id', id);
    if (del.error) return fail('invalid_input', del.error.message);
    const subs = await sb.from('score_submissions').delete().eq('match_id', id);
    if (subs.error) return fail('invalid_input', subs.error.message);
  }
  // The primary match is claimed (and marked done) before its own games are written below; a
  // crash in between leaves a done match briefly without games, which is acceptable and
  // self-healing on the next edit (this routine always deletes and re-inserts a match's games).
  const delOwn = await sb.from('games').delete().eq('match_id', matchId);
  if (delOwn.error) return fail('invalid_input', delOwn.error.message);
  // ADDITION 1: a confirmed result supersedes any pending submissions for this match.
  const delOwnSubs = await sb.from('score_submissions').delete().eq('match_id', matchId);
  if (delOwnSubs.error) return fail('invalid_input', delOwnSubs.error.message);
  const insGames = await sb.from('games').insert(plan.gamesToWrite.map((g) => ({ match_id: matchId, game_no: g.gameNo, score_a: g.scoreA, score_b: g.scoreB })));
  if (insGames.error) return fail('invalid_input', insGames.error.message);

  for (const m of plan.updates) {
    if (m.id === matchId) continue; // already claimed above
    const row = matchToRow(m, tournamentId);
    const prev = rows.find((r) => r.id === m.id);
    const wasAlreadyDone = prev?.status === 'done';
    const update: Record<string, unknown> = {
      team_a_id: row.team_a_id, team_b_id: row.team_b_id, court: row.court, status: row.status, winner_id: row.winner_id,
    };
    if (row.status === 'done') {
      if (!wasAlreadyDone) update.finished_at = now;
    } else {
      update.finished_at = null;
    }
    const upd = await sb.from('matches').update(update).eq('id', m.id);
    if (upd.error) return fail('invalid_input', upd.error.message);
  }

  if (plan.tournamentFinished) {
    const fin = await sb.from('tournaments').update({ status: 'finished' }).eq('id', tournamentId).eq('status', 'knockout');
    if (fin.error) return fail('invalid_input', fin.error.message);
  } else if (wasFinished && !plan.terminalStillDone) {
    const reopen = await sb.from('tournaments').update({ status: 'knockout' }).eq('id', tournamentId).eq('status', 'finished');
    if (reopen.error) return fail('invalid_input', reopen.error.message);
  }
  return { ok: true };
}
```

- [ ] **Step 3: Make `enterResult` delegate**

Replace everything in `enterResult` from the `// Claim the edited match` comment through the status transitions with:

```ts
  const persisted = await applyResultPlan(ctx.sb, {
    tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status,
  });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidate(slug);
  return ok({ winnerId: plan.winnerId });
```

Remove the now-unused `wasFinished`, `now`, and `matchToRow` import from `matches.ts`; add `import { applyResultPlan } from '@/lib/results/persist';`. Keep `revalidate(slug)` and export it? No: create a shared `revalidateTournament(slug)` in `apps/web/src/actions/revalidate.ts`:

```ts
import { revalidatePath } from 'next/cache';

/** Every page that renders tournament state. */
export function revalidateTournament(slug: string): void {
  for (const p of [
    `/admin/${slug}`, `/admin/${slug}/matches`, `/admin/${slug}/bracket`, `/admin/${slug}/announcements`,
    `/t/${slug}`, `/t/${slug}/pools`, `/t/${slug}/bracket`, `/t/${slug}/team`, `/t/${slug}/announcements`,
  ]) revalidatePath(p);
}
```

and use it from `matches.ts` (replacing the local `revalidate`) and from the new actions in later tasks.

- [ ] **Step 4: Integration test that a confirmed result clears pending submissions**

Append to `apps/web/src/integration/enterResult.integration.test.ts` a test that inserts a `score_submissions` row for the ready match through the service client, then applies a plan with `applyResultPlan` (build the plan with `planResult` from `@/lib/results/apply` using the two teams and `BADMINTON_DEFAULTS` games `15-7, 15-9`) using the service client, and asserts the match is `done`, its `games` has 2 rows, and `score_submissions` for it is empty. Follow the file's existing setup (it creates a tournament through `create_tournament` and inserts teams and a pool match); reuse its fixtures.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
git add -A
git commit -m "refactor(web): extract applyResultPlan and revalidateTournament for reuse" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: all previous tests plus the new integration test pass.

---

### Task 2: Private team links: cookie handshake, rate limit, My team page, profile edits

**Files:**
- Create: `apps/web/src/lib/participant/token.ts`, `apps/web/src/lib/participant/rateLimit.ts`, `apps/web/src/lib/participant/rateLimit.test.ts`, `apps/web/src/lib/participant/profile.ts`, `apps/web/src/lib/participant/profile.test.ts`
- Create: `apps/web/src/app/t/[slug]/team/[token]/route.ts`, `apps/web/src/app/t/[slug]/team/page.tsx`
- Create: `apps/web/src/actions/participant.ts`
- Modify: `apps/web/src/app/t/[slug]/layout.tsx`

**Interfaces:**
- Produces:
  - `TOKEN_RE = /^[A-Za-z0-9_-]{24}$/`, `cookieName(slug): string` (`tt_${slug}`), `resolveTeamByToken(slug: string, token: string): Promise<{ tournament: TournamentRow; team: TeamRow } | null>` (service role, scoped by tournament), `currentParticipant(slug): Promise<{ tournament; team } | null>` (reads the cookie via `next/headers` and resolves it).
  - `allow(key: string, limit: number, windowMs: number, now?: number): boolean` sliding-window limiter; `resetRateLimit()` for tests.
  - `parseProfileForm(fd: FormData): { ok: true; value: { name: string; tagline: string; colour: string } } | { ok: false; problems: string[] }`.
  - server action `updateMyTeam(slug, formData): Promise<ActionResult>`.
  - `/t/[slug]/team/[token]` GET: rate-limited, validates, sets cookie, redirects to `/t/[slug]/team`; `/t/[slug]/team` page shows the panel or an explanation when no valid cookie.

- [ ] **Step 1: Failing tests for the pure pieces**

`apps/web/src/lib/participant/rateLimit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { allow, resetRateLimit } from './rateLimit';

describe('allow', () => {
  beforeEach(() => resetRateLimit());
  it('permits up to the limit within the window and refuses the next', () => {
    for (let i = 0; i < 3; i++) expect(allow('ip1', 3, 1000, 1000 + i)).toBe(true);
    expect(allow('ip1', 3, 1000, 1004)).toBe(false);
  });
  it('forgets hits older than the window', () => {
    for (let i = 0; i < 3; i++) expect(allow('ip1', 3, 1000, 1000 + i)).toBe(true);
    expect(allow('ip1', 3, 1000, 2001)).toBe(true);
  });
  it('tracks keys independently', () => {
    for (let i = 0; i < 3; i++) allow('ip1', 3, 1000, 1000);
    expect(allow('ip2', 3, 1000, 1000)).toBe(true);
  });
});
```

`apps/web/src/lib/participant/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseProfileForm } from './profile';

function fd(e: Record<string, string>): FormData { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; }

describe('parseProfileForm', () => {
  it('accepts a valid profile and trims whitespace', () => {
    expect(parseProfileForm(fd({ name: '  Smash Bros ', tagline: ' we smash ', colour: '#AbCdEf' })))
      .toEqual({ ok: true, value: { name: 'Smash Bros', tagline: 'we smash', colour: '#abcdef' } });
  });
  it('rejects empty or long names, long taglines and bad colours', () => {
    const r = parseProfileForm(fd({ name: '', tagline: 'x'.repeat(81), colour: 'red' }));
    expect(r).toEqual({ ok: false, problems: ['name must be 1-40 characters', 'tagline must be at most 80 characters', 'colour must look like #1a2b3c'] });
    expect(parseProfileForm(fd({ name: 'n'.repeat(41), tagline: '', colour: '#123456' })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @tournament/web -- src/lib/participant
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the pure pieces and the token resolver**

`apps/web/src/lib/participant/rateLimit.ts`:

```ts
/** In-memory sliding-window limiter. Single-instance v1; swap for a shared store when scaling out. */
const hits = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function resetRateLimit(): void {
  hits.clear();
}
```

`apps/web/src/lib/participant/profile.ts`:

```ts
export interface ProfileInput { name: string; tagline: string; colour: string }

export function parseProfileForm(fd: FormData): { ok: true; value: ProfileInput } | { ok: false; problems: string[] } {
  const name = String(fd.get('name') ?? '').trim();
  const tagline = String(fd.get('tagline') ?? '').trim();
  const colour = String(fd.get('colour') ?? '').trim().toLowerCase();
  const problems: string[] = [];
  if (name.length < 1 || name.length > 40) problems.push('name must be 1-40 characters');
  if (tagline.length > 80) problems.push('tagline must be at most 80 characters');
  if (!/^#[0-9a-f]{6}$/.test(colour)) problems.push('colour must look like #1a2b3c');
  return problems.length ? { ok: false, problems } : { ok: true, value: { name, tagline, colour } };
}
```

`apps/web/src/lib/participant/token.ts`:

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { createServiceSupabase } from '@/lib/supabase/service';
import { getTournamentBySlug } from '@/lib/db/queries';
import { TEAM_PUBLIC_COLUMNS, type TeamRow, type TournamentRow } from '@/lib/db/types';

export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
export const cookieName = (slug: string) => `tt_${slug}`;

export interface Participant { tournament: TournamentRow; team: TeamRow }

/** Service-role lookup, always scoped by tournament first (edit_token is unique per tournament, not globally). */
export async function resolveTeamByToken(slug: string, token: string): Promise<Participant | null> {
  if (!TOKEN_RE.test(token)) return null;
  const sb = createServiceSupabase();
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return null;
  const res = await sb.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('tournament_id', tournament.id).eq('edit_token', token).maybeSingle();
  if (res.error || !res.data) return null;
  return { tournament, team: res.data as TeamRow };
}

/** The participant identified by this request's cookie, or null. */
export async function currentParticipant(slug: string): Promise<Participant | null> {
  const jar = await cookies();
  const token = jar.get(cookieName(slug))?.value;
  if (!token) return null;
  return resolveTeamByToken(slug, token);
}
```

- [ ] **Step 4: Run the pure tests**

```bash
npm test -w @tournament/web -- src/lib/participant
```

Expected: 5 tests pass.

- [ ] **Step 5: Route handler that sets the cookie**

`apps/web/src/app/t/[slug]/team/[token]/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { cookieName, resolveTeamByToken } from '@/lib/participant/token';
import { allow } from '@/lib/participant/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await ctx.params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(`token:${ip}`, 30, 60_000)) {
    return new NextResponse('Too many attempts. Try again in a minute.', { status: 429 });
  }
  const participant = await resolveTeamByToken(slug, token);
  if (!participant) return new NextResponse('This team link is not valid.', { status: 404 });
  const res = NextResponse.redirect(new URL(`/t/${slug}/team`, req.url), 303);
  res.cookies.set(cookieName(slug), token, {
    httpOnly: true, sameSite: 'lax', path: `/t/${slug}`, maxAge: 60 * 60 * 24 * 30, secure: req.nextUrl.protocol === 'https:',
  });
  return res;
}
```

- [ ] **Step 6: Participant action for profile edits**

`apps/web/src/actions/participant.ts` (score submission is added in Task 3):

```ts
'use server';
import { currentParticipant } from '@/lib/participant/token';
import { parseProfileForm } from '@/lib/participant/profile';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';

export async function updateMyTeam(slug: string, formData: FormData): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return fail('invalid_input', parsed.problems.join('; '));
  const sb = createServiceSupabase();
  const upd = await sb.from('teams').update(parsed.value).eq('id', me.team.id).eq('tournament_id', me.tournament.id).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Team not found');
  revalidateTournament(slug);
  return ok(undefined);
}
```

- [ ] **Step 7: My team page and layout tab**

`apps/web/src/app/t/[slug]/team/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { currentParticipant } from '@/lib/participant/token';
import { updateMyTeam } from '@/actions/participant';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { createServerSupabase } from '@/lib/supabase/server';
import { listMatches, listPools, listTeams } from '@/lib/db/queries';
import { rowToMatch } from '@/lib/db/mappers';
import { MatchCard } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const me = await currentParticipant(slug);
  if (!me) {
    return (
      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">My team</h2>
        <p>Open the private link your organiser gave you to unlock this page. It is unique to your team; do not share it.</p>
      </div>
    );
  }
  const sb = await createServerSupabase();
  const [teams, pools, matchRows] = await Promise.all([listTeams(sb, me.tournament.id), listPools(sb, me.tournament.id), listMatches(sb, me.tournament.id)]);
  const mine = matchRows.map(rowToMatch).filter((m) => m.teamAId === me.team.id || m.teamBId === me.team.id);
  const next = mine.find((m) => m.status === 'live') ?? mine.find((m) => m.status === 'ready' || m.status === 'submitted' || m.status === 'disputed');
  const label = (m: typeof mine[number]) => m.stage === 'pool' ? pools.find((p) => p.id === m.poolId)?.name ?? 'Pool' : `Round ${m.round}`;

  async function save(formData: FormData) {
    'use server';
    redirectWithMsg(`/t/${slug}/team`, await updateMyTeam(slug, formData), 'Team updated');
  }

  return (
    <div className="space-y-4">
      {msg && <p className="rounded bg-slate-100 p-2 text-sm">{msg}</p>}
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><span className="inline-block h-3 w-3 rounded-full" style={{ background: me.team.colour }} />{me.team.name}</h2>
        <form action={save} className="grid gap-3 text-sm md:grid-cols-3">
          <label>Team name<input name="name" defaultValue={me.team.name} maxLength={40} required className="mt-1 w-full rounded border p-2" /></label>
          <label>Tagline<input name="tagline" defaultValue={me.team.tagline} maxLength={80} className="mt-1 w-full rounded border p-2" /></label>
          <label>Colour<input name="colour" type="color" defaultValue={me.team.colour} className="mt-1 h-10 w-full rounded border" /></label>
          <div className="md:col-span-3"><button className="rounded bg-slate-900 px-4 py-2 text-white">Save team</button></div>
        </form>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your next match</h2>
        {next ? <MatchCard match={next} teams={teams} games={[]} label={label(next)} /> : <p className="text-sm text-slate-500">No upcoming match right now.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Your matches</h2>
        <div className="grid gap-2 md:grid-cols-2">{mine.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} />)}</div>
      </section>
    </div>
  );
}
```

(Task 3 replaces the `games={[]}` placeholders with real games and adds the score entry form; keeping this task focused on identity.)

Modify `apps/web/src/app/t/[slug]/layout.tsx`: import `currentParticipant`, resolve `const me = await currentParticipant(slug);` after loading `t`, and build tabs as

```tsx
  const tabs: Array<readonly [string, string]> = [['', 'Live'], ['/pools', 'Pools'], ['/bracket', 'Bracket'], ['/announcements', 'Announcements']];
  if (me) tabs.push(['/team', `My team: ${me.team.name}`]);
```

(The Announcements route is created in Task 4; a 404 until then is acceptable in this intermediate commit.)

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
```

Then a quick manual-equivalent check with the dev server on port 3100: `curl -i http://localhost:3100/t/<existing-slug>/team/not-a-real-token` returns 404, and hammering it 31 times in a loop returns 429 on the 31st. Stop the server.

```bash
git add -A
git commit -m "feat(web): private team links with cookie handshake, rate limit and My team page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Score submissions: decide, submit, confirm, dispute, display

**Files:**
- Create: `apps/web/src/lib/submissions/decide.ts`, `apps/web/src/lib/submissions/decide.test.ts`
- Create: `apps/web/src/components/SubmissionCompare.tsx`
- Modify: `apps/web/src/lib/db/types.ts`, `apps/web/src/lib/db/queries.ts`, `apps/web/src/actions/participant.ts`, `apps/web/src/actions/matches.ts`, `apps/web/src/components/MatchCard.tsx`, `apps/web/src/components/Bracket.tsx`, `apps/web/src/app/t/[slug]/team/page.tsx`, `apps/web/src/app/t/[slug]/page.tsx`, `apps/web/src/app/t/[slug]/pools/page.tsx`, `apps/web/src/app/t/[slug]/bracket/page.tsx`, `apps/web/src/app/admin/[slug]/matches/page.tsx`

**Interfaces:**
- Produces:
  - `SubmissionRow { id: string; match_id: string; submitted_by: 'admin' | 'team_a' | 'team_b'; games: Game[]; created_at: string }`
  - `listSubmissions(sb, tournamentId): Promise<SubmissionRow[]>` (join through matches, newest first); `latestByMatch(rows): Record<matchId, { a?: SubmissionRow; b?: SubmissionRow }>` (latest per side); `TournamentBundle` gains `submissions: SubmissionRow[]`.
  - `sameGames(a: Game[], b: Game[]): boolean`
  - `decideSubmission(input: { settings: Settings; match: Match; side: 'a' | 'b'; games: Game[]; latest: { a?: SubmissionRow; b?: SubmissionRow } }): { outcome: 'submitted' } | { outcome: 'confirmed' } | { outcome: 'disputed' } | { error: 'match_not_editable' | 'invalid_score'; message: string }`
  - server actions: `submitScores(slug, matchId, formData)` (participant, cookie-authorised); `confirmSubmission(slug, matchId, submissionId)` (admin).
  - `MatchCard` gains optional `pending?: { games: Game[]; by: string }` rendering an "unconfirmed" tag and the pending scores; `Bracket` shows an "unconfirmed" tag on `submitted`/`disputed` matches.

- [ ] **Step 1: Failing decision tests**

`apps/web/src/lib/submissions/decide.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BADMINTON_DEFAULTS, type Match } from '@tournament/core';
import { decideSubmission, sameGames } from './decide';
import type { SubmissionRow } from '@/lib/db/types';

const match: Match = { id: 'm1', stage: 'pool', poolId: 'P', round: null, slot: 1, teamAId: 'A', teamBId: 'B', court: 1, status: 'live', winnerId: null, nextMatchId: null, nextMatchSide: null };
const win = [{ gameNo: 1, scoreA: 15, scoreB: 7 }, { gameNo: 2, scoreA: 15, scoreB: 9 }];
const other = [{ gameNo: 1, scoreA: 15, scoreB: 7 }, { gameNo: 2, scoreA: 15, scoreB: 10 }];
const sub = (by: 'team_a' | 'team_b', games = win): SubmissionRow => ({ id: `s-${by}`, match_id: 'm1', submitted_by: by, games, created_at: '2026-09-07T10:00:00Z' });

describe('sameGames', () => {
  it('compares by game number regardless of order', () => {
    expect(sameGames(win, [...win].reverse())).toBe(true);
    expect(sameGames(win, other)).toBe(false);
    expect(sameGames(win, win.slice(0, 1))).toBe(false);
  });
});

describe('decideSubmission', () => {
  it('first submission on a live match is just submitted', () => {
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match, side: 'a', games: win, latest: {} })).toEqual({ outcome: 'submitted' });
  });
  it('opponent agreeing confirms', () => {
    const m = { ...match, status: 'submitted' as const };
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match: m, side: 'b', games: win, latest: { a: sub('team_a') } })).toEqual({ outcome: 'confirmed' });
  });
  it('opponent disagreeing disputes', () => {
    const m = { ...match, status: 'submitted' as const };
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match: m, side: 'b', games: other, latest: { a: sub('team_a') } })).toEqual({ outcome: 'disputed' });
  });
  it('resubmitting by the same side with no opposing submission stays submitted', () => {
    const m = { ...match, status: 'submitted' as const };
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match: m, side: 'a', games: other, latest: { a: sub('team_a') } })).toEqual({ outcome: 'submitted' });
  });
  it('a corrected resubmission that now matches the opponent confirms from a disputed state', () => {
    const m = { ...match, status: 'disputed' as const };
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match: m, side: 'b', games: win, latest: { a: sub('team_a'), b: sub('team_b', other) } })).toEqual({ outcome: 'confirmed' });
  });
  it('rejects incomplete or invalid games and non-editable matches', () => {
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match, side: 'a', games: win.slice(0, 1), latest: {} })).toMatchObject({ error: 'invalid_score' });
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match, side: 'a', games: [{ gameNo: 1, scoreA: 15, scoreB: 14 }, win[1]!], latest: {} })).toMatchObject({ error: 'invalid_score' });
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match: { ...match, status: 'done' }, side: 'a', games: win, latest: {} })).toMatchObject({ error: 'match_not_editable' });
    expect(decideSubmission({ settings: BADMINTON_DEFAULTS, match: { ...match, status: 'pending', teamBId: null }, side: 'a', games: win, latest: {} })).toMatchObject({ error: 'match_not_editable' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -w @tournament/web -- src/lib/submissions
```

Expected: FAIL, cannot resolve `./decide`.

- [ ] **Step 3: Types, queries and the decision function**

Append to `apps/web/src/lib/db/types.ts`:

```ts
export interface SubmissionRow {
  id: string;
  match_id: string;
  submitted_by: 'admin' | 'team_a' | 'team_b';
  games: { gameNo: number; scoreA: number; scoreB: number }[];
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  tournament_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
}
```

Append to `apps/web/src/lib/db/queries.ts` (and import `SubmissionRow`):

```ts
export async function listSubmissions(sb: SupabaseClient, tournamentId: string): Promise<SubmissionRow[]> {
  const res = await sb
    .from('score_submissions')
    .select('id, match_id, submitted_by, games, created_at, matches!inner(tournament_id)')
    .eq('matches.tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  const rows = must(res, 'submissions') as unknown as Array<SubmissionRow & { matches: unknown }>;
  return rows.map(({ id, match_id, submitted_by, games, created_at }) => ({ id, match_id, submitted_by, games, created_at }));
}

export type LatestSubmissions = Record<string, { a?: SubmissionRow; b?: SubmissionRow }>;

/** Latest submission per side per match. Input must be newest-first (as listSubmissions returns). */
export function latestByMatch(rows: readonly SubmissionRow[]): LatestSubmissions {
  const out: LatestSubmissions = {};
  for (const r of rows) {
    const slot = (out[r.match_id] ??= {});
    if (r.submitted_by === 'team_a' && !slot.a) slot.a = r;
    if (r.submitted_by === 'team_b' && !slot.b) slot.b = r;
  }
  return out;
}
```

Extend `TournamentBundle` with `submissions: SubmissionRow[]` and load it in `loadTournamentBundle` alongside the others.

`apps/web/src/lib/submissions/decide.ts`:

```ts
import { matchResult, type Game, type Match, type Settings } from '@tournament/core';
import type { SubmissionRow } from '@/lib/db/types';

export function sameGames(a: readonly Game[], b: readonly Game[]): boolean {
  if (a.length !== b.length) return false;
  const key = (g: Game) => `${g.gameNo}:${g.scoreA}-${g.scoreB}`;
  const sa = [...a].map(key).sort();
  const sb = [...b].map(key).sort();
  return sa.every((k, i) => k === sb[i]);
}

export type Decision =
  | { outcome: 'submitted' } | { outcome: 'confirmed' } | { outcome: 'disputed' }
  | { error: 'match_not_editable' | 'invalid_score'; message: string };

const SUBMITTABLE: ReadonlySet<Match['status']> = new Set(['ready', 'live', 'submitted', 'disputed']);

/**
 * Spec 5: a team's submission on a ready/live match -> submitted; the opponent's identical
 * submission -> confirmed; a different one -> disputed. Only the latest submission per side counts,
 * so a corrected resubmission can confirm from a disputed state.
 */
export function decideSubmission(input: {
  settings: Settings; match: Match; side: 'a' | 'b'; games: Game[]; latest: { a?: SubmissionRow; b?: SubmissionRow };
}): Decision {
  const { match, side, games, latest } = input;
  if (!SUBMITTABLE.has(match.status) || !match.teamAId || !match.teamBId) {
    return { error: 'match_not_editable', message: 'This match is not open for scores' };
  }
  const result = matchResult(input.settings, games);
  if (!result.ok) return { error: 'invalid_score', message: result.reason };
  if (!result.complete) return { error: 'invalid_score', message: 'Enter games until one side has won the match' };
  const theirs = side === 'a' ? latest.b : latest.a;
  if (!theirs) return { outcome: 'submitted' };
  return sameGames(theirs.games, games) ? { outcome: 'confirmed' } : { outcome: 'disputed' };
}
```

- [ ] **Step 4: Run the decision tests**

```bash
npm test -w @tournament/web -- src/lib/submissions
```

Expected: 7 tests pass.

- [ ] **Step 5: Participant submit action**

Append to `apps/web/src/actions/participant.ts` (add imports: `planResult` from `@/lib/results/apply`, `applyResultPlan` from `@/lib/results/persist`, `decideSubmission` from `@/lib/submissions/decide`, `listMatches`, `listSubmissions`, `latestByMatch` from `@/lib/db/queries`, `rowToMatch`, `settingsFromTournament` from `@/lib/db/mappers`, `gamesFromForm` from `@/lib/results/form`):

```ts
export async function submitScores(slug: string, matchId: string, formData: FormData): Promise<ActionResult<{ outcome: 'submitted' | 'confirmed' | 'disputed' }>> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to submit scores');
  if (me.tournament.status !== 'pools' && me.tournament.status !== 'knockout') return fail('stale_state', 'Tournament is not in play');
  const sb = createServiceSupabase();
  const settings = settingsFromTournament(me.tournament);
  const [rows, subs] = await Promise.all([listMatches(sb, me.tournament.id), listSubmissions(sb, me.tournament.id)]);
  const row = rows.find((r) => r.id === matchId);
  if (!row) return fail('invalid_input', 'Unknown match');
  const side = row.team_a_id === me.team.id ? 'a' : row.team_b_id === me.team.id ? 'b' : null;
  if (!side) return fail('not_your_match', 'Your team is not in this match');
  const games = gamesFromForm(formData, settings.gamesPerMatch);
  const match = rowToMatch(row);
  const decision = decideSubmission({ settings, match, side, games, latest: latestByMatch(subs)[matchId] ?? {} });
  if ('error' in decision) return fail(decision.error, decision.message);

  const ins = await sb.from('score_submissions').insert({ match_id: matchId, submitted_by: side === 'a' ? 'team_a' : 'team_b', games });
  if (ins.error) return fail('invalid_input', ins.error.message);

  if (decision.outcome === 'confirmed') {
    const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games });
    if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
    const persisted = await applyResultPlan(sb, { tournamentId: me.tournament.id, matchId, rows, plan, tournamentStatus: me.tournament.status });
    if (!persisted.ok) return fail(persisted.error, persisted.message);
  } else {
    // submitted or disputed: move the status, guarded on the status we read
    const upd = await sb.from('matches').update({ status: decision.outcome }).eq('id', matchId).eq('status', row.status).select('id');
    if (upd.error) return fail('invalid_input', upd.error.message);
    if ((upd.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');
  }
  revalidateTournament(slug);
  return ok({ outcome: decision.outcome });
}
```

- [ ] **Step 6: Admin confirm action**

Append to `apps/web/src/actions/matches.ts` (import `listSubmissions` and `applyResultPlan` already present):

```ts
/** Accept one team's submitted games as the result. */
export async function confirmSubmission(slug: string, matchId: string, submissionId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const [rows, subs] = await Promise.all([listMatches(ctx.sb, ctx.tournament.id), listSubmissions(ctx.sb, ctx.tournament.id)]);
  const sub = subs.find((s) => s.id === submissionId && s.match_id === matchId);
  if (!sub) return fail('invalid_input', 'Submission not found');
  const plan = planResult({ settings: settingsFromTournament(ctx.tournament), matches: rows.map(rowToMatch), matchId, games: sub.games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}
```

- [ ] **Step 7: Display components**

`apps/web/src/components/MatchCard.tsx`: add prop `pending?: { games: Game[]; by: string }`. When `pending` is set and the match is not `done`, render the pending games in the score column (instead of empty) and, under the header line, a badge:

```tsx
      {pending && match.status !== 'done' && (
        <div className="mb-1 inline-block rounded bg-amber-100 px-1 text-[10px] uppercase tracking-wide text-amber-800">
          unconfirmed · {pending.by}
        </div>
      )}
```

Implement by computing `const shown = games.length ? games : pending?.games ?? [];` and using `shown` in `line(...)`.

`apps/web/src/components/Bracket.tsx`: inside the box, after the live line, add

```tsx
                  {(m.status === 'submitted' || m.status === 'disputed') && <div className="px-2 py-0.5 text-[10px] uppercase text-amber-700">{m.status === 'disputed' ? 'disputed' : 'unconfirmed'}</div>}
```

`apps/web/src/components/SubmissionCompare.tsx` (server component used by the admin queue):

```tsx
import type { Game } from '@tournament/core';
import type { SubmissionRow } from '@/lib/db/types';

function fmt(games: Game[]) { return games.map((g) => `${g.scoreA}-${g.scoreB}`).join(', '); }

export function SubmissionCompare({ a, b, teamA, teamB, onConfirm }: {
  a?: SubmissionRow; b?: SubmissionRow; teamA: string; teamB: string;
  /** Renders a confirm form for the given submission id. */
  onConfirm: (submissionId: string) => React.ReactNode;
}) {
  const cell = (label: string, s?: SubmissionRow) => (
    <div className="rounded border p-2">
      <div className="text-xs text-slate-500">{label} says</div>
      {s ? <><div className="font-mono text-sm">{fmt(s.games)}</div><div className="mt-1">{onConfirm(s.id)}</div></> : <div className="text-xs text-slate-400">no submission</div>}
    </div>
  );
  return <div className="grid grid-cols-2 gap-2">{cell(teamA, a)}{cell(teamB, b)}</div>;
}
```

- [ ] **Step 8: Wire pages**

Public pages (`app/t/[slug]/page.tsx`, `pools/page.tsx`, `bracket/page.tsx`): the bundle now includes `submissions`; compute `const latest = latestByMatch(bundle.submissions);` and a helper

```ts
const pendingFor = (m: Match) => {
  const l = latest[m.id]; const s = l?.a ?? l?.b; if (!s) return undefined;
  const by = s.submitted_by === 'team_a' ? teamName(teams, m.teamAId) : teamName(teams, m.teamBId);
  return { games: s.games, by };
};
```

and pass `pending={pendingFor(m)}` to every `MatchCard`. (Import `teamName` from `MatchCard`.)

`app/t/[slug]/team/page.tsx`: load `listGames` and `listSubmissions` too; render real games in the cards; under "Your next match", when `next` exists and its status is `ready`, `live`, `submitted` or `disputed`, render

```tsx
        <ScoreForm matchId={next.id} settings={settings} existing={(latest[next.id]?.[mySide] ?? { games: [] }).games} teamA={teamName(teams, next.teamAId)} teamB={teamName(teams, next.teamBId)} action={submit} submitLabel="Submit scores" />
        <p className="text-xs text-slate-500">Your scores show as unconfirmed until the other team submits the same result or an organiser confirms them.</p>
```

with `mySide = next.teamAId === me.team.id ? 'a' : 'b'` and the inline action

```tsx
  async function submit(formData: FormData) {
    'use server';
    const r = await submitScores(slug, String(formData.get('matchId')), formData);
    redirectWithMsg(`/t/${slug}/team`, r, r.ok ? (r.data.outcome === 'confirmed' ? 'Result confirmed' : r.data.outcome === 'disputed' ? 'Scores differ from the other team; an organiser will resolve it' : 'Scores submitted, waiting for the other team') : '');
  }
```

`settings` comes from `settingsFromTournament(me.tournament)`. Also show the opponent's pending submission via `pending={pendingFor(next)}` on that card.

Admin `app/admin/[slug]/matches/page.tsx`: load `listSubmissions`, compute `latest`, and above the filter nav render a **Needs attention** section listing matches whose status is `submitted` or `disputed`:

```tsx
      {attention.length > 0 && (
        <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="font-semibold">Needs attention ({attention.length})</h2>
          {attention.map((m) => (
            <MatchCard key={m.id} match={m} teams={teams} games={[]} label={`${label(m)} · ${m.status}`}>
              <SubmissionCompare a={latest[m.id]?.a} b={latest[m.id]?.b} teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)}
                onConfirm={(id) => (
                  <form action={confirm}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="submissionId" value={id} /><button className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">Confirm this</button></form>
                )} />
              <p className="mt-2 text-xs text-slate-600">Or enter the result yourself below in the list.</p>
            </MatchCard>
          ))}
        </section>
      )}
```

with `const attention = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');` and

```tsx
  async function confirm(formData: FormData) {
    'use server';
    redirectWithMsg(here, await confirmSubmission(slug, String(formData.get('matchId')), String(formData.get('submissionId'))), 'Result confirmed');
  }
```

The `open` filter already includes `submitted`/`disputed` matches (they are neither done nor pending), so the manual `ScoreForm` remains available for them.

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
git add -A
git commit -m "feat(web): participant score submissions with opponent confirmation, disputes and admin queue" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Announcements

**Files:**
- Create: `apps/web/src/actions/announcements.ts`, `apps/web/src/components/AnnouncementList.tsx`
- Create: `apps/web/src/app/admin/[slug]/announcements/page.tsx`, `apps/web/src/app/t/[slug]/announcements/page.tsx`
- Modify: `apps/web/src/lib/db/queries.ts`, `apps/web/src/app/admin/[slug]/layout.tsx`, `apps/web/src/app/t/[slug]/page.tsx`

**Interfaces:**
- Produces: `listAnnouncements(sb, tournamentId): Promise<AnnouncementRow[]>` (pinned first, then newest first); `TournamentBundle` gains `announcements`; actions `postAnnouncement(slug, formData)`, `togglePinned(slug, id)`, `deleteAnnouncement(slug, id)`; `<AnnouncementList items admin? />`.

- [ ] **Step 1: Query and actions**

Append to `queries.ts` (import `AnnouncementRow`):

```ts
export async function listAnnouncements(sb: SupabaseClient, tournamentId: string): Promise<AnnouncementRow[]> {
  return must(
    await sb.from('announcements').select('*').eq('tournament_id', tournamentId)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    'announcements',
  ) as AnnouncementRow[];
}
```

Add `announcements: AnnouncementRow[]` to `TournamentBundle` and load it in `loadTournamentBundle`.

`apps/web/src/actions/announcements.ts`:

```ts
'use server';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';

export async function postAnnouncement(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const body = String(formData.get('body') ?? '').trim();
  if (body.length < 1 || body.length > 1000) return fail('invalid_input', 'Announcement must be 1-1000 characters');
  const pinned = formData.get('pinned') !== null;
  const ins = await ctx.sb.from('announcements').insert({ tournament_id: ctx.tournament.id, body, pinned });
  if (ins.error) return fail('invalid_input', ins.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

export async function togglePinned(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const cur = await ctx.sb.from('announcements').select('pinned').eq('id', id).eq('tournament_id', ctx.tournament.id).maybeSingle();
  if (cur.error || !cur.data) return fail('invalid_input', 'Announcement not found');
  const upd = await ctx.sb.from('announcements').update({ pinned: !cur.data.pinned }).eq('id', id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

export async function deleteAnnouncement(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const del = await ctx.sb.from('announcements').delete().eq('id', id).eq('tournament_id', ctx.tournament.id);
  if (del.error) return fail('invalid_input', del.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}
```

- [ ] **Step 2: Component and pages**

`apps/web/src/components/AnnouncementList.tsx`:

```tsx
import type { AnnouncementRow } from '@/lib/db/types';

export function AnnouncementList({ items, actions }: {
  items: AnnouncementRow[];
  /** Admin-only controls rendered per item. */
  actions?: (a: AnnouncementRow) => React.ReactNode;
}) {
  if (items.length === 0) return <p className="text-sm text-slate-500">No announcements yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className={`rounded border bg-white p-3 text-sm ${a.pinned ? 'border-amber-400' : ''}`}>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{a.pinned ? 'Pinned · ' : ''}{new Date(a.created_at).toLocaleString()}</span>
            {actions?.(a)}
          </div>
          <p className="whitespace-pre-wrap">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/src/app/admin/[slug]/announcements/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { deleteAnnouncement, postAnnouncement, togglePinned } from '@/actions/announcements';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listAnnouncements } from '@/lib/db/queries';
import { AnnouncementList } from '@/components/AnnouncementList';
import { ConfirmButton } from '@/components/ConfirmButton';

export default async function AnnouncementsAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const items = await listAnnouncements(ctx.sb, ctx.tournament.id);
  const here = `/admin/${slug}/announcements`;

  async function post(formData: FormData) { 'use server'; redirectWithMsg(here, await postAnnouncement(slug, formData), 'Posted'); }
  async function pin(formData: FormData) { 'use server'; redirectWithMsg(here, await togglePinned(slug, String(formData.get('id'))), 'Updated'); }
  async function remove(formData: FormData) { 'use server'; redirectWithMsg(here, await deleteAnnouncement(slug, String(formData.get('id'))), 'Deleted'); }

  return (
    <div className="space-y-4">
      {msg && <p className="rounded bg-slate-100 p-2 text-sm">{msg}</p>}
      <form action={post} className="space-y-2 rounded border bg-white p-4 text-sm">
        <label className="block">New announcement
          <textarea name="body" rows={3} maxLength={1000} required className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" name="pinned" /> Pin to the top of the live page</label>
        <button className="rounded bg-slate-900 px-4 py-2 text-white">Post</button>
      </form>
      <AnnouncementList items={items} actions={(a) => (
        <span className="flex gap-2">
          <form action={pin}><input type="hidden" name="id" value={a.id} /><button className="underline">{a.pinned ? 'Unpin' : 'Pin'}</button></form>
          <form action={remove}><input type="hidden" name="id" value={a.id} /><ConfirmButton message="Delete this announcement?" className="text-red-700 underline">Delete</ConfirmButton></form>
        </span>
      )} />
    </div>
  );
}
```

`apps/web/src/app/t/[slug]/announcements/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug, listAnnouncements } from '@/lib/db/queries';
import { AnnouncementList } from '@/components/AnnouncementList';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  return <AnnouncementList items={await listAnnouncements(sb, t.id)} />;
}
```

Admin layout: add `['/announcements', 'Announcements']` to `tabs`. Live page (`app/t/[slug]/page.tsx`): at the top of the returned tree render the pinned banner:

```tsx
      {bundle.announcements.filter((a) => a.pinned).map((a) => (
        <div key={a.id} className="rounded border border-amber-400 bg-amber-50 p-3 text-sm whitespace-pre-wrap">{a.body}</div>
      ))}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck -w @tournament/web
npm test -w @tournament/web
npm run build -w @tournament/web
git add -A
git commit -m "feat(web): announcements for admins and the public live page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Realtime refresh on public pages

**Files:**
- Create: `apps/web/src/lib/supabase/browser.ts`, `apps/web/src/components/RealtimeRefresh.tsx`
- Modify: `apps/web/src/app/t/[slug]/layout.tsx`

**Interfaces:**
- Produces: `createBrowserSupabase()`; `<RealtimeRefresh tournamentId />` client component that subscribes to `postgres_changes` on `matches` (filter `tournament_id=eq.<id>`), `tournaments` (`id=eq.<id>`), `announcements` (`tournament_id=eq.<id>`), and unfiltered `games` and `score_submissions` (they have no `tournament_id`), debounces 300 ms, calls `router.refresh()`, and renders a tiny status pill: "live" when subscribed, "reconnecting" otherwise. `data-testid="realtime-status"`.

- [ ] **Step 1: Browser client**

`apps/web/src/lib/supabase/browser.ts`:

```ts
'use client';
import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
```

- [ ] **Step 2: The refresh component**

`apps/web/src/components/RealtimeRefresh.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/browser';

export function RealtimeRefresh({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = createBrowserSupabase();
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const channel = sb
      .channel(`t:${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'score_submissions' }, bump)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') { setStatus('live'); bump(); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('reconnecting');
      });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      sb.removeChannel(channel);
    };
  }, [tournamentId, router]);

  return (
    <span data-testid="realtime-status" className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${status === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
      {status === 'live' ? 'live' : status === 'connecting' ? 'connecting' : 'reconnecting'}
    </span>
  );
}
```

Note: `games` and `score_submissions` events fire for every tournament on the instance; a refresh is cheap and this is acceptable for v1 (documented in README).

- [ ] **Step 3: Mount in the public layout**

In `app/t/[slug]/layout.tsx` import `RealtimeRefresh` and render it in the header next to the status line:

```tsx
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <span>{...existing status label...}</span>
          <RealtimeRefresh tournamentId={t.id} />
        </p>
```

- [ ] **Step 4: Verify (build + a realtime smoke) and commit**

```bash
npm run typecheck -w @tournament/web
npm run build -w @tournament/web
```

Realtime smoke, scripted: start the dev server on 3100; open `http://localhost:3100/t/<slug>` in Playwright's headless browser (a throwaway script in the scratchpad or a `test.only` you do not commit), wait for `[data-testid="realtime-status"]` to read `live`, post an announcement with the service-role client (`insert into announcements` for that tournament, `pinned: true`), and assert the banner text appears within 5 seconds without a manual reload. Record the result in the report. Then:

```bash
git add -A
git commit -m "feat(web): realtime refresh of public pages" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Participant end-to-end test, docs and spec alignment

**Files:**
- Create: `apps/web/e2e/participant.spec.ts`
- Modify: `apps/web/README.md`, `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md` (section 2 and 7 participant wording)

**Interfaces:**
- Produces: a Playwright spec that covers spec 9's requirement of at least one player-submitted and one disputed match, plus profile editing, the announcement banner and the realtime status pill.

- [ ] **Step 1: Write the spec**

`apps/web/e2e/participant.spec.ts`:

```ts
import { test, expect, type Page, type Browser } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `p2p-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal'];

async function fillScores(page: Page, a: [number, number], b: [number, number]) {
  const form = page.getByTestId('score-form').first();
  await form.locator('input[name="game1a"]').fill(String(a[0]));
  await form.locator('input[name="game1b"]').fill(String(a[1]));
  await form.locator('input[name="game2a"]').fill(String(b[0]));
  await form.locator('input[name="game2b"]').fill(String(b[1]));
  await form.getByRole('button', { name: 'Submit scores' }).click();
}

/** Opens a team's private link in a fresh browser context and returns the page on /t/[slug]/team. */
async function openAsTeam(browser: Browser, link: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/team$`));
  return page;
}

test('participants submit, confirm and dispute scores; admins resolve and announce', async ({ page, browser }) => {
  page.on('dialog', (d) => d.accept());

  // admin: sign in, create, add 4 teams, one pool, lock
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.fill('input[name="name"]', 'Participant Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.fill('textarea[name="lines"]', teams.join('\n'));
  await page.getByRole('button', { name: 'Add teams' }).click();
  await expect(page.getByText('Added 4 team(s)')).toBeVisible();

  // collect the private links from the Setup page (each row: team name + <code>link</code>)
  const links: Record<string, string> = {};
  for (const name of teams) {
    const code = page.locator('tr', { hasText: name }).locator('code').first();
    links[name] = (await code.textContent())!.trim();
    expect(links[name]).toMatch(new RegExp(`/t/${slug}/team/[A-Za-z0-9_-]{24}$`));
  }

  await page.goto(`/admin/${slug}/pools`);
  await page.fill('input[name="poolCount"]', '1');
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();

  // admin posts a pinned announcement
  await page.goto(`/admin/${slug}/announcements`);
  await page.fill('textarea[name="body"]', 'Courts open at 7pm. Bring your own shuttles.');
  await page.check('input[name="pinned"]');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Posted')).toBeVisible();

  // public live page shows the banner and the realtime pill
  await page.goto(`/t/${slug}`);
  await expect(page.getByText('Courts open at 7pm')).toBeVisible();
  await expect(page.getByTestId('realtime-status')).toHaveText(/live/, { timeout: 15000 });

  // invalid token is rejected and the link is rate limited
  const badRes = await page.request.get(`/t/${slug}/team/000000000000000000000000`);
  expect(badRes.status()).toBe(404);

  // team Ann & Bo opens its link, renames itself
  const ann = await openAsTeam(browser, links['Ann & Bo']!);
  await ann.fill('input[name="name"]', 'The Smashers');
  await ann.getByRole('button', { name: 'Save team' }).click();
  await expect(ann.getByText('Team updated')).toBeVisible();
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText('The Smashers')).toBeVisible();

  // find Ann's next opponent from the "Your next match" card and open that team's link
  const nextCard = ann.locator('section', { hasText: 'Your next match' }).locator('div.rounded').first();
  const cardText = (await nextCard.textContent()) ?? '';
  const opponentName = teams.find((n) => n !== 'Ann & Bo' && cardText.includes(n))!;
  const opp = await openAsTeam(browser, links[opponentName]!);

  // Ann submits 15-7, 15-9; opponent submits the same -> confirmed (done)
  await fillScores(ann, [15, 7], [15, 9]);
  await expect(ann.getByText('Scores submitted, waiting for the other team')).toBeVisible();
  // the opponent's team page shows Ann's scores tagged unconfirmed (a submitted match is not
  // "live" or "up next", so it does not appear on the public Live page until it is done)
  await opp.goto(`/t/${slug}/team`);
  await expect(opp.getByText(/unconfirmed/i).first()).toBeVisible();
  await fillScores(opp, [15, 7], [15, 9]);
  await expect(opp.getByText('Result confirmed')).toBeVisible();

  // second match: Ann's new next opponent submits different scores -> disputed
  await ann.goto(`/t/${slug}/team`);
  const nextCard2 = ann.locator('section', { hasText: 'Your next match' }).locator('div.rounded').first();
  const cardText2 = (await nextCard2.textContent()) ?? '';
  const opponent2 = teams.find((n) => n !== 'Ann & Bo' && n !== opponentName && cardText2.includes(n))!;
  const opp2 = await openAsTeam(browser, links[opponent2]!);
  await fillScores(ann, [15, 3], [15, 4]);
  await expect(ann.getByText('Scores submitted, waiting for the other team')).toBeVisible();
  await fillScores(opp2, [15, 3], [15, 5]);
  await expect(opp2.getByText(/Scores differ from the other team/)).toBeVisible();

  // admin sees it in Needs attention and confirms Ann's version
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await expect(page.getByText('Needs attention (1)')).toBeVisible();
  const annCell = page.locator('div.rounded.border', { hasText: 'The Smashers says' });
  await annCell.getByRole('button', { name: 'Confirm this' }).click();
  await expect(page.getByText('Result confirmed')).toBeVisible();
  await expect(page.getByText(/Needs attention/)).toHaveCount(0);

  // public pools page shows two played matches for Ann's team
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText(/2\/6 played/)).toBeVisible();
});
```

Notes for the implementer: the "Your next match" card wraps a `MatchCard` whose outer div has class `rounded border bg-white ...`; if the `div.rounded` locator picks a wrong element, add `data-testid="next-match"` to that card's wrapper in `team/page.tsx` and use it. Team rows on Setup: `TeamsAdmin` renders one `<tr>` per team with the link in a `<code>`.

- [ ] **Step 2: Run both specs**

```bash
npx kill-port 3100
npm run e2e -w @tournament/web
```

Expected: `2 passed`.

- [ ] **Step 3: Docs**

`apps/web/README.md`: add a "Participants" section: private link format `/t/<slug>/team/<token>` sets a cookie and redirects to `/t/<slug>/team`; what participants can do; token-link visits limited to 30 per minute per IP in memory (single instance); realtime refresh via Supabase channels (games and score_submissions events are unfiltered by tournament, acceptable for v1). Add `npm run e2e` now runs two specs.

Spec `docs/superpowers/specs/2026-09-05-badminton-tournament-design.md`: in section 2, after the participant row, add: "Opening the private link sets an httpOnly cookie scoped to the tournament and redirects to `/t/[slug]/team`; the token itself is never stored in the browser URL after that." In section 7 Participant, replace `/t/[slug]/team/[token]` with `/t/[slug]/team` (after the handshake) and note the "My team" tab appears in the public layout when the cookie is present.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(web): participant e2e (submit, confirm, dispute, announce); docs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for this plan

- `npm test -w @tournament/web` passes (unit + integration), `npm run typecheck -w @tournament/web` and `npm run build -w @tournament/web` pass.
- `npm run e2e -w @tournament/web` passes both specs against the local stack.
- A participant with a valid link can rename their team and submit scores; a matching opponent submission completes the match without admin involvement; a mismatch shows in the admin "Needs attention" queue and is resolvable by confirming a submission or entering a result.
- Unconfirmed scores appear tagged on the public live, pools and bracket views; the bracket never advances on an unconfirmed result.
- Announcements post, pin and delete; pinned ones show on the live page.
- Public pages refresh within a second or two of a change without a reload, and show "reconnecting" when the channel drops.
- No path lets a participant edit a team or submit for a match that is not theirs; the token is never exposed to anonymous clients; token links are rate limited.

