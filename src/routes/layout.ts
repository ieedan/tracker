import { Main } from "@implementjs/core";
import { AppState } from "@/lib/app-state";
import type { LayoutProps } from "./$types";
import "../app.css";

export default function Layout({ children }: LayoutProps) {
	return AppState(Main({ class: "flex-1" }, children));
}
