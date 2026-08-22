import { defineEnv } from "@implementjs/kit";
import { z } from "zod";

export const env = defineEnv({
	DATABASE_URL: z.string().startsWith("postgres"),

	S3_ENDPOINT: z.url(),
	S3_BUCKET: z.string().min(1),
	S3_ACCESS_KEY: z.string().min(1),
	S3_SECRET_KEY: z.string().min(1),
	S3_PUBLIC_URL: z.url(),

	BETTER_AUTH_SECRET: z.string().min(32),
	// Blank is allowed so the app boots before a GitHub OAuth App exists; the
	// login page says what to do instead of the server refusing to start.
	GITHUB_CLIENT_ID: z.string().default(""),
	GITHUB_CLIENT_SECRET: z.string().default(""),

	/**
	 * Turns on email+password sign-in so the seeded demo account can be used
	 * without a GitHub OAuth App. The route that seeds it is additionally
	 * compiled out of production builds — see src/routes/api/dev/seed.
	 */
	DEV_LOGIN: z.enum(["true", "false"]).default("false"),
});
