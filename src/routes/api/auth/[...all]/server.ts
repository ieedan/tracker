import { auth } from "@/lib/server/auth.server";

// better-auth owns everything under /api/auth — sign-up, sign-in, sign-out,
// session, and the api-key endpoints the plugin adds.
export const GET = (event: { request: Request }): Promise<Response> => auth.handler(event.request);
export const POST = (event: { request: Request }): Promise<Response> => auth.handler(event.request);

// This route is better-auth's own surface, documented separately from /api/v1.
export const openapi = false;
