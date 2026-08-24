import { defineConfig } from "jsrepo";

export default defineConfig({
	registries: ["@implementjs/ui"],
	// every component is typed `ui`, and the `cn` they all share is a `lib`
	paths: {
		ui: "src/lib/components/ui",
		lib: "src/lib",
	},
});
