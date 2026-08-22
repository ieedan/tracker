import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

export const env = defineEnv({
	PUBLIC_APP_NAME: z.string().default("tracker"),
	PUBLIC_APP_URL: z.url().default("http://localhost:5173"),
});
