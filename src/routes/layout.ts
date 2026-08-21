import { router } from "$implement/router";
import { Div, Main, Nav } from "@implementjs/core";
import { ModeWatcher } from "@implementjs/mode-watcher";
import { mode } from "@/lib/app-state";
import type { LayoutProps } from "./$types";
import "../app.css";

export default function Layout({ children }: LayoutProps) {
	return Div(
		ModeWatcher({ manager: mode }),
		children,
	);
}
