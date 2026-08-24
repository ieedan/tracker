import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

// Every key here must start with PUBLIC_ — these values are inlined into the browser
// bundle. Secrets belong in a sibling `env.server.ts`, which never ships.
export const env = defineEnv({});
