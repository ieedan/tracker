import { kit } from "@implementjs/kit";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		kit({
			api: {
				client: { errors: "neverthrow", style: "method" },
			},
		}),
	],
});
