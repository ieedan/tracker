import type { ApiError } from "@implementjs/kit/client/neverthrow";
import { toaster } from "./app-state";

/**
 * Handle an error given back from an action the user took.
 *
 * @param error
 * @param action We encountered an error `${action}`
 */
export function handleError(error: ApiError, action: string) {
	toaster.add({ title: `We encountered an error ${action}`, description: error.message });
}
