# How to create and structure an `@implementjs/kit` app

`@implementjs/kit` is the fastest way to build an implement app. You write pages and layouts as files under `src/routes`, and kit turns them into a fully wired [router](./ROUTER.md) with typed params, server side rendering in dev, and a prerendered static site on build.

If you have used SvelteKit this will feel familiar. The conventions were borrowed on purpose.

Under the hood kit is just a Vite plugin. It scans your routes directory, generates the router for you, and serves everything through `@implementjs/vite`'s SSR dev server and prerenderer. There is no runtime of its own, what ships to the browser is the same `@implementjs/core` router you could have written by hand.

## Creating an app with the CLI

`create-implement-app` writes all of this for you, and kit is its default template:

```sh
npm create implement-app@latest
```

The other package managers spell it much the same way:

```sh
pnpm create implement-app
yarn create implement-app
bun create implement-app
```

That leaves you with a routed app, a layout, an error page, and `.implement/` already generated, so it typechecks and runs straight away.

Every prompt has a matching flag, so the same command runs unattended:

```sh
npm create implement-app@latest my-app -- --template kit --tailwind --install --yes
```

npm needs the `--` before the flags, the other package managers pass them straight through. Prompts are also skipped whenever there is no terminal attached, so if you are scaffolding an app as an agent you drive the whole thing with flags and nothing blocks.

`--install` is worth passing for the kit template specifically: on top of installing dependencies it runs `sync`, so `.implement/` exists and the app typechecks immediately.

The full flag list lives in the [implementjs](../implementjs/GETTING_STARTED.md) skill's getting started guide, it is the same CLI.

## Setting an app up manually

kit is a build tool, so it goes in `devDependencies`:

```sh
npm install @implementjs/core
npm install -D @implementjs/kit vite typescript @types/node
```

`@types/node` is there for the Vite config, which runs in Node rather than in the browser.

Then add the plugin to your Vite config:

```ts
// vite.config.ts
import { kit } from "@implementjs/kit";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [kit()],
});
```

Point `src/index.html` at the generated client entry. Vite normally only serves an `index.html` sitting at the project root, so kit serves the one under `src/` itself and moves it back to the root of `dist/` on build. A root `index.html` still works if you prefer it there:

```html
<!-- src/index.html -->
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>my-app</title>
		<script type="module" src="/.implement/entry-client.ts"></script>
	</head>
	<body id="root"></body>
</html>
```

Extend the generated tsconfig so route files can import their types:

```jsonc
// tsconfig.json
{
	"extends": ["./.implement/tsconfig.json"],
	"compilerOptions": {
		"target": "ES2022",
		"lib": ["ES2022", "DOM", "DOM.Iterable"],
		"module": "ESNext",
		"moduleResolution": "bundler",
		"strict": true,
		"noEmit": true,
		"skipLibCheck": true,
		"isolatedModules": true,
		"verbatimModuleSyntax": true,
		"noUncheckedIndexedAccess": true,
		"noUncheckedSideEffectImports": true,
		// the implement packages export their TypeScript source
		"allowImportingTsExtensions": true,
		"types": ["node", "vite/client"],
	},
	"include": [
		"src/**/*.ts",
		"scripts/**/*.ts",
		"*.config.ts",
		".implement/**/*.ts",
		".implement/types/**/*.d.ts",
	],
}
```

The generated config it extends only contributes the `rootDirs` that make `./$types` resolve and the `paths` mirroring kit's import aliases, so the rest of the compiler options are yours to set.

Add the scripts. `implement-kit sync` is the one that isn't obvious: it writes `.implement/` without running Vite, so a fresh clone can typecheck before anything has started a dev server:

```json
{
	"type": "module",
	"scripts": {
		"dev": "vite",
		"build": "vite build",
		"preview": "vite preview",
		"sync": "implement-kit sync",
		"prepare": "implement-kit sync || echo ''",
		"check": "implement-kit sync && tsc --noEmit"
	}
}
```

`prepare` runs on install, which is what makes a fresh clone work without anyone remembering to sync. The `|| echo ''` keeps a failure there from failing the install itself.

`implement-kit` is a bin on `@implementjs/kit`, so it is there as soon as the package is installed. See [The implement-kit CLI](#the-implement-kit-cli) for what it does.

Then make a `src/routes/page.ts` that default exports a component and run `vite`:

```ts
// src/routes/page.ts
import { H1 } from "@implementjs/core";

export default function Page() {
	return H1("Hello, Kit!");
}
```

## What the project looks like

This is what the `kit` template generates:

```
my-app/
├ src/
│  ├ lib/
│  │  ├ counter.ts     @/lib is aliased here: components, helpers, state
│  │  └ env.public.ts  typed environment variables safe to ship
│  ├ routes/
│  │  ├ about/
│  │  │  └ page.ts     → /about
│  │  ├ error.ts       the 404 / render error page
│  │  ├ layout.ts      wraps every page
│  │  └ page.ts        → /
│  ├ app.css           global styles, imported from the root layout
│  ├ app.d.ts          App.Locals: what src/hooks.server.ts hands your routes
│  └ index.html        the shell, pointed at the generated client entry
├ static/              served from the site root
├ .env                 values for the env files (gitignored)
├ .env.example         the same keys with blank values (committed)
├ tsconfig.json
├ vite.config.ts
└ package.json
```

| Script    | What it does                                  |
| --------- | --------------------------------------------- |
| `dev`     | Start the dev server (server rendered, HMR)   |
| `build`   | Prerender the site into `dist/`               |
| `preview` | Serve the build locally                       |
| `sync`    | Regenerate `.implement/` without running vite |
| `check`   | Sync, then typecheck the app                  |

`src/routes` is the routing tree. Every file in it is a page, layout, error page, load function, or endpoint, and everything else in there is colocated code kit ignores. See [Router](./ROUTER.md) for the conventions.

`src/lib` is for everything that isn't a route: components, utilities, shared state. Kit aliases `@/lib` to it automatically, in Vite and (through the generated tsconfig) in TypeScript, so imports stay flat no matter how deep the importing file sits:

```ts
import { Button } from "@/lib/components/button";
```

`src/index.html` is the html shell. Nothing about it is special beyond the mount target and the script tag pointing at `/.implement/entry-client.ts`.

`src/app.d.ts` declares `App.Locals`, the shape `src/hooks.server.ts` puts on `event.locals` and your loads and endpoints read back:

```ts
declare global {
	namespace App {
		// what src/hooks.server.ts puts on event.locals, and routes read
		interface Locals {}
	}
}

export {};
```

`src/hooks.server.ts` runs on every server request. It isn't scaffolded and it isn't required, add it when you need middleware.

`src/lib/env.public.ts` and `src/lib/env.server.ts` are the typed environment variables, covered in [Environment Variables](./ENVIRONMENT_VARIABLES.md). The template writes the public one plus a `.env` and a `.env.example`.

`static/` is for assets served as-is from the site root, so `static/favicon.svg` is available at `/favicon.svg`. Vite serves the directory directly in dev and copies it into `dist/` on build. It's Vite's [`publicDir`](https://vite.dev/config/shared-options#publicdir) pointed at `static`, so set `publicDir` yourself if you want a different folder.

Global stylesheets live at the root of `src` and get imported from the root layout:

```ts
// src/routes/layout.ts
import "../app.css";
```

## The .implement directory

When kit runs it writes a `.implement/` directory next to your Vite config:

```
.implement/
├ types/
│  ├ src/routes/**/$types.d.ts   the per-route types pages import from "./$types"
│  ├ $implement.d.ts             the declaration for the $implement/router module
│  └ app.d.ts
├ .gitignore
├ entry-client.ts
├ entry-server.ts
└ tsconfig.json
```

The whole thing is gitignored (kit writes the `.gitignore` too) and regenerates itself, so you never edit anything in there. Stale `$types` files from routes you deleted are pruned on the next run.

Because the files are written by the dev server and the build, a fresh clone won't have them yet. That is what `implement-kit sync` is for, and it is why the scaffolded app runs it from `prepare` and again before `tsc`.

## The implement-kit CLI

`@implementjs/kit` ships one bin, and it has one command:

```sh
implement-kit sync
```

It writes `.implement/` (the entries, the tsconfig your app extends, and a `./$types` per route) without running Vite, for `check` scripts, editors, and CI, where `tsc` needs the generated files but nothing has started a dev server.

It takes the codegen options straight out of your app: it loads `vite.config.ts` the way Vite does, finds the `kit()` plugin in it, and runs with the options that plugin was given. There is nothing to keep in step by hand, so a `routes` or `alias` option set in the Vite config is automatically the one sync uses.

| Flag              | What it does                                                 |
| ----------------- | ------------------------------------------------------------ |
| `--config <file>` | Use this Vite config instead of the one Vite would find      |
| `--mode <mode>`   | Mode to load the Vite config with. Defaults to `development` |
| `-h, --help`      | Show the help text                                           |
| `-v, --version`   | Print the version                                            |

Run it from the app directory, the same place you would run `vite`.

The programmatic version is still exported for anything the CLI doesn't cover, and it takes the same options `kit()` does:

```ts
import { sync } from "@implementjs/kit/sync";

sync("/path/to/app", { routes: "src/routes", alias: { "@/content": "src/content" } });
```

## Server rendering and the build

Kit apps are server rendered and you don't turn it on, it's how kit serves your app.

**In dev** every page the dev server sends is rendered on the server first, so content paints before any JavaScript loads. When the client bundle arrives, `App.render` swaps the server markup for its own mount and the app takes over. The practical consequence is that your route modules run in Node during dev, so a page that touches `window` or `document` at module scope will break the server render. Do DOM work inside components or behind lifecycle hooks.

**On build** `vite build` produces a static site. Kit renders your routes to HTML and writes one `index.html` per route into `dist/`, so any static host can serve the app with real content in every page. The routes it prerenders come from three places: every page without params (known from the file tree), a crawl of the internal links reachable from `/`, and any entries you list yourself for dynamic pages nothing links to:

```ts
kit({
	prerender: {
		entries: () => posts.map((post) => `/blog/${post.slug}`),
	},
});
```

`entries` is a list of paths or a function returning one (async is fine). If you have a root `error.ts`, the build also renders it into a `404.html`, which most static hosts serve for unknown URLs automatically.

`kit({ prerender: false })` turns prerendering off. You still get the SSR dev server, the build just stops at the client bundle, and you'll need to serve it with an SPA fallback so deep links resolve to `index.html`.

## Options

`kit()` takes five options:

- `routes` is the routes directory relative to your Vite root. Defaults to `"src/routes"`.
- `hooks` is the server hooks file relative to your Vite root. Defaults to `"src/hooks.server.ts"`.
- `prerender` is `false` to skip prerendering on build, or `{ entries }` to add dynamic routes to it.
- `env` is where the two environment variable files live, relative to your Vite root. Defaults to `src/lib/env.public.ts` and `src/lib/env.server.ts`, and a file that isn't there turns that half off. See [Environment Variables](./ENVIRONMENT_VARIABLES.md).
- `alias` is extra import aliases on top of the automatic `@/lib`, mapped to paths relative to your Vite root. Like `@/lib`, each one is wired into both Vite and the generated tsconfig, so the bundler and the typechecker always agree:

```ts
kit({
	alias: {
		"@/content": "src/content",
		// a file target aliases a single module
		"@utils": "src/lib/utils.ts",
	},
});
```

`implement-kit sync` reads this map out of the Vite config, so a check script needs no copy of it.
