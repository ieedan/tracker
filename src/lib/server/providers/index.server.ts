/** Looking an adapter up by the id stored on a repository row. */
import type { GitProviderId } from "@/lib/domain/providers";
import { github } from "./github.server";
import type { GitProvider } from "./types.server";

const REGISTRY: Record<GitProviderId, GitProvider> = { github };

export function providerFor(id: GitProviderId): GitProvider {
	return REGISTRY[id];
}

/** The providers this deployment has credentials for. */
export function configuredProviders(): GitProvider[] {
	return Object.values(REGISTRY).filter((provider) => provider.configured());
}

export type { GitProvider, InstallationContext } from "./types.server";
