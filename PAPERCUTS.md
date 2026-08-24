# Papercuts

Things in `@implementjs/kit` / `@implementjs/core` that exist and work, but cost
time or surprised me while building this app. Outright bugs are in
[BUGS.md](BUGS.md); things that do not exist at all are in [MISSING.md](MISSING.md).

Each entry is written to be handed to an agent as-is.

Versions: `@implementjs/kit@0.0.10`, `@implementjs/core@0.0.8`,
`@implementjs/router@0.0.9`, `create-implement-app` kit template.

---

## 1. `handler({ params })` replaces every param instead of narrowing the named one

Make a handler's `params` schema merge with the route's inferred params, or
document loudly that it replaces them.

Declaring a schema for one param silently drops the others from the typed
event. On `src/routes/api/v1/workspaces/[slug]/issues/[number]/server.ts`:

```ts
export const GET = handler({
	params: v.object({
		number: v.pipe(v.string(), v.transform(Number), v.number()),
	}),
	handle: ({ params }) => db.get(params.slug, params.number),
	//                                  ^^^^ TS2339: Property 'slug' does not
	//                                  exist on type '{ number: number }'
});
```

You have to redeclare `slug: v.string()` purely to keep a param you never
wanted to touch — and on a route with four params you redeclare three.

What makes it sharp is that the docs' example is a single-param route
(`params: v.object({ id: ... })` on `/posts/[id]`), where replace and merge are
indistinguishable, and the prose reads as narrowing: "overrides the route's
string". So the behaviour is invisible until a multi-param route hits it, and
then it reads as a bug rather than a design choice.

Either merge (schema keys win, unlisted params keep their inferred string type),
or say plainly in the API Routes guide: "a `params` schema describes _all_ of
the route's params; any you omit are dropped."

## 2. `router.navigate` and `router.Link` disagree about params

Give `navigate` and `Link` the same params shape, and let `navigate` accept
signals.

```ts
router.Link({ to: "/app/:slug", params: { slug } }, "Issues"); // nested, Readable ok
router.navigate("/app/:slug", { slug }); // positional, no Readable
```

Two differences at once, for the same idea:

- `Link` takes params nested under a `params` key; `navigate` takes them as its
  second positional argument.
- `LinkParams` accepts `Readable<T> | T`; `HrefParams` (used by `navigate` and
  `href`) accepts only `T`. So every signal needs a `.get()` when it moves from
  a link to a programmatic navigation.

Turning a `Link` into an `onSelect: () => navigate(...)` — which is exactly what
happens when a nav item becomes a dropdown item, as it did in this app's
workspace switcher — is a rewrite of the call plus a `.get()` on each param,
for no reason the caller can see.

## 3. The scaffold's `tsconfig` and its own lint config disagree about ES version

Make `create-implement-app`'s kit template emit a `tsconfig.json` whose `lib`
supports the APIs its bundled `oxlint.config.ts` tells you to use.

Out of the box the template writes:

- `tsconfig.json` → `"target": "ES2022"`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]`
- `oxlint.config.ts` → the `unicorn` rules, including `no-array-sort`

`no-array-sort` fires on any `array.sort(...)` and its stated fix is
`Array#toSorted()`, which is ES2023. So obeying the bundled linter breaks the
bundled typechecker:

```
error unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`.
error TS2550: Property 'toSorted' does not exist on type '...[]'.
  Do you need to change your target library? Try changing the 'lib' compiler
  option to 'es2023' or later.
```

`pnpm lint` and `pnpm check` cannot both pass without editing a generated file,
on an operation as common as sorting a list. Bumping the template to ES2023
fixes it (this repo did). This one is cheap to hit and cheap to fix.

## 4. Inline OpenAPI schemas carry a `$schema` of draft-07 inside a 3.1 document

Strip `$schema` from schemas inlined into the OpenAPI document, or set it to the
2020-12 dialect that OpenAPI 3.1 actually uses.

Every generated schema object carries:

```jsonc
"schema": {
  "type": "object",
  "properties": { ... },
  "$schema": "http://json-schema.org/draft-07/schema#"   // ← in a 3.1 document
}
```

The document declares `"openapi": "3.1.0"`, whose schema dialect is JSON Schema
2020-12, not draft-07. It is inherited from the valibot→JSON-Schema converter
rather than chosen, but it ships in the artifact: it is wrong, it is repeated in
every operation, and a strict validator is entitled to complain about it.

## 5. A readable of a node needs `Dynamic`, and the error does not say so

When a `Readable` holding a mountable is passed as a child, say so in the error
and name `Dynamic`.

Writing the reactive branch of a component that swaps a whole node — here, a
priority glyph that changes shape, not just text — the natural thing to reach for
is `Span({}, someReadableOfANode)`. That resolves to text (`ReadableChild`
renders `[object Object]`-ish output) rather than mounting the node, and the
type error that comes out of trying to force it points at `Child` unions rather
than at the helper that does the job.

`Dynamic([priority], (value) => render(value))` is the answer and works
perfectly. This is already on the framework's own MISSING list (#3, "A
`Readable<Mountable>` child, without the wrapper"), so this note is only about
discoverability in the meantime: an error message, or a line in the ForEach/If
docs pointing at `Dynamic`, would have saved the detour.

## 6. The bundled formatter reformats the scaffold's own committed files

Make `create-implement-app`'s generated files already satisfy the `oxfmt` config
it generates next to them (or have `oxfmt.config.ts` ignore `.vscode/`).

On a freshly scaffolded app, `pnpm format` — the template's own script —
rewrites the template's own `.vscode/extensions.json` and
`.vscode/settings.json`, collapsing their arrays:

```diff
 {
-	"recommendations": [
-		"implementjs.implement-vscode",
-		"bradlc.vscode-tailwindcss"
-	]
+	"recommendations": ["implementjs.implement-vscode", "bradlc.vscode-tailwindcss"]
 }
```

So the first `pnpm format` in a new project produces a dirty tree containing
changes to editor config the developer never opened, which then either gets
committed as noise or has to be reverted by hand every time. Same shape as #3:
two halves of one template disagreeing.

---

## Worth saying: `@implementjs/eslint` earned its place

`no-hanging-unsubscribe` caught a real leak in this app that nothing else would
have — a `onChange` on a module-scope signal, subscribed from a page component
that unmounts:

```
error implementjs(no-hanging-unsubscribe): This subscription is never
unsubscribed, and `issueCreated` outlives the function that made it. Return the
unsubscribe from `ImplementLifecycle`'s `onMount`, or keep it and call it
yourself.
```

It named the signal, explained why _that_ signal was the problem (it outlives the
subscriber), and gave the fix. That is a better diagnostic than most framework
lint rules manage, and it found a bug I had written without noticing.
