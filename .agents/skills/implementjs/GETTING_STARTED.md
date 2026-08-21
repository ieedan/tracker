# How to create and structure an `@implementjs/core` app

`@implementjs/core` is the whole framework: signals, element factories, control flow, and a router, all in plain TypeScript. There is no compiler and no framework build step, so any bundler that can resolve a package will run it. [Vite](https://vite.dev) is what the templates use and what the rest of this skill assumes.

If you want file based routing, server rendering, and a prerendered build on top of core, you want `@implementjs/kit` instead. Read the [implementjs-kit](../implementjs-kit/SKILL.md) skill for that one.

## Creating an app with the CLI

`create-implement-app` writes a working app for you:

```sh
npm create implement-app@latest
```

The other package managers spell it much the same way:

```sh
pnpm create implement-app
yarn create implement-app
bun create implement-app
```

It asks three questions (where the app goes, which template to start from, and which addons to set up) and then writes an app you can `dev` immediately.

Every prompt has a matching flag, so the same command runs unattended:

```sh
npm create implement-app@latest my-app -- --template csr --tailwind --yes
```

npm needs the `--` before the flags, the other package managers pass them straight through. Prompts are also skipped whenever there is no terminal attached, so if you are scaffolding an app as an agent you drive the whole thing with flags and nothing blocks. `--yes` is only needed when a terminal _is_ attached.

There are two templates. `--template csr` is the plain core app this document covers, `--template kit` (the default) is the full stack one. Both render the same counter page, so the difference you see is the shape of the project, not the demo.

### Project flags

| Flag             | What it does                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `--name <name>`  | The name written into `package.json`. Defaults to the directory name, normalized into something npm accepts. |
| `-t, --template` | `kit` or `csr`.                                                                                              |
| `--tailwind`     | Set up Tailwind. `--no-tailwind` opts out.                                                                   |
| `--primitives`   | Add `@implementjs/primitives`. `--no-primitives` opts out.                                                   |
| `--ui`           | Add `@implementjs/ui`. Turns on `--tailwind` and `--primitives`, `--no-ui` opts out.                         |
| `--icons`        | Add `@implementjs/lucide`. `--no-icons` opts out.                                                            |
| `--forms`        | Add `@implementjs/formish` and valibot. `--no-forms` opts out.                                               |
| `--mode-watcher` | Add `@implementjs/mode-watcher`. `--no-mode-watcher` opts out.                                               |
| `--overwrite`    | Scaffold into the directory even if it already has files in it.                                              |

Without `--overwrite` a non-empty directory stops the run.

### Flags for what happens after scaffolding

| Flag                | What it does                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--install`         | Install dependencies. With `--ui` it also runs `jsrepo add button`, the one component the starter page renders. |
| `--git`             | Run `git init` in the new directory.                                                                            |
| `--package-manager` | `npm`, `pnpm`, `yarn`, `bun`, or `deno`. Detected from the environment otherwise.                               |
| `-y, --yes`         | Skip every prompt, using defaults for anything a flag didn't answer.                                            |
| `--cwd <path>`      | Resolve relative paths against this directory instead of the current one.                                       |
| `--verbose`         | Log each step instead of collapsing it into a spinner.                                                          |

The package manager is picked up from how you invoked the CLI, so `pnpm create implement-app` installs with pnpm without being told.

## Setting an app up manually

Adding implement to a project you already have takes one dependency:

```sh
npm install @implementjs/core
npm install -D vite typescript
```

That's all the framework needs. The package exports point at its TypeScript source, so there is no plugin to install and no framework build step to configure.

An app needs four files.

**`package.json`** wires up the scripts:

```json
{
	"name": "my-app",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"scripts": {
		"dev": "vite",
		"build": "vite build",
		"preview": "vite preview",
		"check": "tsc --noEmit"
	}
}
```

**`vite.config.ts`** points Vite at `src/`, so `index.html` can live next to the app instead of at the project root:

```ts
import { defineConfig } from "vite";

export default defineConfig({
	root: "src",
	build: { outDir: "../dist", emptyOutDir: true },
});
```

Leaving `root` alone works too, you just have to keep `index.html` at the project root, which is what Vite expects by default.

**`src/index.html`** is the page Vite serves. The only thing it needs is an element to mount into and a module script pointing at the entry:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>my-app</title>
		<script type="module" src="/index.ts"></script>
	</head>
	<body id="root"></body>
</html>
```

**`src/index.ts`** creates the app and mounts something into it:

```ts
import { App } from "@implementjs/core";
import { Counter } from "./counter";
import "./app.css";

const app = App({ target: document.getElementById("root")! });

// HMR: vite needs the accept call to be statically present in the entry, and the app tears down
// every root it rendered before the entry re-runs, so edits patch the page instead of reloading it.
if (import.meta.hot) {
	import.meta.hot.accept();
	import.meta.hot.dispose(app.unmount);
}

app.render(Counter());
```

`App({ target })` creates the root, and `app.render(...children)` mounts children into it and returns an unmount function for that root. `app.unmount` tears down every root the app rendered, which is what makes the four line HMR block work: Vite bubbles an update up to the entry, runs the dispose hook so the old tree unmounts, and re-executes the entry against the updated modules. The page patches in place instead of reloading, and module state outside the update's import chain survives. In a production build `import.meta.hot` is statically `false`, so the block compiles away.

Vite needs the `accept` call to be written in the entry module itself. It statically scans each module's source for it, so it cannot be hidden inside a helper or inside the framework.

**`tsconfig.json`** is the last piece. The one setting worth calling out is `allowImportingTsExtensions`, which the implement packages need because they export their TypeScript source rather than compiled output:

```jsonc
{
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
		"types": ["vite/client"],
	},
	"include": ["src/**/*.ts", "*.config.ts"],
}
```

Then write a component and you have an app:

```ts
// src/counter.ts
import { Button, Div, H1, signal } from "@implementjs/core";

export function Counter() {
	const count = signal(0);

	return Div(H1("Counter"), Button({ onClick: () => count.increment() }, "Count: ", count));
}
```

`Counter` is a plain function. It runs **once**, there is no re-render. `signal(0)` is a writable value, and passing it as a child creates a text node that updates whenever the signal changes. See [Markup](./MARKUP.md) and [Signals](./SIGNALS.md) for the rest.

## What the project looks like

The `csr` template writes this, and it is the shape to follow when you set one up by hand:

```
my-app/
├ src/             the vite root
│  ├ app.css       global styles, imported from src/index.ts
│  ├ counter.ts    the component the page renders
│  ├ index.html    the page vite serves
│  └ index.ts      creates the app and mounts it into #root
├ tsconfig.json
├ vite.config.ts
└ package.json
```

| Script    | What it does                       |
| --------- | ---------------------------------- |
| `dev`     | Start the dev server with HMR      |
| `build`   | Build the static site into `dist/` |
| `preview` | Serve the build locally            |
| `check`   | Typecheck the app                  |

The whole app lives under `src/`, `index.html` included, which is why the Vite config sets `root: "src"` and points the build back at `dist/`.

Beyond that there are no conventions to follow. There is no routes directory and no file that has to be named a certain way, because nothing in core scans the filesystem. Group your components however you like, and import them by relative path or by an alias you add to the Vite config and the tsconfig yourself.

Everything is exported from the package root, and the bigger subsystems are also importable on their own if you would rather be explicit:

```ts
import { App, signal } from "@implementjs/core"; // everything
import { Div, Button } from "@implementjs/core/elements"; // the HTML element factories
import { Router } from "@implementjs/core/router"; // the router
```

### A note on pnpm

An app installed with pnpm also needs a `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```

pnpm won't run a dependency's install scripts until the project names it, and since pnpm 11 an unnamed one fails the install with `ERR_PNPM_IGNORED_BUILDS` instead of warning. Vite's transformer, esbuild, downloads its platform binary in a `postinstall`, so without that file the very first `pnpm install` stops. The other package managers don't need it, and neither does an app inside a workspace that already answers to the root's file.
