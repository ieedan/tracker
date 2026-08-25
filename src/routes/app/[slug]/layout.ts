import { AppShell } from "@/lib/features/shell/app-shell";
import type { LayoutProps } from "./$types";

export default function Layout({ data, params, url, children }: LayoutProps) {
	return AppShell(data, params.slug, url, children);
}
