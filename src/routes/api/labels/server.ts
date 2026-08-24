import { db } from "@/lib/db.server";
import { handler } from "./$types";
import { labels } from "@/lib/db/schema";

export const GET = handler({
    handle: async () => {
        const labelList = await db.select().from(labels);

        return labelList;
    }
})
