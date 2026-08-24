import { createModeManager, ModeWatcher } from "@implementjs/mode-watcher";
import { createToastManager } from "@implementjs/primitives";
import { Toaster } from "./components/ui/toast";
import { Fragment, type Child } from "@implementjs/core";

export const mode = createModeManager();

export const toaster = createToastManager();

export function AppState(...children: Child[]) {
	return Fragment(Toaster({ manager: toaster }), ModeWatcher({ manager: mode }), ...children);
}
