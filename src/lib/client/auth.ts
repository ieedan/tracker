import { createAuthClient } from "better-auth/client";

/**
 * Browser half of better-auth. Sign-in and sign-up have to run here rather than
 * through `/api/v1`, because they are the calls that set the session cookie.
 */
export const authClient = createAuthClient({ basePath: "/api/auth" });
