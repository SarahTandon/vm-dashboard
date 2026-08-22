# VMaaS Dashboard — Tech Stack

Three services. Nothing to run or maintain yourself.

| Tool | What it does |
|---|---|
| **Next.js** | The app — screens and server logic in one program. |
| **Supabase** | The Postgres database, plus login. Its row-level security is what stops one company seeing another's data — that rule lives in the database, not in our code. |
| **Vercel** | Hosts the Next.js app. Push to git, it deploys. |

Packages: `next`, `react`, `@supabase/supabase-js`, `@supabase/ssr`. That's the list.

## What Supabase already gives us

| Need | Handled by |
|---|---|
| Postgres database | Supabase |
| Login, passwords, sessions | Supabase Auth — no password hashing to write |
| Per-company data isolation | Postgres row-level security |
| Admin UI to browse/edit data | Supabase dashboard |
| Preview database per branch | Supabase branching |

Supabase Auth stores logins in its own `auth.users` table. We keep a matching `users` table for the things it doesn't know: which company someone belongs to, and whether they're an admin.

This still satisfies the PRD's "native authentication" — the accounts live in our own database. The deferred item was Auth0 and external identity providers, which we're not using.

## Built in — nothing to install

| Need | Use |
|---|---|
| Styling | One plain CSS file |
| Charts | Inline `<svg>` — a line graph is about 20 lines |
| Live updates | Refresh the data on a timer |
| Delayed VM state changes | Calculated when read, from a timestamp |
| Validation | Plain `if` checks, one file per action |

## Deliberately skipped

- **ORM (Drizzle, Prisma)** — the Supabase client covers normal queries; the security policies and totals are SQL either way.
- **Tailwind / component library** — a dashboard is tables and panels. Plain CSS covers it.
- **Chart library** — line graphs only. An `<svg>` is smaller than the library's config.
- **Redis / job queue** — nothing slow to wait on. There are no real machines.
- **Auth0** — deferred to v1.1 by the PRD.
