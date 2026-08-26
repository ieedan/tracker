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
pnpm setup:dev            # walks through .env, starts storage, migrates and seeds
pnpm dev
```

`setup:dev` prompts for each value, validates answers against the same schemas
the app enforces at build time, generates an auth secret, starts MinIO for
attachment storage, and offers to run the migrations and the seed. An
interrupted run leaves a draft and offers to resume; `--fresh` ignores it and
starts over. Prefer doing it by hand? `cp .env.example .env`,
`docker compose up -d`, then `pnpm db:migrate && pnpm db:seed`.

Then sign in at http://localhost:5173 as **demo@tracker.dev** / **password123**.

Everything under `/app` needs a workspace; anyone without one is sent to
`/workspaces/new`, which renders on its own so there is never a sidebar linking
at a workspace that does not exist.

## Deploying it

```sh
pnpm setup:prod           # walks through .env.production, then pushes it to Vercel
```

Production needs four things this walks you through, in the order that avoids
going back and forth between dashboards:

1. **The public URL** — `BETTER_AUTH_URL`. Every callback URL printed later is
   built from it, so it is asked first.
2. **A database** — Turso. If the `turso` CLI is on your PATH the setup creates
   the database and mints its token itself; otherwise it hands you the dashboard
   link and takes the two values by hand.
3. **A bucket** — Cloudflare R2, or anything else speaking S3. It prints the
   exact CORS policy to paste, with your origin already in it; the browser PUTs
   straight to the bucket, so uploads fail without it.
4. **GitHub** — one GitHub App, covering both sign-in and repositories, with
   its two callback URLs and its permissions spelled out. It is optional;
   skipping it leaves both features off rather than half-working.

It ends by writing `.env.production`, pushing every value to Vercel (via the
`vercel` CLI, if installed), then offering the two irreversible steps last:
migrating the production database, and `vercel deploy --prebuilt --prod`.

Run it as often as you like — every answer already on disk comes back as the
default, so a second run is how you fill in the part you postponed. Nothing
seeds demo data into production.

The webhook retry cron registers itself during `build`; it needs `CRON_SECRET`
set, which the setup generates.

## Preview deployments

```sh
pnpm setup:preview        # walks through .env.preview, then pushes it to Vercel
```

Every preview deployment gets a database of its own, so a pull request can
migrate, seed and delete freely without touching production or the next
reviewer's data.

`setup:preview` creates one **template** database — migrated and seeded once —
and mints a Turso API token scoped to a single organization and group. Both go
into Vercel's Preview environment. From then on `scripts/build.ts` runs before
every preview build and branches that template into
`preview-<branch>-<hash>`, applies whatever migrations the branch has added on
top, and points the deployment at it. `defineEnv` bakes the environment into the
bundle, which is why this happens before `vite build` rather than at runtime.

The name comes from the branch, not the deployment, so pushing again reuses the
same database instead of discarding the state a reviewer built up. Sign in to any
preview as **demo@tracker.dev** / **password123**.

GitHub on previews is its own choice: a separate App (which keeps production's
private key and its list of installations out of preview deployments), the
production App, or nothing. Repository linking works either way.

Sign-in is the part that does not travel. GitHub matches callback URLs
literally and rejects a wildcard at registration — `https://tracker-*.vercel.app/…`
is not a valid callback URL — so the per-branch and per-deployment URLs can
never be registered, and only the one origin you did register can complete a
sign-in. better-auth's
[`oAuthProxy`](https://better-auth.com/docs/plugins/oauth-proxy) plugin exists
for this: sign-in goes through one registered URL, which hands the session back
to the preview origin. This app does not currently use it.

`pnpm preview:prune` deletes the preview databases whose branch is gone from
`origin`.

None of it does anything until `.env.preview` reaches Vercel's Preview
environment — a build reads the variables that exist when it starts, so a
deployment made before the push fails validation and has to be redeployed.
`pnpm setup push preview` sends the file without walking setup again, and
`pnpm setup push prod` does the same for `.env.production`.

| Script            | What it does                                                         |
| ----------------- | -------------------------------------------------------------------- |
| `setup:dev`       | Interactive `.env` for this machine                                  |
| `setup:preview`   | Interactive `.env.preview`, plus per-deployment preview databases    |
| `setup:prod`      | Interactive `.env.production` for a deployment                       |
| `dev`             | Dev server, server-rendered, HMR                                     |
| `build`           | Production build (writes `.vercel/output` and `static/openapi.json`) |
| `preview`         | Serve the build locally                                              |
| `check`           | Sync generated types, then typecheck                                 |
| `lint` / `format` | oxlint / oxfmt                                                       |
| `db:generate`     | Generate a migration from the schema                                 |
| `db:migrate`      | Apply migrations                                                     |
| `db:seed`         | Seed the demo workspace (idempotent)                                 |
| `preview:prune`   | Delete preview databases whose branch is gone                        |

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
- **Attachments** — drag files onto an issue or pick them; images and video
  render in place, everything else becomes a chip. Up to 100MB each.
- **Repositories** — link any number of GitHub repositories to a workspace,
  scope issues to one, reference files with `@`, and attach a pull request to
  an issue 1:1.
- **User feedback** — an ingest endpoint anyone can point a widget or a support
  script at, a workspace tab to triage what arrives, one click to turn a piece
  of feedback into an issue, and an optional public board where the people who
  asked can follow along.
- **Filters** — `F` (or the Filter button) opens a two-step menu: pick a
  dimension — status, priority, assignee, label, team, creator — then pick
  values. Each active filter becomes a chip you can edit in place: click the
  operator to flip `is` ⇄ `is not`, click the values to change them, `×` to drop
  it. Filters live in the URL, so a filtered view is a shareable link.
- **Keyboard** — `⌘K` command palette, `c` to compose an issue, `/` to search,
  `F` to filter, `⌘↵` to submit a composer or a comment, `Esc` to dismiss.
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

Each key is scoped. At creation you choose read and/or write on **issues**
(comments and attachments included), **workspace** (the workspace, its teams and
templates), **labels** (write creates one; there is no rename or delete),
**members**, **webhooks**, **feedback**, and **notifications**. Sessions
skip those checks; a key without a scope gets 403. Keys minted before scoping
still have full access. Ingest (`POST …/user-feedback`) needs **feedback**
write when a key is presented.

## Attachments

`docker compose up -d` runs MinIO, which speaks S3, so development and a
Cloudflare R2 deployment share one code path — only the endpoint and credentials
change. The console is at http://localhost:9001 (`tracker` / `tracker-dev-secret`).

Uploads go **straight from the browser to storage** with a presigned PUT. That
is not a nicety: a Vercel function caps its request body at a few megabytes, so
proxying uploads would limit attachments to about one phone photo. Downloads
mirror it — the app hands out a stable URL and redirects to a short-lived
presigned GET, so the bucket stays private without this server streaming every
byte of every video.

Uploadable types are an allowlist. `image/svg+xml` and `text/html` are
deliberately absent: these files are served back to other people, and either one
from an untrusted uploader is a stored-XSS delivery mechanism.

For R2, set `S3_ENDPOINT` to `https://<account>.r2.cloudflarestorage.com`,
`S3_BUCKET`, and an R2 access key pair, then allow `PUT` from your app's origin
in the bucket's CORS policy — the browser uploads directly, so the bucket has to
accept cross-origin PUTs.

## Filters

Filters are query params, and they are meant to be readable:

```
?status=todo,in_progress        status is Todo or In Progress
?status=!done,canceled          status is not Done or Canceled
?assignee=none                  unassigned
?label=<id>&team=ENG            combined — every filter must match
```

Because the URL is the state, a filtered list survives a reload, works with the
back button, and **server-renders already filtered** rather than painting the
full list and then narrowing it.

Matching runs over the issues the page loaded, in `filters.ts` — one pure
function shared by the server render and the browser. That is the right trade
while a workspace's issues fit in one response; the API already takes
`?team=`/`?status=` server-side, and pushing the rest down to SQL is what to do
when the list grows enough to need pagination.

## Repositories

Link repositories under **Settings → Repositories**. GitHub is the only
implementation, but everything goes through a provider adapter
(`src/lib/server/providers/`), so the routes never learn which host they are
talking to and adding GitLab is one new file.

### One app, two grants

|                                            | What it is              | What it reaches                           |
| ------------------------------------------ | ----------------------- | ----------------------------------------- |
| `GITHUB_CLIENT_ID` / `_SECRET`             | The App's OAuth client  | Someone's name and email, to sign them in |
| `GITHUB_APP_ID` / `_SLUG` / `_PRIVATE_KEY` | The same App's identity | The repositories an org admin granted     |

Both halves are one GitHub App. It runs the same user-to-server flow an OAuth
app does, so it signs people in from `/api/auth/callback/github`, and its
private key mints the installation tokens that read code. The App needs the
account permission **Email addresses (read)** for sign-in to learn an address
at all — without it people arrive with none.

Sharing a registration does not merge the two grants. Signing in with GitHub
still never grants access to code: repository access comes from an App
_installation_, installed onto an organization by somebody with authority over
it, scoped to the repositories they picked, and still working when that person
leaves the company. Authorising sign-in installs nothing. A user's own OAuth
token would give you none of those three.

Two separate apps still work, if you would rather keep the registrations apart:
put an OAuth app's `Ov23li…` credentials in `GITHUB_CLIENT_ID` / `_SECRET` and
leave the App to `GITHUB_APP_*`. Each client ID is only valid for the callback
URLs registered against its own app — mixing them up is what produces GitHub's
"redirect_uri is not associated with this application" page.

Installation tokens live an hour, so they are minted on demand and cached
in-process — never stored.

For development, `GITHUB_DEV_TOKEN` lets a personal access token stand in for
an installation, so the feature can be tried without creating and installing a
real App. It is ignored whenever `GITHUB_APP_ID` is set. `GITHUB_API_URL`
points at GitHub Enterprise Server.

### What linking gives you

- **Scope** — an issue can belong to a repository. It shows on the row and in
  the detail rail, and `?repository=<id>` filters the list.
- **`@` file references** — linking indexes the repository's file tree (paths
  only; contents would make it a clone). Typing `@` in a description or comment
  searches that index and inserts a link to the file on the provider. Search
  ranks a basename hit above one buried in a directory, because typing `schema`
  means `schema.server.ts`.
- **Pull requests** — one per issue, one issue per pull request, enforced by
  unique indexes rather than by convention. Paste a URL, `owner/name#12`, or
  bare `#12` when the issue is already scoped. Linking one scopes the issue,
  since it says where the work is.

Re-index from Settings when the tree has moved on; the row says how many files
it holds, which ref they came from, and whether the provider capped the tree.

## User feedback

Feedback is a separate thing from an issue on purpose. An issue is work; a piece
of feedback is a _request_ for work, which may be duplicated, declined, or one
of thirty people asking for the same thing. So it has its own table, its own
`FB-12` numbering and its own statuses — New, Reviewing, Planned, Accepted,
Declined — none of which claim anything about progress.

### Taking it in

One endpoint, `POST /api/v1/workspaces/<slug>/user-feedback`, and the workspace
decides who may call it (**Settings → User feedback → Intake**):

| Mode                         | Who can post                                     | Rate limit      |
| ---------------------------- | ------------------------------------------------ | --------------- |
| Closed                       | nobody; the endpoint 404s                        | —               |
| API key required _(default)_ | callers presenting a key with **feedback** write | 120/min per key |
| Open to anyone               | anyone with the URL                              | 5/min per IP    |

A new workspace starts on **API key required**. An open ingest endpoint on a URL
that is guessable from a workspace slug is something you should have to switch
on, not something you find out about after it fills with spam.

```bash
curl -X POST http://localhost:5173/api/v1/workspaces/acme/user-feedback \
  -H "content-type: application/json" \
  -H "x-api-key: $TRACKER_API_KEY" \
  -d '{
        "title": "Dark mode please",
        "description": "The white burns at night.",
        "email": "rae@example.com",
        "name": "Rae",
        "source": "widget",
        "subscribe": true
      }'
```

`email` is optional and is what a reply would go to; `subscribe` adds it to the
list told when this feedback moves. **Nothing sends mail yet** — the list is
being collected so that it is already populated the day sending exists.

The limiter is a fixed window in the database (`rate_limit`), not in memory:
every serverless invocation starts cold, so an in-process counter would reset
about as often as it was consulted. The counter is one atomic upsert, so two
simultaneous requests cannot both read "4 of 5" and both be allowed.

### Triaging it

The **User feedback** tab lists what has arrived, newest first, with tabs across
the statuses. Status and labels are edited inline. **Convert** files an issue
from it in one click — the default team, or pick one from the split button.

Converting:

- copies the submitter's description across **verbatim** — rewriting what
  somebody told you and then quoting it back is how the record stops meaning
  anything;
- carries over the feedback's labels and adds a `user feedback` label, created
  on demand, so months later you can filter the backlog by it and see which of
  your work came from someone actually asking;
- links both ways — the issue keeps `feedbackId`, the feedback shows the issue
  it became;
- is idempotent. A second convert returns the first issue rather than making
  another; the unique index on `issue.feedbackId` is what guarantees it.

### The public board

With **Public board** set to _Anyone with the link_, feedback marked public
appears at `/<workspace-slug>/public/feedback`. It is a separate page, not the
tab with things hidden — different audience, different job:

- no triage controls, no internal notes, no submitter names or addresses;
- anyone can read it and subscribe by email with no account at all;
- replying needs a signed-in account, which is the anti-spam measure, and is
  rate limited to 10/min per account for non-members;
- members can leave **internal notes**, which never reach it.

Redaction happens in `toFeedback`/`toFeedbackComment` on the server, not in the
UI. The load's return value is serialized into the page for hydration, so "the
component does not render it" would not have been protection.

Turning the board off un-publishes everything on it. Turning it back on does
not republish — each item has to be made public again deliberately.

### Webhooks

`feedback.created`, `feedback.updated`, `feedback.status_changed`,
`feedback.converted`, `feedback.comment_created` and `feedback.deleted`, on the
same signed delivery pipeline as the issue events. `feedback.converted` carries
both the feedback and the issue it became. These payloads go to an endpoint the
workspace registered, so they are the _member_ view — submitter address and all.

## Webhooks

Add one under **Settings → Webhooks**, choose the events, and the signing secret
is shown once. Events: `issue.created`, `issue.updated`, `issue.assigned`,
`issue.status_changed`, `issue.deleted`, `comment.created`, and the six
`feedback.*` events above. A webhook can also carry [custom
headers](#custom-headers) and [conditions](#conditions) that narrow what it
actually receives. Everything but the URL is editable afterwards — the URL is
what the secret was issued against, so pointing somewhere else means a new
webhook.

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

### Custom headers

A webhook can send up to 20 headers of its own — a bearer token for whatever
gateway sits in front of the receiver, a tenant id, a routing key:

```json
{ "headers": { "Authorization": "Bearer …", "X-Tenant": "acme" } }
```

They are merged in _under_ the four `x-tracker-*` headers and `content-type`,
which always win, so nothing set here can spoof the signature a receiver
verifies against. The transport headers (`host`, `content-length`,
`connection`, `transfer-encoding` and friends) are refused for the same reason,
as is any value carrying a control character — a CR in a header value is
request splitting. Unlike the signing secret, header values are readable by
workspace admins, because a header is something you edit.

### Conditions

Subscribing to `issue.updated` means every edit to every issue. Conditions
narrow that to the ones worth sending — _when an issue is labeled `bug`, or
when one is assigned to Claude_:

```json
{
	"filter": {
		"type": "group",
		"match": "any",
		"rules": [
			{ "type": "condition", "field": "issue.labels", "operator": "includes", "value": "bug" },
			{
				"type": "condition",
				"field": "issue.assignee.name",
				"operator": "equals",
				"value": "Claude"
			}
		]
	}
}
```

A group is `match: "all"` or `"any"` over its `rules`, and a rule is either a
condition or another group — one level of nesting, which is `(A or B) and C`.
Fields cover the event and actor, the issue (status, priority, labels, team,
assignee, creator, repository), the comment, the feedback, and
`changes.fields`, which is how you say "only when the priority changed".
Operators depend on the field: `equals`, `contains`, `starts_with`, `in`,
`includes_all`, `greater_than`, `is_set` and their negatives — the builder
under **Settings → Webhooks** only offers the ones that apply, and shows the
tree back to you as a sentence.

The builder writes the same JSON, as chips that read like the issue filter
bar. Fields whose values are known — labels, members, teams, repositories, and
the fixed sets behind statuses, priorities and `changes.fields` — are picked
from a list rather than typed, so a condition can't miss on a typo. The
workspace-backed ones stay open: a value the workspace doesn't have yet can
still be entered, since the API accepts any string there.

Comparison is case- and whitespace-insensitive, so `Claude` matches `claude`.
A field the event does not carry reads as unset rather than erroring, and a
webhook with no conditions — or with an empty group — delivers everything it is
subscribed to. Conditions are evaluated at enqueue time, so a filtered-out
event leaves no delivery row at all. **Test sends skip them**, since a
synthetic payload carries no issue to match against.

**Delivery is at-least-once.** Deliveries are written to the database before
anything is sent, attempted immediately, and retried on a backoff
(1m → 5m → 30m → 2h, five attempts) by `POST /api/v1/webhooks/drain`. That route
is authorized by `CRON_SECRET` and 404s when it is unset. `pnpm build`
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
│  │  └ providers/       git host adapters; github is the only one so far
│  ├ features/           screens: issues, feedback, inbox, settings, shell
│  ├ components/ui/      @implementjs/ui components, restyled
│  └ client/             browser-side api, auth and toasts
└ routes/
   ├ api/auth/[...all]/  better-auth's own surface
   ├ api/v1/             the documented REST API
   │  └ webhooks/drain/  cron-authorized delivery retries
   ├ app/[slug]/         the product, behind a session
   │  ├ team/[key]/      one team's issues
   │  ├ feedback/        the triage tab, and FB-12
   │  └ issue/[identifier]/   ENG-42
   ├ [slug]/public/feedback/  the public board — no session, no shell
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
