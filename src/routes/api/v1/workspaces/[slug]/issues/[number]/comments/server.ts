import { error } from "@implementjs/kit/server";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { CommentSchema, CreateCommentBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import { notify } from "@/lib/server/notifications.server";
import { comment, issue, user } from "@/lib/server/schema.server";
import { toComment } from "@/lib/server/serialize.server";
import { handler, json } from "./$types";

export const GET = handler({
	// implement:bug:#1: a `[number=integer]` matcher directory leaks its matcher
	// name into the generated OpenAPI path (`{number=integer}`) while the
	// parameter object is still named `number`, so the document is invalid for
	// this route. Parsing in the handler instead keeps the path template clean.
	// A `params` schema replaces every param, not just the one it names, so
	// `slug` has to be redeclared here even though only `number` is parsed.
	params: v.object({
		slug: v.string(),
		number: v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
	}),
	response: v.array(CommentSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		const target = await findIssue(workspace.id, params.number, workspace.key);

		const rows = await db
			.select({ comment, author: user })
			.from(comment)
			.innerJoin(user, eq(user.id, comment.authorId))
			.where(eq(comment.issueId, target.id))
			.orderBy(asc(comment.createdAt));

		return rows.map((row) => toComment(row.comment, row.author));
	},
});

export const POST = handler({
	// implement:bug:#1: a `[number=integer]` matcher directory leaks its matcher
	// name into the generated OpenAPI path (`{number=integer}`) while the
	// parameter object is still named `number`, so the document is invalid for
	// this route. Parsing in the handler instead keeps the path template clean.
	// A `params` schema replaces every param, not just the one it names, so
	// `slug` has to be redeclared here even though only `number` is parsed.
	params: v.object({
		slug: v.string(),
		number: v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
	}),
	body: CreateCommentBody,
	response: CommentSchema,
	async handle({ locals, params, body }) {
		const { workspace, user: author } = await requireMembership(locals, params.slug);
		const target = await findIssue(workspace.id, params.number, workspace.key);

		const row = {
			id: nanoid(),
			issueId: target.id,
			authorId: author.id,
			body: body.body,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		await db.insert(comment).values(row);

		const identifier = `${workspace.key}-${target.number}`;
		const audience = new Set(
			[target.assigneeId, target.creatorId].filter((id): id is string => id != null && id !== ""),
		);
		for (const userId of audience) {
			await notify({
				userId,
				actorId: author.id,
				workspaceId: workspace.id,
				issueId: target.id,
				type: "issue_commented",
				body: `${author.name} commented on ${identifier}`,
			});
		}

		return json(toComment(row, { ...author, image: author.image }), { status: 201 });
	},
});

async function findIssue(
	workspaceId: string,
	number: number,
	key: string,
): Promise<typeof issue.$inferSelect> {
	const rows = await db
		.select()
		.from(issue)
		.where(and(eq(issue.workspaceId, workspaceId), eq(issue.number, number)))
		.limit(1);
	const found = rows[0];
	if (found === undefined) error(404, `no issue ${key}-${number}`);
	return found;
}
