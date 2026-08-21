import { DEFAULT_PROVIDERS, defineConfig } from "jsrepo";
import { fs } from "jsrepo/providers";

export default defineConfig({
	// the registry is read off disk, out of the linked implement clone — run `pnpm registry`
	// there after changing a component so the registry.json jsrepo reads is up to date
	registries: ["fs://../implement/apps/docs"],
	providers: [...DEFAULT_PROVIDERS, fs()],
	// every component is typed `ui`, and the `cn` they all share is a `lib`
	paths: {
		ui: 'src/lib/components/ui',
		lib: 'src/lib',
	},
});
