# Server Routes

Not every URL is a page. A `server.ts` in a route directory is an **endpoint**: it exports one handler per HTTP method, each returning a standard `Response`. JSON APIs, markdown twins, feeds, sitemaps, webhooks — anything whose answer is a response rather than a rendered page.

A directory serves a page or an endpoint, never both. `page.ts` and `server.ts` in the same directory is a scan error:

```
"api/server.ts" conflicts with "api/page.ts" — a directory serves a page or an endpoint, not both
```

## Writing an endpoint

```ts
// src/routes/api/status/server.ts
import type { RequestEvent } from "./$types";

export function GET(): Response {
	return Response.json({ ok: true });
}

export async function POST({ request }: RequestEvent): Promise<Response> {
	const body = await request.json();
	await record(body);
	return new Response(null, { status: 204 });
}
```

`RequestEvent` comes from the generated `./$types`, the same place `PageProps` and `LoadEvent` do, so `params` is typed with exactly the params that exist at that level. Handlers may be sync or async.

### The event

The event is the same one a load gets — see [Loading Data](./LOADING_DATA.md#the-event) for the full table. In short: `request`, `params` (plain strings, not signals), `url`, `locals`, `route`, `isDataRequest`, `setHeaders`, and `getClientAddress()`.

`locals` is how an endpoint learns who is asking, and it comes from `src/hooks.server.ts` like everywhere else:

```ts
// src/routes/api/orders/server.ts
import { error } from "@implementjs/kit/server";
import type { RequestEvent } from "./$types";

export async function GET({ locals }: RequestEvent): Promise<Response> {
	if (locals.user === null) error(401, "Not logged in");

	return Response.json(await getOrders(locals.user));
}
```

### Methods

`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD` are dispatched by name. A method the module doesn't export answers `405` with an `Allow` header listing the ones it does. A `HEAD` request falls back to the module's `GET` when there is no `HEAD` export, and the body is dropped.

Endpoints never see a `__data.json` request. That URL belongs to pages, and kit routes it to the page's loads before it looks at endpoints.

## Extension routes

A directory named `.md` (or any `.<ext>`) holding a `server.ts` serves its **parent's path with the extension appended**. Params still bind from the parent pattern:

```
src/routes
	docs
		.md
			server.ts       → /docs.md
		[...slug]
			.md
				server.ts     → /docs/anything/below.md
			page.ts         → /docs/anything/below
```

```ts
// src/routes/docs/[...slug]/.md/server.ts
import type { RequestEvent } from "./$types";

export function GET({ params }: RequestEvent): Response {
	return new Response(markdownFor(params.slug), {
		headers: { "content-type": "text/markdown; charset=utf-8" },
	});
}
```

This is how a page gets a machine-readable twin at the same address: same URL, two representations, a rendered page for people and plain markdown for tools and LLMs. When both could match a path, the extension endpoint wins over a plain one.

Dot-directories are otherwise skipped by the scan. Only a `.<ext>` directory holding a `server.ts` becomes a route.

## Failing and redirecting

The same two helpers loads use, from `@implementjs/kit/server`. Both throw, so nothing after them runs, and both are typed `never`:

```ts
import { error, redirect } from "@implementjs/kit/server";
import type { RequestEvent } from "./$types";

export async function GET({ params, locals }: RequestEvent): Promise<Response> {
	if (locals.user === null) redirect(303, "/login");

	const report = await getReport(params.id);
	if (report === null) error(404, "No such report");

	return Response.json(report);
}
```

An endpoint's failure is answered as **JSON**, not with the error page — a caller that asked for a response gets a response. `error(status, body)` sends that status with the `App.Error` body. Anything else thrown is unexpected: the status is 500, `handleError` runs, and its return value is the JSON body. `redirect(status, location)` ends the request with a `location` header.

For anything the caller should handle rather than treat as a failure, just return the `Response` yourself. `error()` is for the cases where throwing out of nested code is the point.

## Headers

Two ways in, and they don't compete:

- **On the response.** The normal way. `new Response(body, { headers })` — and the only way to send `Set-Cookie`, which `setHeaders` rejects outright.
- **`event.setHeaders({ ... })`.** For a header the request should carry regardless of which branch produced the response, including from a hook. Each header may only be set once per request, and a header the response already carries wins.

## Hooks run for endpoints

`src/hooks.server.ts` wraps endpoints exactly like pages: `handle` runs, `resolve(event)` produces the endpoint's response, and whatever `handle` put on `event.locals` is what the handler reads. A hook can also answer instead of the endpoint by not calling `resolve`.

This is what makes content negotiation possible — a `handle` that redirects a request asking for `text/markdown` to that page's `.md` twin:

```ts
// src/hooks.server.ts
import { redirect, type Handle } from "@implementjs/kit/server";

export const handle: Handle = async ({ event, resolve }) => {
	if (event.request.headers.get("accept")?.includes("text/markdown")) {
		const twin = markdownTwin(event.url.pathname);
		if (twin !== null) {
			// a cache must not replay this redirect for a request that wanted the page
			event.setHeaders({ vary: "Accept" });
			redirect(303, twin);
		}
	}
	return await resolve(event);
};
```

See the hooks section of [Loading Data](./LOADING_DATA.md#hooks) for `handle`, `handleError`, `init`, and `sequence`.

## On build

The prerender renders every `GET` endpoint into a real file in `dist/`, so the built site serves them statically, through the same pipeline dev serves them with — `hooks.server.ts` included.

| Endpoint                       | What the build does                                                               |
| ------------------------------ | --------------------------------------------------------------------------------- |
| No params                      | One file at its path (`/api/status`, `/docs.md`)                                  |
| Extension endpoint over params | One file per prerendered page that matches: every `/docs/foo` gets `/docs/foo.md` |
| Param endpoint, no extension   | Skipped with a warning — there is no way to enumerate its paths                   |
| Not a `GET`                    | Skipped with a warning                                                            |

A `GET` that throws or answers non-`2xx` during the prerender **fails the build**, listing the paths that failed. A skipped payload otherwise looks like a route that simply had nothing to write.

That table generalizes to one rule: the built site is static. `GET` endpoints survive as files; `POST` and friends only exist while a server is running (dev today, a server adapter eventually). Design the endpoints you intend to ship as prerenderable `GET`s.

## In dev

The dev server dispatches matching requests to your endpoint modules before falling through to page routing, with Vite's transforms applied — endpoints import your app code, aliases and all, and edits apply on the next request. An endpoint that throws answers `500`; the terminal is where the stack trace goes, tagged with the file and method it came from.

## Endpoints versus loads

A load feeds a page; an endpoint _is_ the URL. If the data exists to render a page, it belongs in `page.server.ts` — the page's data is already embedded in the HTML and fetched as `__data.json` on navigation, so an endpoint beside it would be a second round trip for something the page already has. Reach for an endpoint when the response itself is the product. See [Loading Data](./LOADING_DATA.md).

## Endpoints stay on the server

Only the server-only `$implement/endpoints` module imports your `server.ts` files, so they never enter the client bundle — importing that module from client code is an error.

Note that the guard on `*.server.ts` files is a **name** rule, and `server.ts` doesn't match it (there's no dot before `server`). Nothing routes an endpoint into the client graph, but a page that imported `./server.ts` by hand would bundle it without complaint. Keep shared logic in `src/lib` and secrets in a `*.server.ts` module the endpoint imports, and the rule enforces itself. See [Environment Variables](./ENVIRONMENT_VARIABLES.md).
