import { fileURLToPath } from "node:url";
import { db } from "../db.server";
import { labels } from "./schema";

export const DEFAULT_LABELS = [
	{
		name: "💡 feature",
		description: "New functionality",
		color: "#8B5CF6",
	},
	{
		name: "🐞 bug",
		description: "Something isn't working",
		color: "#EF4444",
	},
	{
		name: "✨ improvement",
		description: "Enhancement to existing behavior",
		color: "#10B981",
	},
	{
		name: "📝 docs",
		description: "Documentation",
		color: "#6366F1",
	},
	{
		name: "🧹 chore",
		description: "Maintenance and cleanup",
		color: "#6B7280",
	},
	{
		name: "⚡ performance",
		description: "Speed and efficiency",
		color: "#F59E0B",
	},
	{
		name: "🔒 security",
		description: "Vulnerabilities and hardening",
		color: "#F97316",
	},
] as const;

let seeded = false;

/** Inserts the built-in labels when they are missing. Safe to call more than once. */
export async function seedDefaultLabels() {
	if (seeded) return;

	await db.insert(labels).values(DEFAULT_LABELS).onConflictDoNothing({ target: labels.name });

	seeded = true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	await seedDefaultLabels();
}
