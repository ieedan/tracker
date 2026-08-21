# Router

In kit you don't build a router, you write files. Kit scans `src/routes`, generates the [core router](../implementjs/SKILL.md) from what it finds, and exports it from one virtual module. Navigation is typed against your actual route tree, so a typo'd path or a missing param is a compile error.

## The file conventions

Routes are directories under `src/routes`. A handful of file names mean something to kit, everything else in there is yours:

- `page.ts` is a page. It renders when the URL matches its directory.
- `layout.ts` wraps every page beneath it, including its own directory's page.
- `error.ts` at the routes root renders when nothing matches or a render throws.
- `page.server.ts` and `layout.server.ts` are load functions, and `server.ts` is an endpoint. These run only on the server.

So a routes directory like this:

```
src/routes
	page.ts           → /
	layout.ts         → wraps everything
	error.ts          → the 404 page
	docs
		page.ts         → /docs
		layout.ts       → wraps /docs and /docs/*
		[...slug]
			page.ts       → /docs/anything/below
	users
		[id]
			page.ts       → /users/:id
```

Any other file is colocated code and kit ignores it, so keep your components, helpers, and tests right next to the routes that use them. Dot directories are skipped too, with one exception covered under [extension routes](#extension-routes).

A directory declares at most one page and at most one layout, and it serves either a page or an endpoint, never both.

## Pages

A page default exports a function that receives `params`, `url`, and `data`:

```ts
// src/routes/users/[id]/page.ts
import { H1 } from "@implementjs/core";
import type { PageProps } from "./$types";

export default function Page({ params, url }: PageProps) {
	return H1("User: ", params.id);
}
```

The `./$types` module is generated per route directory, so `params` is typed with exactly the params that exist at that level. A page under `[id]` gets `{ id: Readable<string> }`, the root page gets `{}`.

`url` is the router's location, a `Readable<RouterLocation>` of `{ path, search, hash }`.

`data` is a readable of whatever this route's load functions returned. It is `Readable<{}>` when the route has no loads.

## Layouts

A layout receives `children` on top of the page props. Render it where the matched content should go:

```ts
// src/routes/layout.ts
import { Div, Main } from "@implementjs/core";
import type { LayoutProps } from "./$types";

export default function Layout({ children }: LayoutProps) {
	return Div(SiteHeader(), Main(children));
}
```

Layouts are persistent. Navigating between two pages under the same layout doesn't remount it, so sidebar scroll position and local state survive. Only the diverging part of the route chain swaps.

## Params are signals

Route params arrive as `Readable<string>`, not strings. Navigating from `/users/1` to `/users/2` doesn't remount the page, the router patches the param signal in place.

Render `params.id` directly and it stays up to date. When a change should reload data or reset state, wrap the part that needs rebuilding in `Key`, which remounts its children whenever the value changes:

```ts
import { Key } from "@implementjs/core";

export default function Page({ params }: PageProps) {
	return Div(H1(params.id), Key(params.id, UserCard(params.id)));
}
```

`Implement.Watch([params.id], refetch)` is the other option when you want to run something on a change rather than remount, and it unsubscribes with the component.

Params in a load function are the opposite: plain strings, because a load runs once per request for one concrete URL.

## Dynamic segments

Wrap a directory name in brackets to bind a param, just like SvelteKit:

- `[id]` matches one segment and binds it as `id`.
- `[...slug]` is a catch-all. It matches one or more remaining segments joined with `/`, so `docs/[...slug]` matches `/docs/a` and `/docs/a/b`, but not `/docs` itself. Give the `docs` directory its own `page.ts` for that. Nothing can nest below a catch-all.

Static segments always beat params at the same position, and params beat catch-alls, so `/users/new` wins over `/users/[id]` no matter how the directories sort. The same param name can't be bound twice on one path.

## Route groups

A directory wrapped in parentheses is a route group. It scopes a layout without contributing a URL segment:

```
src/routes
	(marketing)
		layout.ts         wraps everything in the group
		about
			page.ts         → /about   (not /marketing/about)
		contact
			page.ts         → /contact
	page.ts             → /
```

Here `/about` and `/contact` render inside the marketing layout while `/` doesn't, even though all three live at the same URL depth.

Because groups vanish from the URL, two pages can end up claiming the same path through different groups. Kit rejects that at scan time rather than picking one.

## Layout resets

Occasionally a page shouldn't inherit the layouts above it, like a login screen or a full bleed presentation view. An `@` in the filename resets which layouts wrap it. The name after the `@` is the ancestor directory segment whose layout chain to keep, and a bare `@` resets all the way back to the root layout:

```
page@.ts             rendered with only the root layout
page@(authed).ts     keeps layouts up to and including (authed)
layout@.ts           this layout inherits only the root layout
```

Resets never change the URL, only which layouts wrap the page. The target has to be an ancestor segment of the file, and a layout can't reset to its own directory, since a layout resets what it inherits.

## The error page

A root `error.ts` renders whenever no route matches, or a page or layout throws while rendering. It receives the `error` and the current `url`:

```ts
// src/routes/error.ts
import { H1, P } from "@implementjs/core";
import type { ErrorProps } from "./$types";

export default function ErrorPage({ error }: ErrorProps) {
	return [H1(`${error.code}`), P(error.message)];
}
```

`error.code` is an HTTP style status: `404` when no route matched, `500` when a render threw. Throw a `{ code, message }` object from a page to surface a custom status:

```ts
throw { code: 403, message: "Forbidden" };
```

It's root only for now, kit will refuse an `error.ts` anywhere deeper. When it exists, the build also writes a `404.html` so static hosts serve it for unknown URLs.

## $implement/router

Everything kit generates hangs off one virtual module, `$implement/router`. It exports the assembled router, typed against your route tree, so you get typed links and navigation anywhere in your app:

```ts
import { router } from "$implement/router";
```

Its declaration regenerates whenever your routes change, so the paths it accepts are always the paths that exist.

### Links

`router.Link` renders an `A` that navigates through the router:

```ts
router.Link({ to: "/users" }, "All users");
router.Link({ to: "/users/:id", params: { id: user.id } }, "Open");
router.Link({ to: "/users/:id", params: { id } }, "Open"); // params can be Readables
router.Link({ to: "/docs/:...slug", params: { slug: "guides/routing" } }, "Routing");
```

A few behaviors worth knowing:

- Modifier keys (cmd/ctrl/shift/alt), non-left clicks, and a `target` other than `_self` fall through to the browser, so open in new tab works.
- `replace: true` replaces the history entry instead of pushing one.
- The link sets `aria-current="page"` while its path is current. Style it with CSS (`aria-[current=page]:` in Tailwind).
- Every other `A` prop (class, events, and the rest) passes through.

Plain `A({ href: "/about" })` works too, the browser just does a full page load instead of a client side navigation (Avoid using this when navigating within the app)

### Programmatic navigation

```ts
router.navigate("/users");
router.navigate("/users/:id", { id: created.id });
router.navigate("/login", { replace: true });

const url = router.href("/users/:id", { id: 42 }); // "/users/42"
```

Both are typed against the tree like `Link` is. For untyped navigation (external state, a redirect built from a string) `navigateTo(href, { replace? })` is exported from `@implementjs/core`. Pushing a new entry scrolls to the top, `replace` does not.

### Location

`router.location` is a `Readable<RouterLocation>` of `{ path, search, hash }`. It is shared by every router and updated on all navigation including back and forward:

```ts
const onSettings = derived([router.location], (l) => l.path.startsWith("/settings"));
```

It is the same value pages and layouts receive as `url`.

### Search params

`router.searchParam(name, fallback?)` gives you a URL synced query string value. Reads react to navigation, and `set` rewrites the query string in place, replacing the history entry. Bind one to an input and you have a URL synced search box:

```ts
const query = router.searchParam("q", ""); // with a fallback the value is never null

Input({ value: query, placeholder: "Search..." });

const results = derived([users, query], (list, q) => list.filter((u) => u.name.includes(q)));
```

Setting `null`, `""`, or the fallback removes the parameter from the URL. Without a fallback the value is `string | null`. It's also exported standalone as `searchParam` from `@implementjs/core`.

## Extension routes

A directory named `.md` (or any `.<ext>`) holding a `server.ts` serves its parent's path with the extension appended. Params still bind from the parent pattern:

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

Same address, two representations: a rendered page for people, plain markdown for tools and LLMs.

## Code splitting and preloading

Kit splits every page and layout into its own chunk. The generated router declares a handle per route module instead of importing it, and the three places that can start a render (the client entry for the landing route, the navigation resolver for the destination, and the server entry) load the destination's modules before rendering it.

You don't do anything to get this. Prerendered pages also get a `<link rel="modulepreload">` per chunk so the route's code arrives alongside the entry instead of a round trip after it.

## While you work

The dev server watches the routes directory. Add or delete a route file and kit rescans, regenerates the types, and reloads the page. Editing the inside of a page is normal Vite HMR.
