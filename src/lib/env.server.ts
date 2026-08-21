import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

export const env = defineEnv({
	DATABASE_URL: z.string(),
});
