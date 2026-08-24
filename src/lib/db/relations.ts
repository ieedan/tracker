import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	issues: {
		labels: r.many.labels({
			from: r.issues.id.through(r.issueLabels.issueId),
			to: r.labels.id.through(r.issueLabels.labelId),
		}),
		team: r.one.teams({
			from: r.issues.teamId,
			to: r.teams.id,
			optional: false,
		}),
	},
}));
