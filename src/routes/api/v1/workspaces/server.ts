import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { CreateWorkspaceBody, WorkspaceSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireUser } from "@/lib/server/guards.server";
import { label, workspace, workspaceMember } from "@/lib/server/schema.server";
import { toWorkspace } from "@/lib/server/serialize.server";
import { slugify, workspaceKeyFrom } from "@/lib/server/slug.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(WorkspaceSchema),
	async handle({ locals }) {
		const user = requireUser(locals);
		const rows = await db
			.select({ workspace, role: workspaceMember.role })
			.from(workspaceMember)
			.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
			.where(eq(workspaceMember.userId, user.id))
			.orderBy(workspace.createdAt);

		return rows.map((row) => toWorkspace(row.workspace, row.role));
	},
});

export const POST = handler({
	body: CreateWorkspaceBody,
	response: WorkspaceSchema,
	async handle({ locals, body }) {
		const user = requireUser(locals);

		const slug = await uniqueSlug(slugify(body.name));
		const key = (body.key ?? workspaceKeyFrom(body.name)).toUpperCase();
		if (!/^[A-Z][A-Z0-9]{0,5}$/.test(key)) {
			error(400, "key must be 1–6 characters, starting with a letter");
		}

		const row = {
			id: nanoid(),
			name: body.name,
			slug,
			key,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await db.insert(workspace).values(row);
		await db.insert(workspaceMember).values({
			id: nanoid(),
			workspaceId: row.id,
			userId: user.id,
			// Whoever creates the workspace administers it.
			// implement:bug:#2: `valid-role` treats any object property named
			// `role` as an ARIA role, including a database column in a server-only
			// file that renders nothing.
			// oxlint-disable-next-line implementjs/valid-role
			role: "admin",
			createdAt: new Date(),
		});

		// A workspace with no labels at all is a dead end in the UI, so seed the
		// set Linear starts you with.
		await db.insert(label).values(
			[
				{ name: "Bug", color: "#e5484d" },
				{ name: "Feature", color: "#3e63dd" },
				{ name: "Improvement", color: "#46a758" },
			].map((entry) => ({
				id: nanoid(),
				workspaceId: row.id,
				name: entry.name,
				color: entry.color,
				createdAt: new Date(),
			})),
		);

		return json(toWorkspace(row, "admin"), { status: 201 });
	},
});

/**
 * Static routes beat `[slug]`, so a workspace slugged `new` would be shadowed
 * by /app/new and unreachable.
 */
const RESERVED_SLUGS = new Set(["new", "settings", "inbox", "issue", "api", "app"]);

/** Appends `-2`, `-3`, … until the slug is free. */
async function uniqueSlug(base: string): Promise<string> {
	const candidate = base === "" || RESERVED_SLUGS.has(base) ? `${base || "workspace"}-1` : base;
	for (let suffix = 1; suffix < 100; suffix++) {
		const slug = suffix === 1 ? candidate : `${candidate}-${suffix}`;
		const existing = await db
			.select({ id: workspace.id })
			.from(workspace)
			.where(eq(workspace.slug, slug))
			.limit(1);
		if (existing.length === 0) return slug;
	}
	return `${candidate}-${nanoid(6).toLowerCase()}`;
}
