import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

export const env = defineEnv({
	DB_FILE_NAME: z.string().default("file:local.db"),
});
