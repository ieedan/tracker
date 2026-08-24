import { Div } from "@implementjs/core";
import type { LayoutProps } from "./$types";

/**
 * Thin wrapper. The chrome lives one level down, in `[slug]/layout.ts`, because
 * a sidebar without a workspace has nothing to point at — this layout's load is
 * what guarantees there is one.
 */
export default function Layout({ children }: LayoutProps) {
	return Div({ class: "contents" }, children);
}
