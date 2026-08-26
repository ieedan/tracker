/**
 * One GitHub App covers both halves of the integration: its OAuth credentials
 * sign people in, and its App ID and private key mint the installation tokens
 * that read repositories. That is one registration to make, and one place for
 * callback URLs to be wrong.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import * as v from "valibot";
import { askConfirm, askEnv, askSelect, instructions, required, warn } from "../lib/ui.ts";
import { filled, type Step, type StepContext } from "../lib/types.ts";
import { borrow, set } from "./common.ts";

const GITHUB_KEYS = [
	"GITHUB_CLIENT_ID",
	"GITHUB_CLIENT_SECRET",
	"GITHUB_APP_ID",
	"GITHUB_APP_SLUG",
	"GITHUB_APP_PRIVATE_KEY",
	"GITHUB_APP_WEBHOOK_SECRET",
	"GITHUB_DEV_TOKEN",
	"GITHUB_API_URL",
] as const;

const BLANK: Record<string, string> = {
	GITHUB_CLIENT_ID: "",
	GITHUB_CLIENT_SECRET: "",
	GITHUB_APP_ID: "",
	GITHUB_APP_SLUG: "",
	GITHUB_APP_PRIVATE_KEY: "",
	GITHUB_APP_WEBHOOK_SECRET: "",
	GITHUB_DEV_TOKEN: "",
	GITHUB_API_URL: "https://api.github.com",
};

function carriedOver(ctx: StepContext, ...files: string[]): Record<string, string> {
	const values: Record<string, string> = {};
	for (const key of GITHUB_KEYS) values[key] = borrow(ctx, key, ...files);
	values.GITHUB_API_URL = values.GITHUB_API_URL || "https://api.github.com";
	return values;
}

function looksLikePath(input: string): boolean {
	if (input.endsWith(".pem") || input.endsWith(".key")) return true;
	try {
		const path = resolve(process.cwd(), input);
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

/** `.env` carries newlines badly, so the PEM is stored with `\n` escapes. */
function flatten(pem: string): string {
	return pem.replaceAll("\r\n", "\n").replaceAll("\n", "\\n").trim();
}

function isPem(value: string): boolean {
	const expanded = value.replaceAll("\\n", "\n");
	return expanded.includes("BEGIN") && expanded.includes("PRIVATE KEY");
}

async function askPrivateKey(initial: string): Promise<string> {
	for (;;) {
		const answer = await askEnv({
			key: "GITHUB_APP_PRIVATE_KEY",
			hint: "Path to the .pem GitHub downloaded, or the PEM itself.",
			schema: required("a GitHub App needs a private key"),
			initial,
			secret: true,
		});

		if (answer === initial && isPem(initial)) return initial;

		const raw = looksLikePath(answer)
			? readFileSync(resolve(process.cwd(), answer), "utf8")
			: answer;
		const flattened = flatten(raw);
		if (isPem(flattened)) return flattened;

		warn("That is not a PEM private key.");
	}
}

async function personalAccessToken(
	existing: Record<string, string>,
): Promise<Record<string, string>> {
	instructions({
		title: "Personal access token",
		url: "https://github.com/settings/personal-access-tokens/new",
		rows: [
			["Token name", "tracker-dev"],
			["Repository access", "All repositories, or only the ones you want to try"],
			["Permissions (read-only)", "Contents, Metadata, Pull requests"],
		],
		after: ['A token cannot sign anyone in, so the "Sign in with GitHub" button stays hidden.'],
	});

	return {
		...BLANK,
		// Sign-in credentials belong to whatever app is already registered, and a
		// token has nothing to say about them.
		GITHUB_CLIENT_ID: existing.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: existing.GITHUB_CLIENT_SECRET ?? "",
		GITHUB_API_URL: existing.GITHUB_API_URL ?? "https://api.github.com",
		GITHUB_DEV_TOKEN: await askEnv({
			key: "GITHUB_DEV_TOKEN",
			hint: "A fine-grained personal access token.",
			schema: required("paste the token"),
			initial: existing.GITHUB_DEV_TOKEN ?? "",
			secret: true,
		}),
	};
}

/**
 * Every branch gets its own preview URL, and GitHub takes callback URLs
 * literally — a wildcard is rejected at registration, since a pattern would
 * hand the authorization code to anyone who can stand up a matching host.
 */
const PREVIEW_CALLBACK_NOTE = [
	"Repository linking works on every preview. Sign-in works only on the exact origin above: GitHub matches callback URLs literally and refuses a wildcard, so the per-branch and per-deployment URLs cannot be registered. better-auth's oAuthProxy plugin is what lifts that — it signs in through one registered URL and hands the session back to the preview.",
];

async function githubApp(
	existing: Record<string, string>,
	origin: string,
	appName: string,
	extra: string[] = [],
): Promise<Record<string, string>> {
	instructions({
		title: "GitHub App",
		url: "https://github.com/settings/apps/new",
		rows: [
			["GitHub App name", `${appName}, or anything else unique on GitHub`],
			["Homepage URL", origin],
			["Callback URL", `${origin}/api/auth/callback/github`],
			["Add callback URL", `${origin}/api/v1/github/callback`],
			["Setup URL", `${origin}/api/v1/github/callback`],
			["Request user authorization (OAuth) during installation", "leave unchecked"],
			["Webhook", "uncheck Active"],
			["Account permissions", "Email addresses — Read-only"],
			["Repository permissions", "Contents, Metadata, Pull requests — all Read-only"],
			["Where can this GitHub App be installed?", "Any account"],
		],
		after: [
			"Both callback URLs are needed: the first is where signing in returns, the second is where installing returns. Email addresses is what lets sign-in read an address — without it people arrive with none and cannot be created.",
			"Create the app. The App ID and Client ID are on the next page; the slug is the last part of github.com/apps/<slug>. Generate a client secret and a private key at the bottom.",
			...extra,
		],
	});

	const webhookSecret = existing.GITHUB_APP_WEBHOOK_SECRET;

	return {
		GITHUB_CLIENT_ID: await askEnv({
			key: "GITHUB_CLIENT_ID",
			hint: "The app's Client ID, which starts with Iv23li.",
			schema: required("paste the Client ID"),
			initial: existing.GITHUB_CLIENT_ID ?? "",
		}),
		GITHUB_CLIENT_SECRET: await askEnv({
			key: "GITHUB_CLIENT_SECRET",
			hint: "Generate a client secret on the same page.",
			schema: required("paste the client secret"),
			initial: existing.GITHUB_CLIENT_SECRET ?? "",
			secret: true,
		}),
		GITHUB_APP_ID: await askEnv({
			key: "GITHUB_APP_ID",
			hint: "A number, shown as App ID — not the Client ID.",
			schema: v.pipe(v.string(), v.regex(/^\d+$/, "the App ID is a number")),
			initial: existing.GITHUB_APP_ID ?? "",
		}),
		GITHUB_APP_SLUG: await askEnv({
			key: "GITHUB_APP_SLUG",
			hint: "From https://github.com/apps/<slug>.",
			schema: required("paste the slug"),
			initial: existing.GITHUB_APP_SLUG ?? "",
		}),
		GITHUB_APP_PRIVATE_KEY: await askPrivateKey(existing.GITHUB_APP_PRIVATE_KEY ?? ""),
		GITHUB_APP_WEBHOOK_SECRET: filled(webhookSecret)
			? webhookSecret
			: randomBytes(20).toString("hex"),
		// The App supersedes the development stand-in, and leaving both set is
		// only confusing.
		GITHUB_DEV_TOKEN: "",
		GITHUB_API_URL: existing.GITHUB_API_URL ?? "https://api.github.com",
	};
}

export const github: Step = {
	name: "github",
	async run(ctx) {
		const existing = carriedOver(ctx);
		const origin = ctx.data.values.BETTER_AUTH_URL ?? "http://localhost:5173";
		const appName = ctx.data.values.PUBLIC_APP_NAME ?? "tracker";

		// Preview URLs differ per branch and GitHub matches callbacks exactly, so
		// signing in with GitHub cannot work on one. Repository linking still can.
		if (ctx.mode === "preview") {
			const production = carriedOver(ctx, ".env.production");
			const canReuse = filled(production.GITHUB_APP_ID);
			const isProductionApp = canReuse && existing.GITHUB_APP_ID === production.GITHUB_APP_ID;

			const choice = await askSelect(
				"GitHub on previews",
				[
					{
						value: "own" as const,
						label: "A separate App",
						hint: "repository linking only; keeps production's key out of previews",
					},
					...(canReuse
						? [
								{
									value: "reuse" as const,
									label: "Reuse the production App",
									hint: "repository linking only; one registration to maintain",
								},
							]
						: []),
					{
						value: "off" as const,
						label: "Leave it out",
						hint: "sign in with the seeded demo account",
					},
				],
				filled(existing.GITHUB_APP_ID) ? (isProductionApp ? "reuse" : "own") : "off",
			);

			if (choice === "off") {
				set(ctx, BLANK);
				return;
			}
			// Either App leaves the sign-in button on screen, where it cannot
			// finish — worth saying before they pick one and wonder.
			warn(`"Sign in with GitHub" will not work on previews; use the seeded demo account.`);

			if (choice === "reuse") {
				set(ctx, { ...production, GITHUB_DEV_TOKEN: "" });
				return;
			}

			set(ctx, await githubApp(existing, origin, `${appName}-preview`, PREVIEW_CALLBACK_NOTE));
			return;
		}

		const hasApp = filled(existing.GITHUB_APP_ID) && filled(existing.GITHUB_APP_PRIVATE_KEY);
		const hasToken = ctx.mode === "dev" && filled(existing.GITHUB_DEV_TOKEN);

		if (hasApp) {
			if (!filled(existing.GITHUB_CLIENT_ID)) {
				// An App configured before sign-in moved onto it has no client
				// credentials, and nothing else would ever say so — the button is
				// simply missing.
				warn('This App has no Client ID, so the "Sign in with GitHub" button is hidden.');
			}
			if (await askConfirm("Keep the existing GitHub App?", true)) {
				set(ctx, existing);
				return;
			}
		} else if (hasToken) {
			if (await askConfirm("Keep the existing GitHub personal access token?", true)) {
				set(ctx, existing);
				return;
			}
		} else if (!(await askConfirm("Set up GitHub sign-in and repository linking?", false))) {
			set(ctx, { ...BLANK, ...existing });
			return;
		}

		const kind =
			ctx.mode === "dev"
				? await askSelect(
						"How should this app reach GitHub?",
						[
							{
								value: "app" as const,
								label: "GitHub App",
								hint: "sign-in and repositories, one registration",
							},
							{
								value: "token" as const,
								label: "Personal access token",
								hint: "repositories only — development",
							},
						],
						"app",
					)
				: "app";

		set(
			ctx,
			kind === "token"
				? await personalAccessToken(existing)
				: await githubApp(existing, origin, appName),
		);
	},
};
