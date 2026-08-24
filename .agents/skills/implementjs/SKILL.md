---
name: implementjs
description: Use `@implementjs/core` to build apps with implementjs. Write markup, use signals for reactivity, and wire up control flow, lifecycle, and context.
---

Implement is a UI library that lets you write your app in pure TypeScript. There is no runtime, no templating, and no compiler — element factories build real DOM nodes, and signals update exactly the parts of the page that depend on them.

## Reading the docs

Every page below is the live documentation, served as plain markdown. **Fetch the URL exactly as written, with the `.md`.** Dropping it returns the rendered page instead — roughly 90kb of HTML for the same content, because the site is prerendered and served off a CDN, so `Accept: text/markdown` never reaches the server.

Links _inside_ a fetched page already point at the `.md` twins, so following a cross-reference keeps you in markdown.

Start with **Introduction** and **Getting Started** if you have not built an implement app before. Otherwise fetch the one or two pages the task needs — the whole set is ~38k tokens, and you almost never want all of it.

<!-- pages:start -->

### Start here

- [Introduction](https://implementjs.dev/docs.md) — A signal-based UI framework with fine-grained reactivity, good ergonomics, and no compiler.
- [Getting Started](https://implementjs.dev/docs/getting-started.md) — Set up a project and render your first component.

### Building UI

- [Elements & Props](https://implementjs.dev/docs/elements.md) — Typed element factories, props, class values, styles, and events.
- [Components](https://implementjs.dev/docs/components.md) — Components are plain functions that run once and return mountables.

### Reactivity

- [Signals](https://implementjs.dev/docs/signals.md) — Writable reactive values with get, set, update, and a toolbox of convenience methods.
- [Derived & Watch](https://implementjs.dev/docs/derived.md) — Compute read-only values from other signals, and run effects when signals change.
- [Bindings](https://implementjs.dev/docs/bindings.md) — Focused views into a signal's value with bind — by path or by selector, one-way or two-way.
- [Reactive collections](https://implementjs.dev/docs/reactive-collections.md) — Real Sets and Maps that notify the DOM when they change, via ImplementSet and ImplementMap.

### Control flow

- [If](https://implementjs.dev/docs/if.md) — Conditional rendering with If, ElseIf, and Else branches driven by signals.
- [Switch](https://implementjs.dev/docs/switch.md) — Match a value against cases with deep equality, with an optional exhaustiveness check.
- [ForEach](https://implementjs.dev/docs/foreach.md) — Keyed list rendering with per-row signals, reordering, and write-back into the source list.
- [Await](https://implementjs.dev/docs/await.md) — Render from a promise's state with WhileLoading, Then, and Catch — and re-follow promises swapped into a signal.
- [Key](https://implementjs.dev/docs/key.md) — Force a full remount of a subtree whenever a signal changes.
- [Dynamic](https://implementjs.dev/docs/dynamic.md) — Mount whatever node a signal is holding, and swap it when the value changes.

### Composition

- [Context](https://implementjs.dev/docs/context.md) — Pass a value down the tree without threading it through every component's props.
- [Lifecycle](https://implementjs.dev/docs/lifecycle.md) — Hook into mount and unmount at a position in the tree — focus, measure, and scope subscriptions.
- [Error Boundaries](https://implementjs.dev/docs/boundary.md) — Catch errors from a subtree's mount and reactive updates, render a fallback, and retry.
- [Portal](https://implementjs.dev/docs/portal.md) — Mount children into another element while keeping them in the logical tree.

### The document

- [Raw HTML](https://implementjs.dev/docs/html.md) — Insert trusted HTML markup as live nodes with the Html helper.
- [SVG](https://implementjs.dev/docs/svg.md) — Render icons and other SVG from trusted markup, with typed reactive props on the root element.
- [Document Head](https://implementjs.dev/docs/head.md) — Manage the title and head tags from anywhere in the tree, scoped to mount lifetime.
- [Window & Document](https://implementjs.dev/docs/global-events.md) — Attach window and document event listeners whose lifetime follows their position in the tree.
- [Media Queries](https://implementjs.dev/docs/media-query.md) — A CSS media query as a readable, so a layout can branch on the viewport the way it branches on any other signal.

### Building applications

- [Router](https://implementjs.dev/docs/router.md) — A typed route-tree router with params as signals, persistent layouts, typed links, and URL-synced search params.
- [Custom nodes](https://implementjs.dev/docs/custom-nodes.md) — Build your own control-flow nodes on the public API — swappable regions with Outlet, and a router in twenty lines.
- [Vite](https://implementjs.dev/docs/vite.md) — How the apps run on Vite — the four-line HMR recipe and the package entrypoints.
- [Putting It All Together](https://implementjs.dev/docs/building-an-app.md) — Assemble everything you've learned into a complete application.
- [Kit](https://implementjs.dev/docs/kit.md) — Skip the wiring — file-based routing, SSR, and prerendering with @implementjs/kit.

<!-- pages:end -->

## Linting

`@implementjs/eslint` lints the mistakes types cannot catch — a discarded unsubscribe, a signal tested for truth, a misspelled `aria-*` key. It runs under ESLint or oxlint, and its docs are their own section: start at <https://implementjs.dev/eslint.md>, which links every rule's page.

## Related skills

- **implementjs-kit** — file-based routing, data loading, server routes, and adapters, for a fullstack app built on `@implementjs/kit`.
- **implement-packages** — every implement package's published markdown docs, including the UI registry.

## Official implement packages

- `@implementjs/*`
- `create-implement-app`
