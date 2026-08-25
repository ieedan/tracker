import { defineEnv } from "@implementjs/kit";
import { publicEnvSchema } from "./env.schema";

// Every key here must start with PUBLIC_ — these values are inlined into the
// browser bundle. Secrets belong in `env.server.ts`, which never ships.
export const env = defineEnv(publicEnvSchema);
