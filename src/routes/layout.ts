import { Div } from "@implementjs/core";
import { ModeWatcher } from "@implementjs/mode-watcher";
import { Toaster } from "@/lib/components/ui/toast";
import { mode } from "@/lib/mode";
import { toast } from "@/lib/toast";
import type { LayoutProps } from "./$types";
import "../app.css";

export default function Layout({ children }: LayoutProps) {
	return Div(
		{ class: "min-h-dvh bg-background text-foreground" },
		// The root layout stays mounted for the life of the app, so the blocking
		// script this renders into the head runs before the first paint of every page.
		ModeWatcher({ manager: mode }),
		Toaster({ manager: toast }),
		children,
	);
}
