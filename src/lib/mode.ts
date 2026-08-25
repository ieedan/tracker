import { createModeManager } from "@implementjs/mode-watcher";

/**
 * Module scope, so anything can import it and change the mode.
 *
 * Dark by default rather than `"system"`: this is a Linear-shaped app and the
 * dark palette is the one it was designed in. A visitor who picks light still
 * gets light, and the choice is remembered.
 */
export const mode = createModeManager({ defaultMode: "dark" });
