import type { InferSelectModel } from "drizzle-orm";
import { issues, labels, teams } from "./schema";

export type Issue = InferSelectModel<typeof issues> & {
	labels: InferSelectModel<typeof labels>[];
	team: InferSelectModel<typeof teams>;
};

export type Label = InferSelectModel<typeof labels>;
export type Team = InferSelectModel<typeof teams>;
