# Bugs

Bugs found in `@implementjs/kit`, `@implementjs/core` and `@implementjs/eslint`
while building this app. Each is written so it can be handed to an agent as-is.

Where a bug is worked around in this repo, the workaround is tagged
`// implement:bug:#<number>` at the site. When a bug is fixed, grep for its tag
and undo the workaround.

Versions: `@implementjs/kit@0.0.11`, `@implementjs/core@0.0.8`,
`@implementjs/router@0.0.9` (resolved by kit, not a direct dependency),
`@implementjs/adapter-vercel@0.0.11`, vite 7.3.6, node 22.

| #   | Area          | One line                                                              | Worked around in                                            |
| --- | ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | kit / OpenAPI | Param matcher name leaks into the generated OpenAPI path template     | `src/routes/api/v1/workspaces/[slug]/issues/[number]/**`    |
| 2   | eslint        | `valid-role` fires on any object property named `role`                | `src/routes/api/v1/workspaces/server.ts`, `scripts/seed.ts` |
| 3   | kit / OpenAPI | `api.openapi.output` writes nothing when `prerender: false`, silently | `vite.config.ts`                                            |
| 4   | kit / OpenAPI | `api.openapi.path` makes every build log an SSR error                 | `vite.config.ts`                                            |

---

## #1 — A param matcher's name leaks into the generated OpenAPI path template

Fix the OpenAPI generator so a route directory using a param matcher
(`[id=integer]`) emits `{id}` in the path template, not `{id=integer}`.

Right now the path key and the parameter object disagree, which makes the
document invalid for that route: a generated client or Swagger UI looks for a
parameter named `number=integer` to fill the template and there isn't one.

Reproduce:

1. `src/params/integer.ts`:
   ```ts
   import { matcher, mismatch } from "@implementjs/kit/params";
   export default matcher((value) => (/^\d+$/.test(value) ? Number(value) : mismatch));
   ```
2. Put a `handler()` endpoint at `src/routes/api/items/[number=integer]/server.ts`.
3. Enable `kit({ api: { openapi: { info: {...}, output: "static/openapi.json" } } })`.
4. Build and read the document.

Observed:

```jsonc
"/api/items/{number=integer}": {          // ← matcher name in the template
  "get": {
    "parameters": [
      { "name": "number", "in": "path", "required": true,
        "schema": { "type": "string" } }   // ← and see #1b below
    ]
  }
}
```

Expected: `"/api/items/{number}"`.

### #1b — the matcher's parsed type is not reflected either

The same parameter is documented as `"type": "string"` even though the matcher
parses it to a `number` (and kit types `params.number` as `number` everywhere
else — pages, loads, handlers, the generated client). The OpenAPI parameter
schema should follow the matcher's output type the way the TypeScript types do.

Note for whoever fixes this: declaring the type through a handler `params`
schema instead _does_ produce `"type": "integer"`, so the conversion path
already exists — it is only the matcher path that does not use it.

**Workaround in this repo:** the API routes do not use the matcher. The
directory is a plain `[number]` and the handler declares
`params: v.object({ slug: v.string(), number: v.pipe(v.string(), v.transform(Number), ...) })`,
which yields a clean `{number}` template and a correct `"type": "integer"`.
Tagged at `src/routes/api/v1/workspaces/[slug]/issues/[number]/server.ts` and
`.../comments/server.ts`. When this is fixed, the matcher can come back and
those `params` schemas can be deleted.

---

## #2 — `valid-role` treats any object property named `role` as an ARIA role

Scope the `valid-role` rule (and its siblings) to element props. It currently
reports on any object literal property named `role`, anywhere in the codebase,
including server-only files that never render an element.

`packages/eslint/src/rules/valid-role.ts`:

```ts
Property(node) {
  if (node.parent.type !== "ObjectExpression") return;
  if (staticKey(node) !== "role") return;   // ← nothing checks that this
                                            //   ObjectExpression is an element
                                            //   props argument
```

Reproduce — a Drizzle insert in a `*.server.ts` file, no element in sight:

```ts
await db.insert(workspaceMember).values({
	id: nanoid(),
	userId: user.id,
	role: "admin",
});
```

```
error implementjs(valid-role): "admin" is not an ARIA role.
```

`role` is an ordinary word — a database column, a config key, a test fixture, an
options bag — so this misfires on real code and the only escape is a disable
comment. Please also check the three sibling rules, which are built the same
way: `role-has-required-aria-props`, `role-supports-aria-props`,
`no-redundant-roles`.

Suggested fix: require the object to be in element-props position (the first
argument of an element factory / `component()` call) before reporting.
`extraRoles` is not a fix — the values here are not roles at all.

**Workaround in this repo:** `// oxlint-disable-next-line implementjs/valid-role`
at the two sites, tagged `implement:bug:#2`.

---

## #3 — `api.openapi.output` silently writes nothing when `prerender: false`

Decouple writing the OpenAPI document from the prerender pass, so
`api.openapi.output` produces a file whatever `prerender` is set to. Failing
that, warn when the option is set but unreachable — right now it fails silently.

The write lives inside the prerender pass's `after` hook
(`packages/kit/src/index.ts`, ~line 538):

```ts
after: async ({ routes: prerendered, outDir, load }) => {
  const scanned = tree ?? scan();
  if (openapi !== undefined) {
    const json = await openApiJson(load, (message) => console.warn(message));
    if (openapi.output !== undefined) {
      write(resolve(root, openapi.output), json);
      ...
```

With `kit({ prerender: false })` the pass never runs, so the hook never fires:
no document is written, no warning is printed, and the build reports success.

Reproduce:

```ts
kit({
	adapter: adapter(),
	prerender: false,
	api: { openapi: { info: { title: "x", version: "1" }, output: "static/openapi.json" } },
});
```

`vite build` → exit 0, and `static/openapi.json` does not exist.

This combination is not exotic: `prerender: false` is the normal setting for any
app whose pages sit behind a session, and such an app is exactly the kind that
wants a documented API. The docs also describe `output` as build-time work in
Node ("`output` alone does the work in Node at build time"), with nothing said
about depending on the prerender.

**Workaround in this repo:** `prerender: { default: false }` in `vite.config.ts`,
tagged `implement:bug:#3`. The pass then runs and prerenders nothing (no route
opts in), which is enough to get the document written. Once fixed, this should
go back to the plain `prerender: false` it wants to be.

---

## #4 — `api.openapi.path` makes every build log an SSR error

Register the synthetic route that `api.openapi.path` mounts so the prerender
pass can resolve it, or exclude it from the pass.

Reproduce — add `path` alongside `output`:

```ts
api: {
  openapi: {
    info: { title: "x", version: "1" },
    output: "static/openapi.json",
    path: "/openapi.json",
  },
}
```

`vite build` prints:

```
[vite] (ssr) Error when evaluating SSR module /src/routes/(openapi):
Failed to load url /src/routes/(openapi) (resolved id: /src/routes/(openapi)).
Does the file exist?
      at loadAndTransform (.../vite/dist/node/chunks/config.js:22739:33)
```

The build still completes, so this is noise rather than a failure — but it is
noise that looks exactly like a real broken import, on every single build, and
it points at a path (`src/routes/(openapi)`) that the app never wrote. Removing
`path` removes the error.

**Workaround in this repo:** `path` is not used. `output` writes into `static/`,
which is served at `/openapi.json` in dev and shipped as a static asset by the
host — so the live route is not needed here. Tagged in `vite.config.ts`.
