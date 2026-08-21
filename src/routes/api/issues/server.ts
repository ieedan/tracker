import { db, issues } from "@/lib/db.server";
import type { RequestEvent } from "./$types";

export async function POST({ request }: RequestEvent) {
    const { title, body } = await request.json();

    const issue = await db.insert(issues).values({ title, body }).returning().get();

    return new Response(JSON.stringify(issue), { status: 201 });
}
