import { createToastManager } from "@implementjs/primitives";

/** Module scope, so any component can raise a toast without threading a prop. */
export const toasts = createToastManager({ timeout: 4000 });

export const toastError = (message: string): string =>
	toasts.add({ type: "error", title: message });

export const toastSuccess = (message: string): string =>
	toasts.add({ type: "success", title: message });
