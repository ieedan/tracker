import { defineConfig } from "oxlint";

export default defineConfig({
	plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
	// The framework's own rules. They are an ESLint plugin, run here through oxlint's
	// ESLint-compatible plugin API — see https://implementjs.dev/eslint.
	jsPlugins: ["@implementjs/eslint"],
	categories: {
		correctness: "error",
		suspicious: "warn",
	},
	rules: {
		// Signal callbacks commonly reuse the signal name for the unwrapped value.
		"no-shadow": "off",
		// CSS imports are side-effect-only by design in Vite apps.
		"import/no-unassigned-import": ["warn", { allow: ["**/*.css"] }],
		"implementjs/no-hanging-unsubscribe": "error",
		"implementjs/no-html": "error",
		"implementjs/no-redundant-roles": "warn",
		"implementjs/no-signal-collection": "warn",
		"implementjs/no-signal-condition": "error",
		"implementjs/prefer-effect": "warn",
		"implementjs/prefer-foreach": "error",
		"implementjs/role-has-required-aria-props": "error",
		"implementjs/role-supports-aria-props": "error",
		"implementjs/valid-aria": "error",
		"implementjs/valid-role": "error",
	},
	ignorePatterns: ["dist/**", ".implement/**"],
	overrides: [
		{
			// `export {}` is what makes an ambient file a module, which is what `declare global`
			// needs — src/app.d.ts ends on one, and it is not an export anybody wrote by mistake.
			files: ["**/*.d.ts"],
			rules: {
				"unicorn/require-module-specifiers": "off",
			},
		},
	],
});
