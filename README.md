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
pnpm dev:setup            # walks through .env, then offers to migrate and seed
pnpm dev
```

`dev:setup` prompts for each value, validates answers against the same schemas
the app enforces at build time, generates an auth secret, and can run the
migrations and seed for you. Add `--yes` to take every default without prompts.
Prefer doing it by hand? `cp .env.example .env`, then `pnpm db:migrate && pnpm db:seed`.

Then sign in at http://localhost:5173 as **demo@tracker.dev** / **password123**.

Everything under `/app` needs a workspace; anyone without one is sent to
`/workspaces/new`, which renders on its own so there is never a sidebar linking
at a workspace that does not exist.

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
- **Workspaces and teams** — a workspace is the container: people, labels and
  teams. **Teams own issues**, and a team's key is the issue prefix, so the same
  workspace has `ENG-42` and `PRD-7` numbering independently. Every new
  workspace starts with Engineering (`ENG`) and Product (`PRD`); add more in
  Settings. Members join by email or through a shareable invite link.
- **Issues** — status, priority, assignee, labels, description, comments.
  Moving an issue between teams reallocates its number, so `ENG-42` becomes
  `PRD-8` and the URL follows.
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
# every issue in the workspace, across teams
curl -H "Authorization: Bearer trk_…" \
  http://localhost:5173/api/v1/workspaces/acme/issues

# one team's issues
curl -H "Authorization: Bearer trk_…" \
  "http://localhost:5173/api/v1/workspaces/acme/issues?team=ENG"

# one issue, by the identifier you would say out loud
curl -H "Authorization: Bearer trk_…" \
  http://localhost:5173/api/v1/workspaces/acme/issues/ENG-1
```

`x-api-key: trk_…` works too. The full description is at
[`/openapi.json`](http://localhost:5173/openapi.json), generated from the route
definitions on build.

API keys are deliberately **not** sessions. They authenticate `/api/v1` only:
they cannot reach better-auth's account endpoints, and they cannot mint more
keys — that needs a signed-in session. See `src/lib/server/api-key.server.ts`
for why.

## Webhooks

Add one under **Settings → Webhooks**, choose the events, and the signing secret
is shown once. Events: `issue.created`, `issue.updated`, `issue.assigned`,
`issue.status_changed`, `issue.deleted`, `comment.created`.

Every request is a JSON POST carrying:

```
x-tracker-event      issue.created
x-tracker-delivery   the delivery id — use it as an idempotency key
x-tracker-timestamp  when it was sent
x-tracker-signature  sha256=<HMAC-SHA256 of the raw body, with your secret>
```

Verify before trusting the body — over the raw bytes, not a re-serialised object:

```js
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const ok =
	expected.length === signature.length &&
	crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

The payload is `{ id, event, createdAt, workspace, actor, data }`. `data.issue`
is the full issue; `issue.updated` also carries `data.changes` as
`{ field: { from, to } }`.

**Delivery is at-least-once.** Deliveries are written to the database before
anything is sent, attempted immediately, and retried on a backoff
(1m → 5m → 30m → 2h, five attempts) by `POST /api/v1/webhooks/drain`. That route
is authorised by `CRON_SECRET` and 404s when it is unset. `pnpm build`
registers it as a Vercel cron automatically; on any other host, schedule it
yourself. Deduplicate on the delivery id.

URLs resolving to loopback, private, link-local or carrier-NAT addresses are
refused — a webhook URL is user-supplied, and without that check the endpoint is
a server-side request forgery primitive. Loopback is allowed outside production
so you can point one at a local listener while developing.

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
   │  └ webhooks/drain/  cron-authorised delivery retries
   ├ app/[slug]/         the product, behind a session
   │  ├ team/[key]/      one team's issues
   │  └ issue/[identifier]/   ENG-42
   ├ workspaces/new      onboarding — no workspace, no shell
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

Set `CRON_SECRET` too, or webhook retries stay off.

Note that `src/lib/env.server.ts` values are baked in at build time, so rotating
a secret means rebuilding — see MISSING.md #9.
