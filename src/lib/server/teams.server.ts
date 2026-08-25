import { error } from "@implementjs/kit/server";
import { and, asc, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DEFAULT_TEAMS, TEAM_KEY_PATTERN } from "@/lib/domain/issues";
import type { Team } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { issue, team } from "./schema.server";
import { toTeam } from "./serialize.server";

/** Every team in the workspace, with how many issues each holds. */
export async function listTeams(workspaceId: string): Promise<Team[]> {
	const rows = await db
		.select({ team, issues: count(issue.id) })
		.from(team)
		.leftJoin(issue, eq(issue.teamId, team.id))
		.where(eq(team.workspaceId, workspaceId))
		.groupBy(team.id)
		.orderBy(asc(team.createdAt));

	return rows.map((row) => toTeam(row.team, row.issues));
}

/** The team row behind a key like `ENG`, or a 404. */
export async function requireTeam(
	workspaceId: string,
	key: string,
): Promise<typeof team.$inferSelect> {
	const rows = await db
		.select()
		.from(team)
		.where(and(eq(team.workspaceId, workspaceId), eq(team.key, key.toUpperCase())))
		.limit(1);

	const found = rows[0];
	if (found === undefined) error(404, `no team "${key.toUpperCase()}" in this workspace`);
	return found;
}

/**
 * Initials for a multi-word name, otherwise the first three letters.
 * `Platform Infra` → `PI`, `Design` → `DES`.
 */
export function teamKeyFrom(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((word) => /[a-zA-Z0-9]/.test(word));

	if (words.length > 1) {
		return words
			.slice(0, 4)
			.map((word) => word[0])
			.join("")
			.toUpperCase();
	}

	const letters = name.replace(/[^a-zA-Z0-9]/g, "");
	return (letters.slice(0, 3) || "TM").toUpperCase();
}

/** Rejects a key the identifier grammar could not parse back out. */
export function assertValidTeamKey(key: string): string {
	const upper = key.toUpperCase();
	if (!TEAM_KEY_PATTERN.test(upper)) {
		error(400, "team key must be 1–6 letters or digits, starting with a letter");
	}
	return upper;
}

/** Appends a digit until the key is free within the workspace. */
export async function uniqueTeamKey(workspaceId: string, base: string): Promise<string> {
	for (let suffix = 1; suffix < 10; suffix++) {
		const candidate = suffix === 1 ? base : `${base.slice(0, 5)}${suffix}`;
		const taken = await db
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.workspaceId, workspaceId), eq(team.key, candidate)))
			.limit(1);
		if (taken.length === 0) return candidate;
	}
	return `${base.slice(0, 3)}${nanoid(3).toUpperCase()}`;
}

/**
 * The teams a brand-new workspace starts with. A workspace with no teams has
 * nowhere to file an issue, so this is not optional.
 */
export async function createDefaultTeams(workspaceId: string): Promise<void> {
	await db.insert(team).values(
		DEFAULT_TEAMS.map((entry) => ({
			id: nanoid(),
			workspaceId,
			name: entry.name,
			key: entry.key,
			createdAt: new Date(),
		})),
	);
}
