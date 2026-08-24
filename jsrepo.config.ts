import { defineConfig } from "jsrepo";

export default defineConfig({
	registries: ["@implementjs/ui"],
	paths: {
		ui: 'src/lib/components/ui',
		lib: 'src/lib',
	},
});
