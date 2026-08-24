# tracker

A Linear-inspired issue tracker built on [`@implementjs/kit`](https://implementjs.dev/kit),
as a test of how far implement goes for a real application.

Sessions and API keys via [better-auth](https://better-auth.com), SQLite over
[libSQL](https://github.com/tursodatabase/libsql) with
[Drizzle](https://orm.drizzle.team), and a REST API that generates its own
OpenAPI 3.1 document.

**Findings from the build:** [MISSING.md](MISSING.md) ·
[PAPERCUTS.md](PAPERCUTS.md) · [BUGS.md](BUGS.md)

## Running it

```sh
pnpm install
cp .env.example .env      # the defaults work for local development
pnpm db:migrate           # create local.db
pnpm db:seed              # demo workspace, three people, nine issues
pnpm dev
```

Then sign in at http://localhost:5173 as **demo@tracker.dev** / **password123**.

| Script            | What it does                                                         |
| ----------------- | -------------------------------------------------------------------- |
| `dev`             | Dev server, server-rendered, HMR                                     |
| `build`           | Production build (writes `.vercel/output` and `static/openapi.json`) |
| `preview`         | Serve the build locally                                              |
| `check`           | Sync generated types, then typecheck                                 |
| `lint` / `format` | oxlint / oxfmt                                                       |
| `db:generate`     | Generate a migration from the schema                                 |
| `db:migrate`      | Apply migrations                                                     |
| `db:seed`         | Seed the demo workspace (idempotent)                                 |

## What it does

- **Auth** — email + password sessions. Everything under `/app` is behind a
  session, enforced once in `src/hooks.server.ts`.
- **Workspaces** — create them, add members by email or with a shareable invite
  link, manage labels. Issues are numbered per workspace (`ENG-42`).
- **Issues** — status, priority, assignee, labels, description, comments.
  Status and priority are edited inline from the list; title and description are
  click-to-edit on the issue.
- **Inbox** — assignment, reassignment, status changes and comments land in the
  assignee's and reporter's inbox. You are never notified of your own actions.
- **Keyboard** — `⌘K` command palette, `c` to compose an issue, `/` to search,
  `⌘↵` to submit a composer or a comment, `Esc` to dismiss.
- **REST API** — everything the UI does, under `/api/v1`, authenticated with a
  session cookie _or_ an API key.

## The API

Create a key in the app under **Settings → API keys**, then:

```sh
curl -H "Authorization: Bearer trk_…" \
  https://localhost:5173/api/v1/workspaces/engineering/issues
```

`x-api-key: trk_…` works too. The full description is at
[`/openapi.json`](http://localhost:5173/openapi.json), generated from the route
definitions on build.

API keys are deliberately **not** sessions. They authenticate `/api/v1` only:
they cannot reach better-auth's account endpoints, and they cannot mint more
keys — that needs a signed-in session. See `src/lib/server/api-key.server.ts`
for why.

## Layout

```
src/
├ hooks.server.ts        session-or-API-key on every request, /app guard
├ lib/
│  ├ domain/             schemas and constants shared by client and server
│  ├ server/             *.server.ts — db, auth, guards, queries. Never bundled.
│  ├ features/           screens: issues, inbox, settings, workspaces, shell
│  ├ components/ui/      @implementjs/ui components, restyled
│  └ client/             browser-side api, auth and toasts
└ routes/
   ├ api/auth/[...all]/  better-auth's own surface
   ├ api/v1/             the documented REST API
   ├ app/[slug]/         the product, behind a session
   ├ login, signup, invite/[token]
   └ layout.ts, page.ts, error.ts
```

Data flows in through `page.server.ts` / `layout.server.ts` loads and out
through `/api/v1`. The UI dogfoods its own API — there is no second write path.

## Deploying

Built for Vercel (`@implementjs/adapter-vercel`); `vite build` writes
`.vercel/output`, so `vercel deploy --prebuilt` is the whole deploy. Point
`DATABASE_URL` at a Turso database (`libsql://…`) with `DATABASE_AUTH_TOKEN`,
and set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.

Note that `src/lib/env.server.ts` values are baked in at build time, so rotating
a secret means rebuilding — see MISSING.md #8.
