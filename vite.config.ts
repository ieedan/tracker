import adapter from "@implementjs/adapter-node";
import { kit } from "@implementjs/kit";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Auth, uploads, webhooks, and the API all need a request to be running,
		// so the build has to produce a server rather than a folder of files.
		kit({ adapter: adapter() }),
	],
	ssr: {
		// jsdom and pg are Node libraries; bundling them for SSR breaks their
		// dynamic requires.
		external: ["jsdom", "pg", "minio"],
	},
});
