---
name: implement-packages
description: Documentation links for every official implement package. Use when you need to learn about a package, install a component, or find a solution to a problem you are having in implement.
---

Every implement package publishes its docs as plain markdown. **Fetch the URL exactly as written, with the `.md`.** Dropping it returns the rendered page instead — roughly 90kb of HTML for the same content, because the site is prerendered and served off a CDN, so `Accept: text/markdown` never reaches the server.

Links _inside_ a fetched page already point at the `.md` twins, so following a cross-reference keeps you in markdown.

Fetch the package the task needs — its intro links every other page in that docs section. Do not fetch the whole set.

`@implementjs/ui` is a [jsrepo](https://jsrepo.dev) registry, not an npm library of components. jsrepo copies each component into the project; from then the file is yours.

<!-- pages:start -->

### Framework

- [@implementjs/core](https://implementjs.dev/docs.md) — A signal-based UI framework with fine-grained reactivity, good ergonomics, and no compiler.
- [@implementjs/router](https://implementjs.dev/docs/router.md) — A typed route-tree router with params as signals, persistent layouts, typed links, and URL-synced search params.
- [@implementjs/kit](https://implementjs.dev/kit.md) — File-based routing, SSR, and prerendering for implement apps.
- [@implementjs/vite](https://implementjs.dev/docs/vite.md) — How the apps run on Vite — the four-line HMR recipe and the package entrypoints.

### Components

- [@implementjs/primitives](https://implementjs.dev/primitives/docs.md) — Unstyled, composable building blocks for common UI patterns.
- [@implementjs/ui](https://implementjs.dev/ui.md) — Styled components built on the primitives, copied into your project with jsrepo.

### Forms

- [@implementjs/formish](https://implementjs.dev/formish.md) — Schema-first forms for implement — typed fields, validation, and field arrays.

### Theming

- [@implementjs/mode-watcher](https://implementjs.dev/mode-watcher.md) — Dark mode for a site — the visitor's choice, the system preference, and the class on the html element.

### Icons

- [@implementjs/lucide](https://implementjs.dev/lucide.md) — The full Lucide icon set as implement components.

### Tooling

- [create-implement-app](https://implementjs.dev/create.md) — Scaffold a new implement app from the command line.
- [@implementjs/eslint](https://implementjs.dev/eslint.md) — Framework-aware lint rules for implement apps — leaked subscriptions, broken ARIA, and Lifecycle that could be Effect.

### Adapters

- [@implementjs/adapter-static](https://implementjs.dev/kit/adapters.md) — Builds an implement kit app into static files for any static host.
- [@implementjs/adapter-node](https://implementjs.dev/kit/adapters.md) — Builds an implement kit app into a standalone Node server.
- [@implementjs/adapter-vercel](https://implementjs.dev/kit/adapters.md) — Builds an implement kit app for Vercel, through the Build Output API.
- [@implementjs/adapter-cloudflare](https://implementjs.dev/kit/adapters.md) — Builds an implement kit app into a Cloudflare worker with static assets beside it.

<!-- pages:end -->

## Related skills

- **implementjs** — `@implementjs/core`: elements, signals, control flow, lifecycle, and context. Full page index.
- **implementjs-kit** — `@implementjs/kit`: file-based routing, data loading, server routes, and adapters.
