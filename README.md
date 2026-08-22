# tracker

A Linear-style issue tracker built on [implement](https://github.com/ieedan/implement) and
[`@implementjs/kit`](https://github.com/ieedan/implement/tree/main/packages/kit), where every
**workspace is a GitHub owner** — your account, or an organization you belong to. Issues can be
scoped to one of that owner's repos, or left unscoped and belong to the org itself.

```sh
bizi run dev
```

That is the whole thing: [bizi](https://getbizi.dev) brings up Postgres and MinIO, waits for them
to be healthy, runs migrations, then starts the dev server on <http://localhost:5173>.

## What it does

| | |
| --- | --- |
| **Auth** | GitHub OAuth through [better-auth](https://better-auth.com). Sessions for the browser, API keys for everything else. |
| **Workspaces** | One per GitHub user or organization. Membership is GitHub's answer, not a table here. |
| **Issues** | Repo-scoped or unscoped, with statuses, priorities, labels, assignees, and comments. |
| **Filters** | A submenu per dimension, chips for what you've narrowed, and the whole thing in the URL. |
| **Markdown** | In titles *and* bodies, authored in a rich editor and stored as markdown. |
| **Files** | Drag, paste, or pick — uploaded to object storage and inlined into the document. |
| **Realtime** | Every change streams to open tabs over SSE. |
| **Webhooks** | Signed outbound deliveries to URLs a workspace registers. |
| **API** | A versioned REST API described by [`/api/v1/openapi.json`](http://localhost:5173/api/v1/openapi.json) — the same API the app itself uses. |

## Getting started

You need Docker, Node 24+, and pnpm.

```sh
pnpm install
cp .env.example .env
bizi run dev
```

Then seed a workspace to look at:

```sh
bizi run seed
```

That creates the **Acme** workspace with two repos, eight issues across the default statuses, and a
`demo@tracker.local` account you can sign in with. It only works while `DEV_LOGIN=true`.

### Signing in with GitHub

The demo account exists so the app runs before you register anything. For the real thing, create a
[GitHub OAuth App](https://github.com/settings/developers):

- **Homepage URL** — `http://localhost:5173`
- **Authorization callback URL** — `http://localhost:5173/api/auth/callback/github`

Put the client id and secret in `.env` and restart. The app requests `read:user`, `user:email`,
`read:org`, and `repo`. **`read:org` is the one that matters** — without it GitHub reports no
organizations and you get no workspaces but your own.

## Tasks

`bizi run <task>` for any of these; `bizi` on its own opens the task UI.

| Task | What it does |
| --- | --- |
| `dev` | Infrastructure, then migrations, then the dev server |
| `seed` | Demo workspace and account (requires `dev` to be running) |
| `studio` | Drizzle Studio against the local database |
| `check` | Regenerate `.implement/`, then typecheck |
| `down` | Stop the containers, keeping their data |

The underlying package scripts (`pnpm db:migrate`, `pnpm db:generate`, `pnpm db:reset`, …) are all
still there if you'd rather call them directly.

## How it fits together

One kit app, served by `@implementjs/adapter-node`. Pages, loads, and the API are the same
codebase and the same request pipeline — there is no separate backend.

```
src/
├ routes/
│  ├ [workspace]/           the app shell: sidebar, command palette, event stream
│  │  ├ page.ts             the issue list, grouped and filtered
│  │  ├ issue/[identifier]/ one issue, its properties, and its comments
│  │  └ settings/           a full-page takeover with its own navigation
│  ├ api/
│  │  ├ auth/[...all]/      better-auth
│  │  ├ dev/seed/           demo data — compiled out of production builds
│  │  └ v1/                 the public API, and openapi.json
│  └ login/
└ lib/
   ├ api.ts                 the browser's client for /api/v1
   ├ ordering.ts            fractional indexing for manual issue order
   ├ components/            editor, issue row, palette, status/priority glyphs
   └ server/                *.server.ts — never reaches the browser
      ├ db/schema.server.ts drizzle schema, the source of truth for migrations
      ├ access.server.ts    who is asking, and what they may see
      ├ issues.server.ts    the issue service
      ├ markdown.server.ts  markdown → sanitized HTML
      └ webhooks.server.ts  signing and delivery
```

### Workspaces and membership

There is no members table. On sign-in the app asks GitHub which owners you belong to, mirrors them
into `workspace` rows, and caches the answer for five minutes. A workspace you are not a member of
answers **404, not 403** — a private organization's existence is itself something not to leak.

The cache is also why a repo created on GitHub takes up to five minutes to appear here.

### Issue identifiers

Repo-scoped issues count under the repo name (`api-12`); unscoped ones count under the workspace
prefix (`ACME-3`). Numbers come from an atomic upsert on a per-prefix counter, so two simultaneous
creates can never collide.

**An identifier never changes.** Move an issue to another repo and it keeps the one it was born
with, because links to it are already out in the world.

### The interface

The issue list follows Linear's shape: the view's name on the left of the
header, the controls that change the view on the right as icons, and a second
row that only exists once you have narrowed something.

- **Filter** opens one menu with a submenu per dimension.
- **Display** chooses the grouping (status, priority, assignee, repo, or none)
  and the ordering (manual, priority, last updated, created, title). Grouping
  and ordering rearrange what is already loaded; only filters refetch.

The sidebar holds what you navigate to, not what you configure: the workspace
switcher, **All issues**, and **My issues**. Settings hang off the two menus
that own them — workspace settings from the workspace switcher, account
settings from your avatar — and open as a full-page section with its own
navigation, split into **Workspace** (general, labels, workflow, webhooks) and
**Account** (preferences, API keys).

### Filtering

Filters live in the query string, so a narrowed view is a link. `?status=a,b&repo=none,c` is read
by the page's server load as well as the client, which means a shared URL arrives filtered rather
than showing everything and then narrowing.

Every dimension takes several values (`is any of`), including repo — where the literal `none`
sits alongside real ids, so "unscoped, or in `web`" is expressible the same way as any other
choice.

**Assignee** filters against `/workspaces/{workspace}/members`, which is *not* a membership list:
membership lives on GitHub and is not stored here, so what that endpoint returns is whoever has
actually appeared on an issue as assignee or creator.

### Markdown

Markdown is stored raw and rendered **on the server**, by [marked](https://marked.js.org) and sanitized by
DOMPurify. The browser never decides what is safe to render.

- **Bodies** get the full GFM set: tables, task lists, code fences, quotes.
- **Titles** get an inline-only subset — a title that produced a heading or a list would break
  every row it appears in, so block markdown is not parsed at all rather than parsed and stripped.

The editor is Tiptap over ProseMirror, serializing to markdown on every keystroke. It round-trips
task lists, tables, and code fences byte-for-byte, so opening and saving an issue you didn't
change leaves it untouched. ProseMirror is ~570 kB, so it is imported on mount rather than at
module scope — the issue list never pays for it.

### Files

Uploads go to MinIO under a key containing 128 bits of randomness, and the bucket is anonymously
readable. **Access control is the URL being unguessable**, which is the right trade for issue
attachments and the wrong one for anything genuinely sensitive. The bucket is created and opened
by the app itself on startup (`init` in `src/hooks.server.ts`), so a fresh volume needs no setup.

### Realtime and webhooks

Both carry the same events: `issue.created`, `issue.updated`, `issue.deleted`, `comment.created`,
`comment.deleted`.

- **SSE** (`GET /api/v1/workspaces/{workspace}/events`) fans out in-process, which is what a
  single node needs. A second node would want Postgres `LISTEN`/`NOTIFY` behind the same interface.
- **Webhooks** are **one attempt, no retry**. Each delivery carries `X-Tracker-Event`,
  `X-Tracker-Delivery`, `X-Tracker-Timestamp`, and `X-Tracker-Signature` — `sha256=` followed by
  the HMAC-SHA256 of `<timestamp>.<body>` under the endpoint's secret. The timestamp is inside the
  signature so a captured delivery cannot be replayed. The outcome of the last attempt is recorded
  on the endpoint and shown in settings; that is the whole audit trail.

Verifying a delivery:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = `sha256=${createHmac("sha256", secret)
	.update(`${headers["x-tracker-timestamp"]}.${rawBody}`)
	.digest("hex")}`;

const a = Buffer.from(expected);
const b = Buffer.from(headers["x-tracker-signature"]);
const valid = a.length === b.length && timingSafeEqual(a, b);
```

### The API

`/api/v1` is one surface, described by `/api/v1/openapi.json` and used by the app itself — so it
cannot quietly drift from what actually works. Authenticate with a key from **Settings → API
keys**:

```sh
curl -H "Authorization: Bearer trk_..." \
  http://localhost:5173/api/v1/workspaces/acme/issues
```

`X-API-Key` works too. A key carries its owner's access, which means the same workspaces GitHub
says they belong to.

API keys are verified explicitly rather than through better-auth's mocked-session option, so a key
authenticates `/api/v1` and nothing else — it cannot be used to mint more keys or change the
account it belongs to.

## Deploying

```sh
pnpm build   # writes dist/
node dist
```

Two things about that build are worth knowing before you ship it:

1. **Environment values are baked in at build time.** kit evaluates `env.public.ts` and
   `env.server.ts` during `vite build` and emits them as literals, so `dist/server/index.js`
   contains your `DATABASE_URL` and S3 secret verbatim. You cannot repoint a built artifact at
   another database by changing the environment — **build in the environment you deploy to**, and
   treat `dist/` as a secret.
2. **`PUBLIC_APP_URL` must match the origin you serve from.** better-auth rejects requests whose
   `Origin` doesn't match its base URL, so a build made with `http://localhost:5173` will refuse
   every sign-in on a real domain.

`node dist` reads `PORT`, `HOST`, and — behind a proxy — `ADDRESS_HEADER` and `XFF_DEPTH`. See
[the adapter docs](https://github.com/ieedan/implement/blob/main/apps/docs/src/content/kit/adapters.md).

The Postgres and MinIO in `compose.yaml` are for development. Point `DATABASE_URL` and the `S3_*`
variables at managed equivalents in production; the S3 client is the standard one and MinIO is
API-compatible, so nothing in the code changes.

## Keyboard

| Key | |
| --- | --- |
| `c` | New issue |
| `⌘K` / `Ctrl+K` | Command palette |
| `j` / `k` | Move down / up the issue list |
| `Esc` | Close the filter menu |
| `⌘↵` | Save the editor you're in |
