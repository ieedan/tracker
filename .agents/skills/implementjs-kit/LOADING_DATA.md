# Loading Data

Pages often need data a browser can't produce on its own: files read off disk, a database query, an API call with a secret. Kit's answer is the same as SvelteKit's, put a load function next to the page.

- `page.server.ts` loads data for its directory's page.
- `layout.server.ts` loads data for its directory's layout, and for every page beneath it.

These files run **only on the server**, during dev requests and the build's prerender, and never reach the browser bundle. They can import `node:fs`, hold secrets, and talk to databases. Anything named `*.server.ts` is server only, and kit fails the build if client code imports one. See [Environment Variables](./ENVIRONMENT_VARIABLES.md) for how that guard reports itself.

## Writing a load

A load default exports a function that receives the request event and returns an object. Async is fine:

```ts
// src/routes/blog/[slug]/page.server.ts
import { getPost } from "@/lib/posts";
import type { LoadEvent } from "./$types";

export default async function load({ params }: LoadEvent) {
	return { post: await getPost(params.slug) };
}
```

`LoadEvent` comes from the generated `./$types`, the same place `PageProps` does, so `params` is typed with exactly the params that exist at that level.

Note `params` here are **plain strings**, not signals. A load runs once per request against one concrete URL, so there is nothing to keep reactive. Signals are the page's side of the boundary, not the load's.

Returning nothing is the same as returning `{}`.

### The event

| Field                | What it is                                                                           |
| -------------------- | ------------------------------------------------------------------------------------ |
| `params`             | The route's params as plain strings, typed by `./$types`                             |
| `url`                | The request `URL`, so `url.searchParams` is where query strings come from            |
| `request`            | The web standard `Request`                                                           |
| `locals`             | Whatever `src/hooks.server.ts` put on this request, typed by your `src/app.d.ts`     |
| `route`              | `{ id }`, the matched route's directory-style id (`/docs/[...slug]`)                 |
| `isDataRequest`      | `true` when this is a client navigation's `__data.json` fetch rather than a document |
| `setHeaders`         | Adds headers to the response. Each header may only be set once                       |
| `getClientAddress()` | The client's address                                                                 |

`locals` is the usual way a load learns who is asking:

```ts
export default async function load({ locals }: LoadEvent) {
	return { orders: await getOrders(locals.user) };
}
```

### What you can return

The result is serialized with `JSON.stringify`, both into the page's HTML and into `__data.json`, so it has to be JSON. Strings, numbers, booleans, null, arrays, and plain objects survive. A `Date` arrives as a string, a `Map` or `Set` arrives as `{}`, and an `undefined` value disappears. Convert on the server, or convert on the way in.

## Reading the data

The page (or layout) receives `data`, a readable of everything its route's loads returned:

```ts
// src/routes/blog/[slug]/page.ts
import { Article, derived, H1 } from "@implementjs/core";
import type { PageProps } from "./$types";

export default function Page({ data }: PageProps) {
	return Article(H1(derived([data], ({ post }) => post.title)));
}
```

`data` is a readable for the same reason `params` are. Navigating from `/blog/one` to `/blog/two` doesn't remount the page, the router patches params in place and kit reseeds the data, so a `derived` over `data` updates by itself. Read it through `derived` or `data.bind(...)` rather than calling `data.get()` in the function body, which would give you the value at mount and never update.

`data.bind("post")` is the shorter form when you only want one key:

```ts
export default function Page({ data }: PageProps) {
	const post = data.bind("post");

	return Article(H1(post.bind("title")), Html(post.bind("html")));
}
```

The type of `data` is inferred from your load's return type, through `PageData` in `./$types`. Nothing to annotate on the load itself. A route with no loads still gets `data`, typed `{}`.

## Layout data flows down

A `layout.server.ts` load contributes to its own layout's `data` **and** to every page below it. A page's `data` is the merge of every layout load above it plus its own, later loads winning on key conflicts:

```
src/routes
	layout.server.ts          → { user }
	blog
		[slug]
			page.server.ts        → { post }
			page.ts               → data is { user, post }
```

Loads run in sequence, root layout first and the page's own load last. They do not run in parallel, so a slow layout load delays the page's own.

An `@` [layout reset](./ROUTER.md#layout-resets) resets data the same way it resets layouts. A page that skips a layout skips that layout's load too, and its `data` type changes to match.

## Failing and redirecting

Two helpers from `@implementjs/kit/server` end a request from inside a load. Both throw, so nothing after them runs, and both are typed `never` so TypeScript narrows correctly:

```ts
import { error, redirect } from "@implementjs/kit/server";
import type { LoadEvent } from "./$types";

export default async function load({ params, locals }: LoadEvent) {
	if (locals.user === null) redirect(303, "/login");

	const post = await getPost(params.slug);
	if (post === null) error(404, "No such post");

	return { post };
}
```

`error(status, body)` is an **expected** failure. The [error page](./ROUTER.md#the-error-page) renders with that status and message, and `handleError` is not called. The status has to be 400 to 599. The body is a string or an `App.Error` object, which you can widen in `src/app.d.ts` if the error page should render more than a message.

`redirect(status, location)` ends the request with a `location` header. The status has to be 300 to 308, and 303 is the usual one. On a client-side navigation the data fetch can't follow it, so kit falls back to a full document load and the browser follows the redirect from there. The destination is the same either way.

Anything else a load throws is **unexpected**: the status is 500, `handleError` is called with it, and the error page renders whatever that hook returned. See the hooks section below.

> [!NOTE]
> A redirect thrown while prerendering fails the build, with `did not render a page`. A prerendered file has no way to represent a redirect, so a route that always redirects should not be in the prerender set.

## Where the data actually comes from

You never fetch it yourself, but the plumbing explains the behavior you see:

- **First paint.** The server render runs the loads, renders with the data, and embeds it in the HTML as a `<script type="application/json">`. The client picks it up during hydration, so there is no duplicate request.
- **Client navigation.** Before a navigation to a load-bearing route commits, kit fetches `<path>/__data.json` and only then swaps the page. The route's code chunk and its data are fetched concurrently, so a navigation costs one round trip rather than two. If either fetch fails, the app falls back to a full document load rather than rendering a half-loaded page.
- **On build.** The prerender runs every route's loads once, writing the results into each page's HTML and into its `__data.json`. On a static host the data is frozen at build time, so rebuild to refresh it.

In dev the `__data.json` endpoint runs your loads on demand. In the built site it is a static file.

## Loads versus endpoints

A load feeds a page. When you want a URL that returns a `Response` of its own, JSON or markdown or anything else, that's a `server.ts` endpoint instead, and a directory serves one or the other, never both. Endpoints get the same `RequestEvent` and the same `error` and `redirect` helpers.

## Hooks

`src/hooks.server.ts` wraps all of this. It is optional, and every hook it exports is optional too:

```ts
// src/hooks.server.ts
import type { Handle, HandleServerError } from "@implementjs/kit/server";

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getUser(event.request.headers.get("cookie"));
	return await resolve(event);
};

export const handleError: HandleServerError = ({ error, event }) => {
	report(error, event.url.pathname);
	return { message: "Something went wrong" };
};
```

- `handle` runs for every server request: pages, endpoints, and the `__data.json` behind a client navigation. `resolve(event)` is the rest of kit and hands back the `Response`. Skip the call and the route never runs. What it puts on `event.locals` is what loads read, typed through `App.Locals` in `src/app.d.ts`.
- `handleError` is called with anything thrown that wasn't an `error()` or `redirect()`. It returns the `App.Error` the error page renders. The default logs and says `Internal Error`.
- `init` is awaited once, before the first request is handled.
- `sequence(...handlers)` chains several `handle` hooks left to right.
