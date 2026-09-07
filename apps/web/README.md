# @tournament/web

Next.js app for running and following a tournament. Rules come from `@tournament/core`.

## Local development

1. Start Docker Desktop, then from the repo root: `npx supabase start` and `npx supabase db reset`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and paste the values from `npx supabase status`.
3. `npm run seed:admin -w @tournament/web` creates `admin@local.test` / `local-admin-pass`.
4. `npm run dev -w @tournament/web`, sign in at `/login`, create a tournament at `/admin`.

## Participants

Each team gets a private link, `/t/<slug>/team/<token>`, shown (and regeneratable) next
to the team on the admin Setup page. Opening it sets an httpOnly cookie scoped to the
tournament and redirects to `/t/<slug>/team`, so the token itself never sits in the
browser URL after the first visit. From there a participant can rename their team, set
a tagline and colour, and submit game scores for their own current match; a matching
opponent submission confirms the result automatically, a mismatch is flagged
"unconfirmed" until an admin resolves it. Every resolution of a team token — the one-time
link and each later request that presents the cookie — is rate limited to 30 per minute
per client (in-memory, so this only holds on a single server instance). Only *failed*
lookups spend that budget: guessing a token is a stream of misses, while a team holding a
valid link re-resolves its cookie on every render and realtime pushes several a minute.
The client is
identified from `x-real-ip` when a trusted proxy sets it (Vercel does), otherwise from
the LAST entry of `x-forwarded-for`, which is the only entry a client cannot forge.
Public pages, including the participant's, refresh via a Supabase realtime channel per
tournament; the `games` and `score_submissions` subscriptions are unfiltered by
tournament, which is acceptable for v1 since they only trigger a refetch. Team profile
edits are deliberately not pushed live: `teams` is outside the realtime publication, so
a renamed team appears on other people's screens at their next refresh.

## Tests

- `npm test -w @tournament/web`: unit tests, plus RLS integration tests when `.env.local` exists.
- `npm run e2e -w @tournament/web`: Playwright runs two specs against port 3100 — an
  8-team tournament through the admin UI, and a participant flow covering private
  links, profile edits, a player-submitted match, a disputed match resolved by an
  admin, and announcements.

## Routes

Public: `/t/[slug]` (live board), `/t/[slug]/pools`, `/t/[slug]/bracket`.
Participant: `/t/[slug]/team/[token]` (one-time link), `/t/[slug]/team` (after the cookie is set).
Admin: `/login`, `/admin`, `/admin/[slug]` (setup), `/admin/[slug]/pools`, `/admin/[slug]/matches`, `/admin/[slug]/bracket`, `/admin/[slug]/announcements`.

## Deploying

Create a hosted Supabase project, run `npx supabase db push` against it, set the three env vars on Vercel, deploy `apps/web` with root directory `apps/web` and build command `npm run build`. Not automated in this repo.
