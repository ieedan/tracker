/**
 * Handing the finished environment to Vercel, and deploying.
 */
import { KNOWN_KEYS, ENV_FILE } from "../lib/env-file.ts";
import { runScript, scriptCommand } from "../lib/exec.ts";
import * as vercel from "../lib/vercel.ts";
import { askConfirm, color, fail, instructions, ok, spinner, warn } from "../lib/ui.ts";
import type { Step } from "../lib/types.ts";

export const pushToVercel: Step = {
	name: "vercel",
	async run(ctx) {
		const target: vercel.VercelTarget = ctx.mode === "preview" ? "preview" : "production";
		const file = ENV_FILE[ctx.mode];

		if (!vercel.isInstalled()) {
			instructions({
				title: "Vercel",
				url: "https://vercel.com",
				steps: [
					`Settings → Environment Variables, switch to ${target === "preview" ? "Preview" : "Production"}.`,
					`Paste the contents of ${file} into the import box.`,
				],
				after: ["`npm i -g vercel` lets setup do this for you next time."],
			});
			await askConfirm("Done?", true);
			return;
		}

		if (!(await askConfirm(`Push these to Vercel's ${target} environment?`, true))) {
			warn(`Skipped — ${file} is on disk to paste in later.`);
			return;
		}

		const linked = await vercel.link(ctx.options.cwd);
		if (!linked.ok) {
			warn("Linking failed; paste the file into the dashboard instead.");
			return;
		}
		if (linked.configured) ok("project settings: Other, pnpm build");
		else warn("Set Framework Preset to Other in Vercel → Settings → Build and Deployment.");

		const entries = KNOWN_KEYS.map((key) => [key, ctx.data.values[key] ?? ""] as const).filter(
			([, value]) => value !== "",
		);

		const progress = spinner();
		progress.start(`pushing ${entries.length} variables`);
		const failures: string[] = [];
		for (const [key, value] of entries) {
			progress.message(key);
			if (!vercel.setEnv(key, value, target)) failures.push(key);
		}
		progress.stop(
			failures.length === 0
				? `pushed ${entries.length} variables to ${target}`
				: `pushed ${entries.length - failures.length} of ${entries.length}`,
		);

		if (failures.length > 0) fail(`add these by hand: ${failures.join(", ")}`);
		ctx.data.choices.pushedToVercel = failures.length === 0;
	},
};

export const deploy: Step = {
	name: "deploy",
	async run(ctx) {
		if (!vercel.isInstalled()) {
			warn(`Deploy with \`${scriptCommand("build")} && vercel deploy --prebuilt --prod\`.`);
			return;
		}

		if (!(await askConfirm("Build and deploy now?", false))) {
			warn(`Deploy with \`${scriptCommand("build")} && vercel deploy --prebuilt --prod\`.`);
			return;
		}

		if (!vercel.isLinked(ctx.options.cwd) && !(await vercel.link(ctx.options.cwd)).ok) {
			warn("Linking failed; deploy from a linked directory instead.");
			return;
		}

		if (runScript("build", ctx.data.values) && vercel.deploy(true)) {
			ok(`deployed to ${color.cyan(ctx.data.values.BETTER_AUTH_URL ?? "")}`);
		} else {
			fail("failed — see the output above");
		}
	},
};
