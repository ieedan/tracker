/**
 * Object storage for attachments — MinIO in development, R2 in a deployment.
 *
 * The browser uploads straight to the bucket with a presigned URL, so the
 * bucket has to accept cross-origin PUTs from wherever the app is served.
 */
import { capture, installed, passthrough } from "../lib/exec.ts";
import { askConfirm, askEnv, askSelect, instructions, ok, required, warn } from "../lib/ui.ts";
import type { Step } from "../lib/types.ts";
import { borrow, previous, set } from "./common.ts";

const LOCAL = {
	S3_ENDPOINT: "http://localhost:9000",
	S3_REGION: "auto",
	S3_BUCKET: "tracker-attachments",
	S3_ACCESS_KEY_ID: "tracker",
	S3_SECRET_ACCESS_KEY: "tracker-dev-secret",
	S3_PUBLIC_ENDPOINT: "",
};

/** Accepts a full endpoint URL or the bare account ID the R2 dashboard shows. */
function r2Endpoint(input: string): string {
	const trimmed = input.trim();
	if (trimmed.includes("://")) return trimmed.replace(/\/+$/, "");
	return `https://${trimmed}.r2.cloudflarestorage.com`;
}

function corsPolicy(origins: string[]): string {
	return JSON.stringify(
		[
			{
				AllowedOrigins: origins,
				AllowedMethods: ["GET", "PUT", "HEAD"],
				AllowedHeaders: ["*"],
				ExposeHeaders: ["ETag"],
				MaxAgeSeconds: 3600,
			},
		],
		null,
		2,
	);
}

export const developmentStorage: Step = {
	name: "storage",
	async run(ctx) {
		const kept = previous(ctx);
		set(ctx, {
			S3_ENDPOINT: kept.S3_ENDPOINT ?? LOCAL.S3_ENDPOINT,
			S3_REGION: kept.S3_REGION ?? LOCAL.S3_REGION,
			S3_BUCKET: kept.S3_BUCKET ?? LOCAL.S3_BUCKET,
			S3_ACCESS_KEY_ID: kept.S3_ACCESS_KEY_ID ?? LOCAL.S3_ACCESS_KEY_ID,
			S3_SECRET_ACCESS_KEY: kept.S3_SECRET_ACCESS_KEY ?? LOCAL.S3_SECRET_ACCESS_KEY,
			S3_PUBLIC_ENDPOINT: kept.S3_PUBLIC_ENDPOINT ?? LOCAL.S3_PUBLIC_ENDPOINT,
		});

		if (!installed("docker")) {
			warn("Docker is not installed — attachments will not work until storage is running.");
			return;
		}

		if (!capture("docker", ["info"]).ok) {
			warn("Docker is installed but not running — start it, then `docker compose up -d`.");
			return;
		}

		if (!(await askConfirm("Start local storage now?  (docker compose up -d)", true))) return;

		if (passthrough("docker", ["compose", "up", "-d"])) {
			ctx.data.choices.storageRunning = true;
			ok("storage running at http://localhost:9000");
		} else {
			warn("`docker compose up -d` failed — attachments will not work until it does.");
		}
	},
};

export const deploymentStorage: Step = {
	name: "storage",
	async run(ctx) {
		// A preview environment can point at the production bucket; uploads from a
		// preview land beside real ones, which is usually what a reviewer wants.
		if (ctx.mode === "preview" && borrow(ctx, "S3_BUCKET", ".env.production") !== "") {
			const reuse = await askSelect(
				"Object storage for previews",
				[
					{
						value: "share" as const,
						label: `Share ${borrow(ctx, "S3_BUCKET", ".env.production")}`,
						hint: "the production bucket",
					},
					{ value: "own" as const, label: "A separate bucket" },
				],
				"share",
			);

			if (reuse === "share") {
				for (const key of [
					"S3_ENDPOINT",
					"S3_REGION",
					"S3_BUCKET",
					"S3_ACCESS_KEY_ID",
					"S3_SECRET_ACCESS_KEY",
					"S3_PUBLIC_ENDPOINT",
				]) {
					set(ctx, { [key]: borrow(ctx, key, ".env.production") });
				}
				ok("previews will use the production bucket");
				await askCors(ctx, borrow(ctx, "S3_BUCKET", ".env.production"));
				return;
			}
		}

		instructions({
			title: "Cloudflare R2",
			url: "https://dash.cloudflare.com/?to=/:account/r2/overview",
			steps: [
				"Create bucket — any name, and note it.",
				"Manage R2 API Tokens → Create Account API token.",
				"Permissions: Object Read & Write, scoped to that bucket.",
				"Copy the Access Key ID and Secret Access Key it shows once.",
			],
		});

		const endpoint = await askEnv({
			key: "S3_ENDPOINT",
			hint: "Your account ID, or the full S3 endpoint shown with the token.",
			schema: required("paste the account ID or endpoint"),
			initial: borrow(ctx, "S3_ENDPOINT").includes("localhost") ? "" : borrow(ctx, "S3_ENDPOINT"),
		});
		const bucket = await askEnv({
			key: "S3_BUCKET",
			hint: "The bucket you just created.",
			schema: required("name the bucket"),
			initial: borrow(ctx, "S3_BUCKET") === LOCAL.S3_BUCKET ? "" : borrow(ctx, "S3_BUCKET"),
		});
		const keyId = await askEnv({
			key: "S3_ACCESS_KEY_ID",
			hint: "From the API token.",
			schema: required("paste the access key ID"),
			initial:
				borrow(ctx, "S3_ACCESS_KEY_ID") === LOCAL.S3_ACCESS_KEY_ID
					? ""
					: borrow(ctx, "S3_ACCESS_KEY_ID"),
		});
		const secret = await askEnv({
			key: "S3_SECRET_ACCESS_KEY",
			hint: "From the same token.",
			schema: required("paste the secret access key"),
			initial:
				borrow(ctx, "S3_SECRET_ACCESS_KEY") === LOCAL.S3_SECRET_ACCESS_KEY
					? ""
					: borrow(ctx, "S3_SECRET_ACCESS_KEY"),
			secret: true,
		});

		set(ctx, {
			S3_ENDPOINT: r2Endpoint(endpoint),
			S3_REGION: borrow(ctx, "S3_REGION") || "auto",
			S3_BUCKET: bucket,
			S3_ACCESS_KEY_ID: keyId,
			S3_SECRET_ACCESS_KEY: secret,
			// R2 is reachable at the same host from both sides.
			S3_PUBLIC_ENDPOINT: "",
		});

		await askCors(ctx, bucket);
	},
};

/** Uploads go from the browser to the bucket, so this is not optional. */
async function askCors(ctx: Parameters<Step["run"]>[0], bucket: string): Promise<void> {
	const origins =
		ctx.mode === "preview"
			? ["https://*.vercel.app"]
			: [ctx.data.values.BETTER_AUTH_URL ?? "https://example.com"];

	instructions({
		title: `${bucket} → Settings → CORS policy`,
		url: "https://dash.cloudflare.com/?to=/:account/r2/overview",
		after: [
			ctx.mode === "preview"
				? "Paste this alongside the origins already there — every preview is a different subdomain."
				: "Paste this. Without it, uploads from the browser fail.",
		],
		payload: corsPolicy(origins),
	});

	await askConfirm("Saved it?", true);
}
