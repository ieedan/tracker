---
name: implementjs-kit
description: Use `@implementjs/kit` to build fullstack apps with implementjs. File-based routing, data loading, server and API routes, environment variables, and adapters.
---

`@implementjs/kit` is the fullstack framework for implement: you write pages and layouts as files in `src/routes`, and kit generates a typed router, renders on the server, and prerenders or builds for a host through an adapter.

This skill covers kit only. For the UI layer underneath it — markup, signals, control flow — use the **implementjs** skill.

## Reading the docs

Every page below is the live documentation, served as plain markdown. **Fetch the URL exactly as written, with the `.md`.** Dropping it returns the rendered page instead — roughly 90kb of HTML for the same content, because the site is prerendered and served off a CDN, so `Accept: text/markdown` never reaches the server.

Links _inside_ a fetched page already point at the `.md` twins, so following a cross-reference keeps you in markdown.

Start with **Introduction**, which covers project layout, `src/lib`, the generated `.implement/` directory, and the Vite plugin's options. Then fetch the guide the task needs.

<!-- pages:start -->

### Start Here

- [Introduction](https://implementjs.dev/kit.md) — File-based routing, SSR, and prerendering for implement apps.

### Guides

- [Routing](https://implementjs.dev/kit/routing.md) — The file conventions, params, layouts, and generated types.
- [SSR & Prerendering](https://implementjs.dev/kit/ssr-and-prerendering.md) — Server-rendered pages in dev, a prerendered static site on build.
- [Loading Data](https://implementjs.dev/kit/loading-data.md) — Load functions run on the server and feed pages and layouts their data.
- [Server Routes](https://implementjs.dev/kit/server-routes.md) — server.ts endpoints serve raw responses — JSON, markdown, anything.
- [API Routes](https://implementjs.dev/kit/api-routes.md) — Validated handlers, a generated typed client, and an optional OpenAPI document — off one definition.
- [Server Hooks](https://implementjs.dev/kit/hooks.md) — hooks.server.ts runs on every server request — middleware, locals, and error handling.
- [Environment Variables](https://implementjs.dev/kit/environment-variables.md) — Typed environment variables that cannot leak — two files, one validated at build time.
- [Adapters](https://implementjs.dev/kit/adapters.md) — Build the app for the place it runs — a static host, a Node server, Vercel, Cloudflare.
- [Open Graph Images](https://implementjs.dev/kit/og-images.md) — Generate social share images from implement components, one per page, at build time.

<!-- pages:end -->

## Related skills

- **implementjs** — `@implementjs/core`: elements, signals, control flow, lifecycle, and context.
- **implement-packages** — every implement package's published markdown docs, including the UI registry.
