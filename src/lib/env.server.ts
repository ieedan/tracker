import { defineEnv } from "@implementjs/kit";
import * as v from "valibot";

export const env = defineEnv({
	DB_FILE_NAME: v.optional(v.string(), "file:local.db"),
});
