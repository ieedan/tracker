import { defineEnv } from "@implementjs/kit";
import { serverEnvSchema } from "./env.schema";

// Schemas live in `env.schema.ts` so `scripts/setup.ts` can validate against
// them without importing (and thereby triggering) this file.
export const env = defineEnv(serverEnvSchema);
