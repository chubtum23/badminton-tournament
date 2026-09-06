# @tournament/web

Next.js app for running and following a tournament. Rules come from `@tournament/core`.

## Local development

1. Start Docker Desktop, then from the repo root: `npx supabase start` and `npx supabase db reset`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and paste the values from `npx supabase status`.
3. `npm run seed:admin -w @tournament/web` creates `admin@local.test` / `local-admin-pass`.
4. `npm run dev -w @tournament/web`, sign in at `/login`, create a tournament at `/admin`.

## Tests

- `npm test -w @tournament/web`: unit tests, plus RLS integration tests when `.env.local` exists.
- `npm run e2e -w @tournament/web`: Playwright drives an 8-team tournament through the admin UI on port 3100.

## Routes

Public: `/t/[slug]` (live board), `/t/[slug]/pools`, `/t/[slug]/bracket`.
Admin: `/login`, `/admin`, `/admin/[slug]` (setup), `/admin/[slug]/pools`, `/admin/[slug]/matches`, `/admin/[slug]/bracket`.

## Deploying

Create a hosted Supabase project, run `npx supabase db push` against it, set the three env vars on Vercel, deploy `apps/web` with root directory `apps/web` and build command `npm run build`. Not automated in this repo.
