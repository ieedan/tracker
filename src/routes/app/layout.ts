import { AppShell } from "@/lib/features/shell/app-shell";
import type { LayoutProps } from "./$types";

export default function Layout({ data, url, children }: LayoutProps) {
	return AppShell(data, url, children);
}
