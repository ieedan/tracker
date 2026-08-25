import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { FEEDBACK_RATE_LIMITS } from "@/lib/domain/feedback";
import { CreateFeedbackBody, FeedbackSchema, FeedbackStatusSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { emitFeedbackEvent } from "@/lib/server/events.server";
import {
	getFeedbackById,
	insertFeedback,
	listFeedback,
	subscribeToFeedback,
} from "@/lib/server/feedback.server";
import { requireMembership } from "@/lib/server/guards.server";
import { clientAddress, consume } from "@/lib/server/rate-limit.server";
import { workspace as workspaceTable } from "@/lib/server/schema.server";
import { handler, json } from "./$types";

/** Everything in the workspace, for members. Not the public board. */
export const GET = handler({
	query: v.object({
		status: v.optional(v.union([v.array(FeedbackStatusSchema), FeedbackStatusSchema])),
		visibility: v.optional(v.picklist(["private", "public"])),
		/** `true` for feedback already turned into an issue, `false` for the rest. */
		converted: v.optional(v.picklist(["true", "false"])),
		q: v.optional(v.string()),
	}),
	response: v.array(FeedbackSchema),
	async handle({ locals, params, query }) {
		const { workspace } = await requireMembership(locals, params.slug);
		return await listFeedback(workspace.id, {
			audience: "member",
			filters: {
				status:
					query.status === undefined
						? undefined
						: Array.isArray(query.status)
							? query.status
							: [query.status],
				visibility: query.visibility,
				search: query.q,
				converted: query.converted === undefined ? undefined : query.converted === "true",
			},
		});
	},
});

/**
 * The ingest endpoint — the one route in this app written for somebody else's
 * code to call.
 *
 * Who may call it is the workspace's decision, not this handler's: `disabled`
 * 404s (a closed endpoint should not confirm the workspace exists), `api_key`
 * demands a key, and `public` takes anything with a rate limit behind it. The
 * limit is keyed by API key when there is one and by IP when there is not,
 * because those are the only two identities on offer and they deserve very
 * different allowances.
 */
export const POST = handler({
	body: CreateFeedbackBody,
	response: FeedbackSchema,
	async handle({ locals, params, body, request }) {
		const rows = await db
			.select()
			.from(workspaceTable)
			.where(eq(workspaceTable.slug, params.slug))
			.limit(1);

		const workspace = rows[0];
		if (workspace === undefined) error(404, `no workspace "${params.slug}"`);

		if (workspace.feedbackIntake === "disabled") {
			error(404, "this workspace is not accepting feedback");
		}

		const viaKey = locals.authVia === "api-key";
		if (workspace.feedbackIntake === "api_key" && !viaKey) {
			error(401, "this workspace requires an API key to submit feedback");
		}

		const budget = viaKey ? FEEDBACK_RATE_LIMITS.api_key : FEEDBACK_RATE_LIMITS.public;
		const identity = viaKey
			? `key:${locals.user?.id ?? "unknown"}`
			: `ip:${clientAddress(request)}`;
		const limit = await consume({
			key: `feedback:${workspace.id}:${identity}`,
			limit: budget.limit,
			windowMs: budget.windowMs,
		});
		if (!limit.allowed) {
			error(429, `too many submissions — try again in ${limit.retryAfter}s`);
		}

		// A public flag on a workspace whose board is private is not an error, it
		// is simply not honoured: the submitter does not get to publish into a
		// board the workspace has not opened.
		const visibility =
			body.public && workspace.feedbackBoard === "public"
				? ("public" as const)
				: ("private" as const);

		const email = body.email?.trim().toLowerCase() ?? null;

		const row = await insertFeedback({
			workspaceId: workspace.id,
			title: body.title,
			description: body.description,
			visibility,
			submitterName: body.name ?? null,
			submitterEmail: email,
			// A key acts for the user who minted it, which is not the person who
			// wrote the feedback; only a real session identifies a submitter.
			submitterUserId: locals.authVia === "session" ? (locals.user?.id ?? null) : null,
			source: body.source ?? null,
		});

		if (body.subscribe && email !== null) {
			await subscribeToFeedback({
				feedbackId: row.id,
				email,
				userId: locals.authVia === "session" ? (locals.user?.id ?? null) : null,
			});
		}

		const created = await getFeedbackById(row.id);
		if (created === undefined) error(500, "feedback vanished after insert");

		await emitFeedbackEvent("feedback.created", {
			workspace,
			actor: locals.user === null ? null : locals.user,
			feedback: created,
		});

		return json(created, {
			status: 201,
			headers: { "x-ratelimit-remaining": `${limit.remaining}` },
		});
	},
});
