# Putting the tournament app on a live site

Three services, all free to start: **GitHub** holds the code, **Supabase** holds the database
and logins, **Vercel** serves the site. Follow the steps in order; the whole thing takes about
half an hour the first time.

You only do steps 2 to 6 once. After that, `git push` is all it takes to update the live site.

---

## 1. Code on GitHub

Already done if the repo has a remote:

```bash
git remote -v
```

If it prints nothing, create a private repo and push:

```bash
gh repo create badminton-tournament --private --source=. --push
```

Nothing secret is committed: `apps/web/.env.local` is git-ignored, and only `.env.example`
(which holds placeholders) is tracked.

---

## 2. Create the Supabase project

1. Sign in at <https://supabase.com> and choose **New project**.
2. Pick the region closest to your players (Sydney for Australia). Latency comes from this
   choice more than anything else.
3. Set a database password and **save it somewhere** — you need it in the next step and it is
   not shown again.
4. Wait for the project to finish provisioning.

Your **project ref** is the random string in the dashboard URL
(`https://supabase.com/dashboard/project/<ref>`), also shown under Settings → General.

---

## 3. Push the database schema

From the repo root on your machine:

```bash
npx supabase login          # opens a browser once
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

`db push` applies `supabase/migrations/` to the hosted database: every table, all the
row-level security policies, the security-definer functions and the realtime publication.
Expect it to report one migration applied.

Confirm in the dashboard under **Table Editor** that `tournaments`, `teams`, `matches` and the
rest exist.

---

## 4. Create your admin login, then close sign-ups

In the Supabase dashboard:

1. **Authentication → Users → Add user**. Enter your email and a password and tick
   **Auto Confirm User**, so you do not need email delivery configured.
2. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".

Step 2 matters. Without it anyone on the internet can register on your project and create
their own tournaments in your database. They still cannot touch yours (that is enforced in the
database), but it is your quota and your data. Players never need an account: they use the
private team links instead.

To add another organiser later, add them under Authentication → Users the same way.

---

## 5. Copy the three keys

**Settings → API** gives you:

| Value | Environment variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

The `service_role` key bypasses every security rule. It must never go in a variable whose name
starts with `NEXT_PUBLIC_`, because those are sent to the browser. The app uses it only on the
server, to resolve a team's private link.

---

## 6. Deploy on Vercel

1. Sign in at <https://vercel.com> with GitHub and choose **Add New → Project**.
2. Import the `badminton-tournament` repo.
3. Leave **Root Directory** at the repository root. The committed `vercel.json` tells Vercel to
   install the whole workspace and build `apps/web`.
4. Add the three environment variables from step 5, ticking Production, Preview and Development
   for each.
   Optional but recommended: also add `NEXT_PUBLIC_SITE_URL` set to your deployment's address
   (for example `https://badminton-tournament.vercel.app`), so the private team links are always
   built from the real origin rather than from a forwarded host header.
5. **Deploy**.

You get an address like `badminton-tournament.vercel.app`. Open `/login`, sign in with the user
from step 4, and create a tournament.

Leave **Output Directory** in Project Settings unset. Vercel detects the Next.js app inside
`apps/web` and looks for `.next` there by itself. Setting it to `apps/web/.next` makes Vercel
apply the prefix twice and fail with `The Next.js output directory "apps/web/.next" was not
found at ".../apps/web/apps/web/.next"`, even though the build itself succeeded.

**If the build fails with `Cannot find module '@tournament/core'`:** set Root Directory to
`apps/web` in Project Settings → General instead, and turn on "Include source files outside of
the Root Directory". Redeploy.

### Your own domain (optional)

Vercel → Settings → Domains → Add. Vercel shows the DNS record to create at your registrar and
issues the HTTPS certificate itself.

---

## Running an event on it

- **Wake the database first.** Free Supabase projects pause after about a week with no
  traffic. Open the dashboard a day before and click restore if it is paused. A paused
  database makes the site look broken.
- Private team links are `https://<your-site>/t/<slug>/team/<token>`. The Setup page shows each
  team's link with a copy target; send each one to that team only.
- Everything updates live: entering a score changes every open phone within a second or two.
- **Take backups.** The tournament's home screen has a **Download a backup** button that saves
  every team, result and announcement as one file. Take one after sign-ups close, one before
  locking the pools and one before starting the knockout. A wiped result cannot be brought back
  any other way (the free Supabase plan has no downloadable backups).
- **Only one result saves at a time.** Two people saving at the same moment is safe: the second
  waits a moment. If a save waits more than a few seconds it says "Someone else is saving a
  result right now" — just press it again.
- **Pool results freeze when the knockout starts**, because the bracket is drawn from them.
  Double-check the pool tables before pressing Start knockout.

### The day before

1. Supabase dashboard: the project is awake, and **Authentication → Email → "Allow new users
   to sign up" is off** (step 4).
2. Vercel: `NEXT_PUBLIC_SITE_URL` is set (step 6), and the functions region shows **Sydney
   (syd1)** under Settings → Functions (`vercel.json` asks for it).
3. Sign in, open the tournament, and press **Download a backup** once to check it works.
4. Send each team its private link, and tell teams that if they lose it the organiser can copy
   it again from the Teams page.

---

## Updating the live site

Push to `master` and Vercel rebuilds automatically. Pull requests get their own preview URL, so
you can try a change before it reaches the public address.

**Database changes work differently now.** Until the first `db push`, the single migration file
was edited in place and re-applied with `npx supabase db reset`. Once it is live you must not
edit it, because the hosted database has already applied it. Instead:

```bash
npx supabase migration new <what_it_does>   # creates a new timestamped file
# write the ALTER / CREATE statements in that file
npx supabase db reset                       # verify locally
npx supabase db push                        # apply to the hosted database
```

---

## Known limits of the current build

- **Guess-rate limiting on team links is per server instance.** Vercel runs several, so the
  limit is looser in production than locally. The links are long random strings, so guessing
  one is not a practical attack, but this is why the limit exists rather than being the only
  defence.
- **Result saves are several database calls, not one transaction.** They are serialised by the
  result lock, so they cannot interleave with each other, but a network failure midway can leave
  a meeting half-saved. Saving the same score again repairs it.
- **Starting the knockout cannot be undone**, and if it fails midway (a network error while the
  bracket is being written) it needs a manual database fix. Take a backup first.
- **A tie for a place other than the qualification line is not always flagged** when more than
  two teams advance from each pool. With two advancing (the club format) this cannot happen.
