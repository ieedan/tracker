import type { HandleServerError } from "@implementjs/kit/server";

export const handleError: HandleServerError = ({ error }) => ({
	message: error instanceof Error ? (error.stack ?? error.message) : String(error),
});
