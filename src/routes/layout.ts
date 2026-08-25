import { Div } from "@implementjs/core";
import { ModeWatcher } from "@implementjs/mode-watcher";
import { Toaster } from "@/lib/components/ui/toast";
import { toasts } from "@/lib/client/toast";
import { mode } from "@/lib/mode";
import type { LayoutProps } from "./$types";
import "../app.css";

export default function Layout({ children }: LayoutProps) {
	return Div(
		{ class: "min-h-dvh" },
		// The root layout stays mounted for the life of the app, so the blocking
		// script this renders into the head runs before the first paint.
		ModeWatcher({ manager: mode }),
		children,
		Toaster({ manager: toasts }),
	);
}
