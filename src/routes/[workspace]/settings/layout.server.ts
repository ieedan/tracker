import { loadWorkspaceConfig } from "@/lib/server/workspace-config.server";
import type { LoadEvent } from "./$types";

/**
 * Settings resets the layout chain, so it loads the workspace for itself
 * rather than inheriting it from the shell.
 */
export default function load({ locals, params }: LoadEvent) {
	return loadWorkspaceConfig(locals, params.workspace);
}
