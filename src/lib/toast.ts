import { createToastManager } from "@/lib/components/ui/toast";

/** Module scope, so any component can raise a toast without threading a prop. */
export const toast = createToastManager();
