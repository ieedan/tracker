import adapter from "@implementjs/adapter-vercel";
import { kit } from "@implementjs/kit";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const mcpClientCors = { origin: true as const };

export default defineConfig({
	// Core is a singleton: renderToString installs the server document and
	// location into module state that the router reads back during the same
	// mount. If the dependency graph ever carries two copies of core — e.g. the
	// app's range resolves to a core published minutes before kit's exactly
	// pinned one, as on Vercel's non-frozen install — the second copy sees no
	// server environment and SSR dies on `window is not defined`.
	resolve: { dedupe: ["@implementjs/core"] },
	server: { cors: mcpClientCors },
	preview: { cors: mcpClientCors },
	plugins: [
		tailwindcss(),
		kit({
			adapter: adapter(),
			// implement:bug:#3: `api.openapi.output` is written from the prerender
			// pass's `after` hook, so `prerender: false` silently produces no
			// OpenAPI file and no warning. `{ default: false }` still runs the pass
			// (prerendering nothing, since no route opts in) which is what gets the
			// document written. Every page here is behind a session or reads
			// per-request data, so nothing is frozen at build time either way.
			prerender: { default: false },
			api: {
				openapi: {
					info: {
						title: "tracker API",
						version: "1.0.0",
						description:
							"Issue tracking API. Authenticate with `Authorization: Bearer <api key>`; keys are created in the app under Settings → API keys.",
					},
					// Written into `static/`, so it is served at /openapi.json in dev
					// and shipped as a plain static asset by the host — and the schema
					// library stays out of the production server bundle.
					//
					// implement:bug:#4: the `path` option (which mounts a live route
					// instead) makes the prerender pass try to evaluate a synthetic
					// module `/src/routes/(openapi)` that does not exist, logging an
					// SSR error on every build. Not used here for that reason.
					output: "static/openapi.json",
				},
			},
		}),
	],
});
