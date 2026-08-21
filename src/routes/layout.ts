import { router } from "$implement/router";
import { Div, Main, Nav } from "@implementjs/core";
import { ModeWatcher } from "@implementjs/mode-watcher";
import { mode } from "@/lib/mode";
import type { LayoutProps } from "./$types";
import "../app.css";

export default function Layout({ children }: LayoutProps) {
	return Div(
		// the root layout stays mounted for the life of the app, so the blocking script
		// this renders into the head runs before the first paint of every page
		ModeWatcher({ manager: mode }),
		Nav(
			{ class: "flex items-center justify-center gap-4 border-b p-4 text-sm border-border" },
			router.Link({ class: "text-muted-foreground hover:text-foreground", to: "/" }, "Home"),
			router.Link({ class: "text-muted-foreground hover:text-foreground", to: "/about" }, "About"),
		),
		Main({ class: "flex-1" }, children),
	);
}
