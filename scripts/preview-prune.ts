/**
 * Deletes the preview databases whose branch is gone.
 *
 *   pnpm preview:prune
 *
 * Preview databases are named after the branch that created them, so the set
 * to keep is exactly the set of branches still on the remote. Anything else is
 * a merged or abandoned pull request holding onto storage.
 */
import { confirm, intro, isCancel, log, outro, select } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import {
	deleteDatabase,
	listDatabases,
	previewDatabaseName,
	PREVIEW_PREFIX,
	type TursoAuth,
} from "./lib/turso.ts";

const token = process.env.TURSO_API_TOKEN ?? "";
const org = process.env.TURSO_ORG ?? "";

intro("Prune preview databases");

if (token === "" || org === "") {
	log.error("TURSO_API_TOKEN and TURSO_ORG are not set — run `pnpm setup:preview` first.");
	process.exit(1);
}

const auth: TursoAuth = { token, org };

/** Branch names still on the remote. */
function remoteBranches(): string[] | null {
	const result = spawnSync("git", ["ls-remote", "--heads", "origin"], { encoding: "utf8" });
	if (result.status !== 0) return null;

	return result.stdout
		.split("\n")
		.map((line) => line.split("\t")[1] ?? "")
		.filter((ref) => ref.startsWith("refs/heads/"))
		.map((ref) => ref.slice("refs/heads/".length));
}

const branches = remoteBranches();
if (branches === null) {
	log.error("Could not read the branches on `origin`.");
	process.exit(1);
}

const keep = new Set(branches.map((branch) => previewDatabaseName(branch)));
const previews = (await listDatabases(auth)).filter((database) =>
	database.Name.startsWith(PREVIEW_PREFIX),
);
const orphans = previews.filter((database) => !keep.has(database.Name));

log.info(`${previews.length} preview databases, ${orphans.length} without a branch.`);

if (orphans.length === 0) {
	outro("Nothing to prune.");
	process.exit(0);
}

const choice = await select({
	message: `Delete ${orphans.length} preview ${orphans.length === 1 ? "database" : "databases"}?`,
	options: [
		{ value: "list", label: "Show them first" },
		{ value: "delete", label: "Delete them" },
		{ value: "keep", label: "Leave them alone" },
	],
});
if (isCancel(choice) || choice === "keep") {
	outro("Nothing deleted.");
	process.exit(0);
}

if (choice === "list") {
	log.message(orphans.map((database) => database.Name).join("\n"));
	const go = await confirm({ message: "Delete these?", initialValue: false });
	if (isCancel(go) || !go) {
		outro("Nothing deleted.");
		process.exit(0);
	}
}

for (const database of orphans) {
	try {
		await deleteDatabase(auth, database.Name);
		log.success(`deleted ${database.Name}`);
	} catch (error) {
		log.error(`${database.Name} — ${error instanceof Error ? error.message : String(error)}`);
	}
}

outro("Done.");
