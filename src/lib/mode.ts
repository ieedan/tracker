import { Button } from "@implementjs/core";
import { createModeManager } from "@implementjs/mode-watcher";

const styles = {
	toggle: "cursor-pointer text-sm text-muted-foreground hover:text-foreground",
};

/** Module scope, so anything can import it and change the mode. */
export const mode = createModeManager();

/** Flips between light and dark, starting from whatever is rendering right now. */
export function ModeToggle() {
	return Button(
		{ class: styles.toggle, onClick: () => mode.toggleMode() },
		// undefined during a server render, where there is no operating system to ask
		mode.mode.bind((current) => (current === "dark" ? "Light mode" : "Dark mode")),
	);
}
