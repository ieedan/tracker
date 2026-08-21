# tracker

An [implement](https://github.com/ieedan/implement) app on [`@implementjs/kit`](https://github.com/ieedan/implement/tree/main/packages/kit) — file
based routing, server rendering in dev, and a prerendered static site on build.

Addons: tailwind, primitives, ui, icons, forms, modeWatcher

## Scripts

| Script    | What it does                                   |
| --------- | ---------------------------------------------- |
| `dev`     | Start the dev server (server rendered, HMR)    |
| `build`   | Prerender the site into `dist/`                |
| `preview` | Serve the build locally                        |
| `sync`    | Regenerate `.implement/` without running vite  |
| `check`   | Sync, then typecheck the app                   |

## Structure

```
tracker/
├ src/
│  ├ lib/            @/lib — components, helpers, state
│  │  └ env.public.ts  typed environment variables, safe to ship
│  ├ routes/         the routing tree
│  │  ├ about/
│  │  │  └ page.ts   → /about
│  │  ├ error.ts     the 404 / render error page
│  │  ├ layout.ts    wraps every page
│  │  └ page.ts      → /
│  ├ app.css         global styles, imported from the root layout
│  └ index.html      the shell, pointed at the generated client entry
└ static/            served from the site root
```

`.env` holds the values `src/lib/env.public.ts` validates; it is gitignored, and
`.env.example` is the committed list of keys. Keys there must start with `PUBLIC_` — add a
`src/lib/env.server.ts` for anything that must not reach the browser.

`page.ts` is a page, `layout.ts` wraps everything below it, and `[param]` / `[...rest]`
directories bind params. Kit generates `.implement/` (entries, the tsconfig this app extends, and
a `./$types` for every route) — it is gitignored and regenerates itself, so nothing in there
needs editing.
