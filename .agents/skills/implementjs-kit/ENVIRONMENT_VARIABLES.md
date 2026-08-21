# Environment Variables

Environment variables are where secrets get spilled. A build tool that inlines the wrong string into a JavaScript bundle publishes it permanently, and a prerendered site has no server to patch afterwards. Kit's answer is two files, distinguished by name and enforced by the compiler:

- `src/lib/env.public.ts` is safe to ship. It gets inlined into the browser bundle.
- `src/lib/env.server.ts` never ships. The client copy contains no values at all.

Both are ordinary TypeScript modules you write, so `typeof env` flows straight through to every file that imports one. Nothing is code generated.

## Declaring variables

Each file calls `defineEnv` with a schema per variable and exports the result:

```ts
// src/lib/env.public.ts
import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

export const env = defineEnv({
	PUBLIC_DOCS_URL: z.url(),
});
```

```ts
// src/lib/env.server.ts
import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

export const env = defineEnv({
	DATABASE_URL: z.string(),
	STRIPE_KEY: z.string().startsWith("sk_"),
});
```

The schemas are [Standard Schema](https://standardschema.dev), so zod, valibot, arktype, or anything else implementing the spec will work. Kit never imports the library itself, so the choice is yours and it costs the bundle nothing. Keep the schema library in `devDependencies`, since it is only ever used at build time.

Then import them where you need them:

```ts
// src/routes/blog/page.server.ts
import { env } from "@/lib/env.server";
import { env as publicEnv } from "@/lib/env.public";

export default async function load() {
	return {
		posts: await query(env.DATABASE_URL),
		docs: publicEnv.PUBLIC_DOCS_URL,
	};
}
```

`src/hooks.server.ts` reads them the same way, one ordinary import with no special access:

```ts
// src/hooks.server.ts
import { env } from "@/lib/env.server";
import type { Handle } from "@implementjs/kit/server";

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await verify(event.request, env.SESSION_SECRET);
	return await resolve(event);
};
```

`env.DATABASE_URL` is a `string` because that is what `z.string()` produces. Give a variable `z.coerce.number()` and it arrives as a number. The editor knows, with no annotations and no `./$types` involved.

Server code takes two imports rather than one merged object. That is deliberate. A merged `env` would leave TypeScript seeing only one file's keys, and a call site that reads `env.DATABASE_URL` should be visibly different from one that reads `env.PUBLIC_DOCS_URL`.

## The PUBLIC_ prefix

Every key in `env.public.ts` **must** start with `PUBLIC_`, and no key in `env.server.ts` may. This is fixed and not configurable.

The rule exists because the type system was never going to catch the mistake that actually happens, which is pasting `DATABASE_URL` into the public file. A prefix is something you can see at every call site:

```ts
// src/lib/env.public.ts
export const env = defineEnv({
	DATABASE_URL: z.string(), // build error: must start with PUBLIC_
});
```

The error names the key and points at the other file.

## Where the values come from

Kit reads the raw values with Vite's own `.env` resolution and no prefix filter, so the whole file is visible, not just `VITE_` prefixed keys:

```
.env
.env.local
.env.[mode]
.env.[mode].local
```

Later files win, and anything already set in the real environment wins over all of them, which is how CI and hosting providers inject values.

```sh
# .env
PUBLIC_DOCS_URL=https://implement.dev
DATABASE_URL=postgres://localhost:5432/app
```

Commit a `.env.example` listing the keys with blank values and keep `.env` out of git. The scaffolded app sets both up for you.

> [!NOTE]
> Don't read `process.env` from an env file expecting `.env` to work. Vite's `loadEnv` deliberately does not populate `process.env`, which is exactly why kit sources the values itself and hands them to `defineEnv`.

## What actually gets built

Kit evaluates both files in Node during the build, validates them, and re-emits each one as a module of literals. The schemas, and the schema library, never enter a bundle:

| File            | Server (dev requests, prerender) | Browser bundle                 |
| --------------- | -------------------------------- | ------------------------------ |
| `env.public.ts` | literals                         | literals                       |
| `env.server.ts` | literals                         | **a throwing body, no values** |

Every export of these files is inlined, not just the `defineEnv` call, which means **every export must be JSON serializable**. A helper function in `env.public.ts` fails the build by name rather than silently vanishing:

```
src/lib/env.public.ts is evaluated at build time and its exports are inlined;
"formatUrl" is a function and cannot be inlined. Please move it to another module.
```

The browser copy of `env.server.ts` is the part worth internalising. It does not contain the secret in disabled form, or behind a check. It contains no values at all. Even a total failure of every other safeguard leaks nothing.

## Importing a server file from the browser

`env.server.ts` is a server file under the same rule that governs `db.server.ts`: anything named `*.server.ts` is server only. Kit enforces that in two layers.

**It fails the build, and names the importer.** A client module importing a server file is an error in dev and on build, and the error says which module reached for it, under the specifier it used:

```
src/lib/env.server.ts is a server file and cannot be imported by client code.

  src/lib/env.server.ts
  imported by src/routes/blog/page.ts as "@/lib/env.server"

Server files run only on the server, their values never reach the browser.
```

When the importer is itself pulled in by something else, each step up is listed under it with a `←`, so an import buried a few modules deep still shows how it got there.

**And the module itself throws.** If anything slips past the static check, like a computed dynamic import or a re-export chain, the empty client copy throws the moment it is evaluated. That matters more here than it might elsewhere, because kit server renders every page in dev, so a page importing `env.server.ts` renders perfectly on the server and the mistake would otherwise stay invisible until the secret was already sitting in a prerendered HTML file.

### Types are fine

Importing a _type_ from a server file is legal and common, since type imports are erased before the module graph ever sees them:

```ts
import type { PackageInfo } from "../../routes/packages/page.server";
```

Write `import type`, not an inline `type` specifier. Under `verbatimModuleSyntax` (which scaffolded apps enable) the inline form leaves a real import behind and trips the guard:

```ts
import { type PackageInfo } from "./page.server"; // trips the guard
import type { PackageInfo } from "./page.server"; // fine
```

Vite's resource queries are left alone too. `import source from "./x.server.ts?raw"` asks for the file's _text_, not its bindings, which is a deliberate act. It ships the file's source, so don't reach for it on a file whose source contains anything secret.

## Validation and failing builds

Validation runs when a file is first transformed, and a missing or malformed variable **fails the build**. There is no opt out. Every failing key is reported at once:

```
src/lib/env.server.ts: 2 variables failed validation.

  DATABASE_URL - not set
  STRIPE_KEY - Invalid input: must start with "sk_"

Set them in a .env file or in the environment.
```

Two things keep this from being annoying:

- **It is lazy at module granularity.** An app that never imports `env.server.ts` never transforms it and never validates it.
- **`sync()` is env unaware.** A CI job running `check` or `tsc --noEmit` needs no `.env` at all, because generating types never touches these files.

What is left is a `vite build` for an app whose loads read `DATABASE_URL`. That build genuinely cannot produce correct output without it, so failing is the honest result.

## Scope: server variables are build time secrets

Kit has no production server yet. The build prerenders, so a server env var is read **once, during `vite build`**, not per request. `DATABASE_URL` is the credential your build uses to fetch content, not one a running server holds.

That is a real simplification: everything can be static, and there is no dynamic counterpart to reason about. It also means the story changes when a server adapter lands and non-GET endpoints can ship. Runtime environment values are additive work for that phase.

## Running outside kit

`defineEnv` is not magic, and the transform is a secret scrubber and an optimisation rather than the only code path. Run one of these files under plain `node` or `vitest` and it validates against `process.env` instead, returning the same shape. The files stay honest, and they stay unit testable.

## Options

Both paths are configurable, relative to your Vite root:

```ts
kit({
	env: {
		public: "src/lib/env.public.ts",
		server: "src/lib/env.server.ts",
	},
});
```

A file that doesn't exist simply turns that half off, and an app with neither behaves exactly as it did before.
