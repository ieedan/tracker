import { handler } from "./$types";
import { db } from "@/lib/db.server";
import { issues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const GET = handler({
	handle: async ({ params }) => {
		const issue = await db.query.issues.findFirst({
			where: { id: params.id },
			with: { labels: true, team: true },
		});

		return issue;
	},
});

export const DELETE = handler({
	handle: async ({ params }) => {
		await db.delete(issues).where(eq(issues.id, params.id));
	},
});
