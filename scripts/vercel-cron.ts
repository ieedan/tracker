/**
 * Registers the webhook drain as a Vercel cron.
 *
 * `@implementjs/adapter-vercel` writes `.vercel/output/config.json` itself, and
 * with the Build Output API a root `vercel.json` does not get merged into a
 * prebuilt deployment — so declaring the cron there would look right and never
 * fire. This injects it into the config the adapter just produced.
 *
 * A no-op for any other adapter, since the file will not exist.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG = resolve(process.cwd(), ".vercel/output/config.json");

/** Every five minutes — the longest a failed delivery waits before its retry. */
const CRON = { path: "/api/v1/webhooks/drain", schedule: "*/5 * * * *" };

if (!existsSync(CONFIG)) {
	process.exit(0);
}

const config = JSON.parse(readFileSync(CONFIG, "utf8")) as {
	crons?: Array<{ path: string; schedule: string }>;
};

const crons = config.crons ?? [];
if (!crons.some((entry) => entry.path === CRON.path)) crons.push(CRON);
config.crons = crons;

writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
console.log(`vercel: scheduled ${CRON.path} at "${CRON.schedule}"`);
