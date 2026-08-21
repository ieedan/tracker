import { db, issues } from "@/lib/db.server";

export default async function load() {
	return {
		issues: await db.select().from(issues),
	};
}
