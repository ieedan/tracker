import { api } from "$implement/client";

export { api };

/** The message an endpoint's `error(status, …)` carried, or a generic fallback. */
export function messageOf(error: unknown, fallback = "Something went wrong"): string {
	if (error === null || error === undefined) return fallback;
	if (typeof error === "string") return error === "" ? fallback : error;
	if (typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message !== "") return message;
	}
	return fallback;
}
