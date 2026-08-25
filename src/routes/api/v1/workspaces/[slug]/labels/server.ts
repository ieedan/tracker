import { error } from "@implementjs/kit/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { CreateLabelBody, LabelSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { label } from "@/lib/server/schema.server";
import { toLabel } from "@/lib/server/serialize.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(LabelSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "read");
		const rows = await db
			.select()
			.from(label)
			.where(eq(label.workspaceId, workspace.id))
			.orderBy(asc(label.name));
		return rows.map(toLabel);
	},
});

export const POST = handler({
	body: CreateLabelBody,
	response: LabelSchema,
	async handle({ locals, params, body }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "write");
		const row = {
			id: nanoid(),
			workspaceId: workspace.id,
			name: body.name,
			color: body.color,
			createdAt: new Date(),
		};
		try {
			await db.insert(label).values(row);
		} catch {
			error(409, `a label named "${body.name}" already exists`);
		}
		return json(toLabel(row), { status: 201 });
	},
});
