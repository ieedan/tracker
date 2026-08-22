import { context, signal, type Signal } from "@implementjs/core";
import type { LabelDto, RealtimeEvent, RepoDto, StatusDto, UserDto, WorkspaceDto } from "./types";

/**
 * What every page under `/[workspace]` needs: the workspace's configuration,
 * and a live feed of what everyone else is doing in it.
 *
 * The layout owns the SSE connection so it survives navigation between the
 * list and an issue, and hands changes to whichever pages are listening.
 */

type Listener = (event: RealtimeEvent) => void;

export type WorkspaceInit = {
	workspace: WorkspaceDto;
	statuses: StatusDto[];
	labels: LabelDto[];
	repos: RepoDto[];
	user: UserDto | null;
	workspaces: WorkspaceDto[];
	members: UserDto[];
};

export class WorkspaceStore {
	readonly workspace: Signal<WorkspaceDto>;
	readonly statuses: Signal<StatusDto[]>;
	readonly labels: Signal<LabelDto[]>;
	readonly repos: Signal<RepoDto[]>;
	readonly user: Signal<UserDto | null>;
	readonly workspaces: Signal<WorkspaceDto[]>;
	/** Whoever has appeared on an issue here — the pool an assignee comes from. */
	readonly members: Signal<UserDto[]>;
	/** False while the event stream is down, which the header surfaces. */
	readonly live = signal(false);

	private readonly listeners = new Set<Listener>();

	constructor(init: WorkspaceInit) {
		this.workspace = signal(init.workspace);
		this.statuses = signal(init.statuses);
		this.labels = signal(init.labels);
		this.repos = signal(init.repos);
		this.user = signal(init.user);
		this.workspaces = signal(init.workspaces);
		this.members = signal(init.members);
	}

	/** Replaces the configuration when navigating to another workspace. */
	reseed(init: WorkspaceInit): void {
		this.workspace.set(init.workspace);
		this.statuses.set(init.statuses);
		this.labels.set(init.labels);
		this.repos.set(init.repos);
		this.user.set(init.user);
		this.workspaces.set(init.workspaces);
		this.members.set(init.members);
	}

	on(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: RealtimeEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	statusById(id: string): StatusDto | undefined {
		return this.statuses.get().find((status) => status.id === id);
	}

	/** The status a newly created issue lands in, matching the server's default. */
	defaultStatus(): StatusDto | undefined {
		const all = this.statuses.get();
		return all.find((status) => status.category === "backlog") ?? all[0];
	}
}

export const WorkspaceContext = context<WorkspaceStore>();
