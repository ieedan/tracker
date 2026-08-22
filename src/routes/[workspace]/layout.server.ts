import { loadWorkspaceConfig } from "@/lib/server/workspace-config.server";
import type { LoadEvent } from "./$types";

/** Loaded once for every page beneath the workspace shell. */
export default function load({ locals, params }: LoadEvent) {
	return loadWorkspaceConfig(locals, params.workspace);
}
