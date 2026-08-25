import * as v from "valibot";
import { IssueSchema, TransferIssueBody } from "@/lib/domain/schemas";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { transferIssue } from "@/lib/server/issues.server";
import { handler } from "./$types";

const IdentifierParams = v.object({
	slug: v.string(),
	identifier: v.string(),
});

export const POST = handler({
	params: IdentifierParams,
	body: TransferIssueBody,
	response: IssueSchema,
	async handle({ locals, params, body }) {
		const source = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
		// Same 404 as any other membership miss — dest slug existence is not leaked.
		const dest = await requireMembership(locals, body.workspaceSlug);

		return await transferIssue({
			source,
			dest,
			identifier: params.identifier,
			teamKey: body.teamKey,
		});
	},
});
