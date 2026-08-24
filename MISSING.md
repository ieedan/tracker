# Missing

Things `@implementjs/kit` and `@implementjs/core` do not have that this app
wanted. Sharp edges on things that _do_ exist are in
[PAPERCUTS.md](PAPERCUTS.md); outright bugs are in [BUGS.md](BUGS.md).

Each entry is written to be handed to an agent as-is.

Versions: `@implementjs/kit@0.0.11`, `@implementjs/core@0.0.8`,
`@implementjs/router@0.0.9` (resolved by kit).

For context on what this app needed: session auth, an API-key-authenticated
REST API, a generated OpenAPI document, workspaces with members and invites,
issues with inline editing, and an in-app notification inbox.

Ordered by how much they cost here.

---

## 1. No way to re-run a load after a mutation

Add a way to invalidate a route's load data and have kit re-run it —
SvelteKit's `invalidate()` / `invalidateAll()`.

This is the single largest gap. Loads are the blessed way to get data into a
page, they are typed end to end, and they run in-process through `event.api`.
Then the user changes something and there is no way to say "that data is stale,
run it again". A load is effectively write-once per navigation.

What this app had to build instead:

- `src/lib/features/issues/issue-store.ts` — every issue mutation patches a
  local `Signal<Issue[]>` optimistically, sends the request, then splices the
  server's response back in, and rolls the signal back on failure.
- Every page seeds a signal from `data` and subscribes to `data` to reseed it
  (`data.onChange((next) => issues.set(next.issues))`), because a client
  navigation reseeds `data` in place instead of remounting.
- `issueCreated`, a module-scope signal, purely so the composer in the app shell
  can tell the issue list on another branch of the tree that a row should appear.
- The inbox badge polls `/api/v1/notifications/unread` on a 15s interval,
  because there is no way to say "the unread count in the layout's load is now
  wrong".

Every one of those is a workaround for the same missing primitive. Optimistic
updates are worth having by hand; _refetching_ is not.

Sketch:

```ts
import { invalidate, invalidateAll } from "$implement/navigation";

await api.PATCH("/api/v1/workspaces/[slug]/issues/[number]", { ... });
await invalidate();                       // re-run the loads for this route
await invalidate("/app/:slug/inbox");     // or a specific route's
```

Server-side, `runLoads` and the `__data.json` endpoint already exist and do
exactly this work for a navigation; this is asking for it on demand.

## 2. A load cannot read its parent layout's data

Give loads a `parent()` (SvelteKit's), so a page load can await what its
layout's load already computed.

`LoadEvent` is `RequestEvent` — there is no `parent`, so a layout load and a
page load underneath it cannot share anything, even though kit runs them for the
same request and merges their _results_ for the component.

In this app, `src/routes/app/[slug]/layout.server.ts` resolves membership
(a workspace lookup joined against `workspace_member`, plus the 403/404
decision). Every page load beneath it needs the same workspace row, so every
page load calls `requireMembership(locals, params.slug)` again:

```
app/[slug]/layout.server.ts        → requireMembership(...)
app/[slug]/page.server.ts          → requireMembership(...)   // again
app/[slug]/inbox/page.server.ts    → requireMembership(...)   // again
app/[slug]/settings/page.server.ts → requireMembership(...)   // again
app/[slug]/issue/[number]/page.server.ts → requireMembership(...) // again
```

That is a duplicated query per request on every page in the section, and worse,
a duplicated _authorization decision_ — the kind of thing that is supposed to
live in one place. `locals` is the only channel between them, and `locals` is
set by `hooks.server.ts`, which does not know the route's params at the point it
would need them.

```ts
export default async function load({ parent, params }: LoadEvent) {
	const { workspace } = await parent(); // whatever layout.server.ts returned
	return { issues: await listIssues(workspace.id) };
}
```

## 3. No cookies API on the request event

Add `event.cookies` with `get` / `set` / `delete`, for hooks, loads and
endpoints.

Today cookies are raw headers in one direction and impossible in the other:

- Reading: `event.request.headers.get("cookie")`, parse it yourself.
- Writing: there is nowhere to put one. `setHeaders` is documented as
  "One value per header, and no cookies", and a load has no access to the
  response.

This app got away with it only because better-auth returns its own `Response`
with `Set-Cookie` already on it, and that response is passed straight through
from `src/routes/api/auth/[...all]/server.ts`. Anything doing its own sessions —
or just remembering a filter, a last-visited workspace, a dismissed banner —
has to hand-build `Set-Cookie` strings, and cannot do it from a load at all.

`Set-Cookie` is also the one header where "one value per header" is wrong: it is
legitimately repeated, so `setHeaders` could not express two cookies even if it
allowed them.

## 4. No form actions — every mutation is a client-side fetch

Add server-side form actions (SvelteKit's `export const actions`), so a `<form>`
can post to the route that renders it and work before JavaScript loads.

Kit server-renders every page, which is most of the work of progressive
enhancement. But there is no way to receive a form post at a page route: a
`server.ts` and a `page.ts` cannot share a directory ("A directory serves a page
or an endpoint, never both"), so a form has nowhere on its own route to submit
to.

The result is that every mutation in this app — sign-in, create workspace,
create issue, comment, invite, label, API key — is a `fetch` from a click
handler that manages its own `loading` and error signals. That is fine when JS
is up, and nothing at all before it is. For an app whose first paint is already
server-rendered, that asymmetry is a shame.

## 5. `error.ts` is root-only

Allow an `error.ts` in any route directory, scoped to that subtree.

Kit refuses one anywhere but the routes root. So a 404 inside the app shell
(`/app/acme/issue/9999`, a real case here) renders the same bare full-page error
as a 404 at the root — losing the sidebar, the workspace switcher, and any way
back that is not the browser's back button. A section-level error page would
render inside its layout, the way a section-level layout does.

## 6. No streaming/SSE story for server routes

Document — and if needed support — a long-lived streaming response from a
`server.ts` endpoint, and say which adapters can hold one.

A `handler` returning a `Response` passes through untouched, so a
`ReadableStream` presumably works, but nothing says so, nothing says what
happens to it under each adapter (a Vercel function and a Cloudflare worker have
very different answers), and the generated client types a raw `Response` as
`data: never`, which is right for a stream and unhelpful for consuming one.

This app polls its inbox on a 15s timer instead. Polling is a defensible choice
here, but it was made because SSE was an unknown rather than because it was
better.

## 7. No test utilities for loads, handlers or hooks

Ship a way to invoke a load / `handler()` / the hook chain against a synthetic
`RequestEvent`, with `locals` supplied.

`handler()` returns a plain request handler, which is testable in principle, but
building the `RequestEvent` it expects — `params`, `url`, `locals`, `api`,
`setHeaders`, `getClientAddress`, `platform` — is enough boilerplate that this
app has no unit tests for its endpoints; verification here is end-to-end against
a running server instead. Something like:

```ts
import { createTestEvent } from "@implementjs/kit/test";

const response = await GET(
	createTestEvent({
		params: { slug: "engineering" },
		locals: { user: fakeUser, authVia: "session" },
	}),
);
```

## 8. Server env is build-time only, with no dynamic counterpart

Add a validated, per-request environment read — SvelteKit's `$env/dynamic/private`.

`defineEnv` in `src/lib/env.server.ts` is evaluated once during `vite build` and
re-emitted as literals. That is a genuinely good default and the docs are honest
about it. But it means rotating `BETTER_AUTH_SECRET` or a database token
requires a rebuild and redeploy, not a restart, and the built artifact contains
the secret. The escape hatch the docs offer is bare `process.env` in the route,
which gives up the validation and the types that were the point of `defineEnv`.

The docs already name this as "additive work on top of what is here"; this entry
is a vote for it from an app that deploys to Vercel with a hosted database.

---

## Not missing — worth recording

These were expected to be gaps and were not:

- **`handler()`** — validated body/query/params, a typed result, a generated
  client and an OpenAPI document off one definition, with schemas from any
  Standard Schema library. Better than what most frameworks ship.
- **`event.api`** — the generated client bound to an in-process fetch, so a load
  calling its own endpoint is a function call. Used throughout, no round trips.
- **Server-only enforcement** — `*.server.ts` and route `server.ts` are refused
  in client code with the import chain named. It caught a genuine mistake here
  (a schema imported by both a form and an endpoint) and the error said exactly
  how to fix it: put the schema in a shared module. That is why
  `src/lib/domain/` exists in this app.
- **Params as signals** — navigating `/app/a` → `/app/b` patches params and
  reseeds `data` without remounting, and the sidebar keeps its state for free.
- **`@implementjs/primitives` + the `ui` registry** — dialog, dropdown, command
  palette and toast were all complete enough to build a Linear-shaped UI from
  without dropping to hand-rolled ARIA.
