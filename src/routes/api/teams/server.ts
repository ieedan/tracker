import { db } from "@/lib/db.server";
import { handler } from './$types';
import { teams } from "@/lib/db/schema";

export const GET = handler({
    handle: async () => {
        const teamList = await db.select().from(teams);

        return teamList;
    }
})
