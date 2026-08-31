// The composer. Opened from anywhere — the sidebar button, `c`, the command
// palette — so its open state lives at module scope and the dialog itself is
// mounted once, in the app shell.
import {
	derived,
	Div,
	Fragment,
	If,
	ImplementDocument,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	type Child,
	type Readable,
	Span,
	signal,
} from "@implementjs/core";
import { Maximize2, Minimize2, X } from "@implementjs/lucide";
import { router } from "$implement/router";
import { api, messageOf } from "@/lib/client/api";
import { isTyping } from "@/lib/client/is-typing";
import { toastError, toastSuccess, toasts } from "@/lib/client/toast";
import type { ToasterToastData } from "@/lib/components/ui/toast";
import { Button } from "@/lib/components/ui/button";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "@/lib/components/ui/breadcrumb";
import { DialogClose, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import {
	RESPONSIVE_DIALOG_QUERY,
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogShape,
} from "@/lib/components/ui/responsive-dialog";
// Aliased: `Label` is already the issue label type in this module.
import { Label as ControlLabel } from "@/lib/components/ui/label";
import { Switch } from "@/lib/components/ui/switch";
import { preferDefaultTeam, type IssuePriority, type IssueStatus } from "@/lib/domain/issues";
import type {
	Attachment,
	Issue,
	IssueTemplate,
	Label,
	Member,
	Repository,
	Team,
	TeamRef,
	Workspace,
} from "@/lib/domain/schemas";
import { AttachmentGrid, removeAttachment } from "@/lib/features/attachments/attachment-list";
import {
	AttachTrigger,
	FileDragOverlay,
	beginUploads,
	preventFilePaste,
} from "@/lib/features/attachments/file-drop";
import type { Upload } from "@/lib/features/attachments/uploader";
import {
	clearIssueDraft,
	isBlankIssueDraft,
	loadCreateMore,
	loadIssueDraft,
	saveCreateMore,
	saveIssueDraft,
	type IssueDraft,
} from "./issue-draft";
import {
	AssigneePicker,
	LabelPicker,
	PriorityPicker,
	StatusPicker,
	TeamPicker,
	WorkspacePicker,
} from "./pickers";
import { cacheTeams, cachedTeams, warmTeams } from "./team-cache";
import { RepositoryPicker, toRepositoryRef, type RepositoryRef } from "./repository-picker";
import { BodyComposer } from "./body-composer";
import { cn } from "@/lib/utils";
import { KEY_HINT_CLASS } from "@/lib/components/ui/kbd";

const open = signal(false);
/** So the issue page can yield the drop overlay while this dialog is up. */
export { open as createIssueOpen };
const slug = signal("");
/** Which team the composer opens on — the one you were looking at, if any. */
const preferredTeam = signal("");

/**
 * The template the next open should apply, consumed once by `loadContext`.
 *
 * A signal rather than a parameter because the dialog is mounted once in the
 * shell — the same reason `slug` and `preferredTeam` live out here.
 */
const pendingTemplate = signal<IssueTemplate | null>(null);

/**
 * The status the next open should start on, consumed once by `loadContext` —
 * how a group header's "+" files straight into its own column. Wins over a
 * draft's saved status: the click named a column, so the composer honors it.
 */
const pendingStatus = signal<IssueStatus | null>(null);

/** Set when a create succeeds, so an open list can splice the issue in. */
export const issueCreated = signal<Issue | null>(null);

/**
 * The team a given open lands on: the one asked for when it still exists,
 * otherwise Engineering. `wanted` is empty when nothing pins a team — a plain
 * open passes the team you were looking at.
 *
 * Every path that has to answer "which team?" — open, restore, discard, create
 * more — goes through here so they cannot drift apart.
 */
function teamRefFor(available: Team[], wanted: string): TeamRef | null {
	const picked =
		(wanted !== "" ? available.find((team) => team.key === wanted) : undefined) ??
		preferDefaultTeam(available);
	return picked === undefined
		? null
		: { id: picked.id, name: picked.name, key: picked.key, icon: picked.icon, color: picked.color };
}

/**
 * The repository a composer scopes to when nothing else names one: the
 * workspace's only linked repository, or null when there are none or several.
 * Set on the pill rather than at create time, so it is visible and clearable.
 */
function soleRepositoryRef(available: Repository[]): RepositoryRef | null {
	return available.length === 1 ? toRepositoryRef(available[0]!) : null;
}

export function openCreateIssue(
	workspaceSlug: string,
	teamKey?: string,
	options?: { status?: IssueStatus },
): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	preferredTeam.set(teamKey ?? "");
	// A plain New issue is never a leftover template from a previous open.
	pendingTemplate.set(null);
	pendingStatus.set(options?.status ?? null);
	open.set(true);
}

/**
 * Opens the composer on a workspace template.
 *
 * A template is an explicit "start from this", so it wins over the saved draft
 * rather than merging with it — the draft is only overwritten once the fields
 * change, exactly as if it had been typed.
 */
export function openCreateIssueFromTemplate(
	workspaceSlug: string,
	template: IssueTemplate,
	teamKey?: string,
): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	preferredTeam.set(teamKey ?? "");
	pendingTemplate.set(template);
	open.set(true);
}

/**
 * What the shell already knows about the workspace it is showing. The layout
 * load hands it the teams, so the composer has no reason to open blank and wait
 * on its own fetch for them — see `loadContext`.
 */
export interface KnownScope {
	slug: Readable<string>;
	teams: Readable<Team[]>;
}

export function CreateIssueDialog(
	knownWorkspaces?: Readable<Workspace[]>,
	knownScope?: KnownScope,
) {
	const title = signal("");
	const description = signal("");
	const status = signal<IssueStatus>("backlog");
	const priority = signal<IssuePriority>("none");
	const assignee = signal<Member["user"] | null>(null);
	const chosenLabels = signal<Label[]>([]);
	const attachments = signal<Attachment[]>([]);
	const uploads = signal<Upload[]>([]);
	const submitting = signal(false);
	// "Create more": keep the composer up after a create so issues can be filed
	// back to back. Remembered across opens, and across reloads.
	const createMore = signal(false);

	// The pickers need the workspace's people and labels; they are fetched when
	// the composer opens rather than held by the shell, which does not have them.
	const members = signal<Member[]>([]);
	const labels = signal<Label[]>([]);
	const teams = signal<Team[]>([]);
	const chosenTeam = signal<TeamRef | null>(null);
	const repositories = signal<Repository[]>([]);
	const chosenRepository = signal<RepositoryRef | null>(null);
	// ENG-58: the breadcrumb can retarget the issue at any workspace you belong
	// to. `slug` stays the workspace the composer opened from — drafts are keyed
	// by it — while everything workspace-scoped (pickers, uploads, the create
	// itself) reads `issueSlug`.
	const workspaces = signal<Workspace[]>([]);
	const chosenWorkspace = signal<Workspace | null>(null);
	const issueSlug = derived(
		[chosenWorkspace, slug],
		(workspace, origin) => workspace?.slug ?? origin,
	);
	const descriptionRef = signal<HTMLElement | null>(null);
	const hasDraft = signal(false);
	/**
	 * The expand toggle: the panel stops sizing to its content and takes a fixed
	 * slice of the viewport, with the body editor absorbing everything the header,
	 * pills, and footer do not need.
	 *
	 * View state, not draft state — a fresh open is always compact, so the
	 * composer never comes back a different size from the one you expect.
	 */
	const expanded = signal(false);
	const statusOpen = signal(false);
	const priorityOpen = signal(false);
	const assigneeOpen = signal(false);
	const repositoryOpen = signal(false);
	const labelOpen = signal(false);
	/** Watched only to warm the teams of the workspaces on the list (ENG-71). */
	const workspaceOpen = signal(false);

	const openMenu = (which: "status" | "priority" | "assignee" | "repository" | "label") => {
		statusOpen.set(which === "status");
		priorityOpen.set(which === "priority");
		assigneeOpen.set(which === "assignee");
		repositoryOpen.set(which === "repository");
		labelOpen.set(which === "label");
	};

	const titleInput = signal<HTMLInputElement | null>(null);
	let focusFrame: number | undefined;

	// Restore writes the same field signals the persist effect watches; this
	// flag keeps those writes from clobbering storage before they settle.
	let hydrating = false;
	let persistTimer: ReturnType<typeof setTimeout> | undefined;
	// A slow response for a workspace the crumb has since left must not land.
	let scopeTicket = 0;

	const snapshot = (): IssueDraft => ({
		title: title.get(),
		description: description.get(),
		status: status.get(),
		priority: priority.get(),
		assigneeId: assignee.get()?.id ?? null,
		labelIds: chosenLabels.get().map((label) => label.id),
		teamKey: chosenTeam.get()?.key ?? null,
		repositoryId: chosenRepository.get()?.id ?? null,
		attachments: attachments.get(),
	});

	const persist = () => {
		// Open is not required: a close flushes after `open` is already false,
		// and an upload can finish after the dialog is dismissed.
		if (hydrating) return;
		const workspaceSlug = slug.get();
		if (workspaceSlug === "") return;

		const draft = snapshot();
		if (isBlankIssueDraft(draft, soleRepositoryRef(repositories.get())?.id ?? null)) {
			clearIssueDraft(workspaceSlug);
			hasDraft.set(false);
			return;
		}

		saveIssueDraft(workspaceSlug, draft);
		hasDraft.set(true);
	};

	const schedulePersist = () => {
		if (persistTimer !== undefined) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = undefined;
			persist();
		}, 300);
	};

	const flushPersist = () => {
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		persist();
	};

	const focusTitle = () => {
		if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
		focusFrame = requestAnimationFrame(() => {
			focusFrame = undefined;
			titleInput.get()?.focus();
		});
	};

	const reset = () => {
		title.set("");
		description.set("");
		status.set("backlog");
		priority.set("none");
		assignee.set(null);
		chosenLabels.set([]);
		chosenRepository.set(null);
		attachments.set([]);
		uploads.set([]);
	};

	/**
	 * Back to exactly what a freshly opened composer shows: every field at its
	 * default, and the team resolved the way an open resolves it — the one you
	 * are currently viewing, else Engineering.
	 *
	 * Used by both "create more" and Discard, so neither invents its own idea
	 * of what empty means.
	 */
	const resetToDefaults = () => {
		reset();
		// The workspace crumb survives a reset — you chose where to file — but the
		// preferred team only means anything in the workspace it came from.
		const home = issueSlug.get() === slug.get();
		chosenTeam.set(teamRefFor(teams.get(), home ? preferredTeam.get() : ""));
		chosenRepository.set(soleRepositoryRef(repositories.get()));
	};

	const discard = () => {
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		const leftover = attachments.get();
		// Files were uploaded to wherever the crumb pointed, which is not
		// necessarily the workspace the draft is keyed by.
		const uploadSlug = issueSlug.get();
		hydrating = true;
		clearIssueDraft(slug.get());
		hasDraft.set(false);
		resetToDefaults();
		hydrating = false;
		for (const file of leftover) {
			void api.DELETE("/api/v1/workspaces/[slug]/attachments/[id]", {
				params: { slug: uploadSlug, id: file.id },
			});
		}
	};

	/**
	 * The shell's teams, but only when they are the ones for the workspace being
	 * loaded — it holds a single workspace's teams, so they say nothing about a
	 * workspace the crumb has retargeted to.
	 */
	const knownTeamsFor = (workspaceSlug: string): Team[] =>
		knownScope !== undefined && knownScope.slug.get() === workspaceSlug
			? knownScope.teams.get()
			: [];

	const loadContext = async (workspaceSlug: string) => {
		hydrating = true;
		// A fresh open always starts in the workspace it was opened from, and any
		// scope load a previous open left in flight is stale now.
		const ticket = ++scopeTicket;
		// The crumb should read "this workspace" the moment the composer opens,
		// not once five requests land. The shell already knows the membership
		// list, so seed the picker from it (or from the last open's fetch) and
		// let the fresh response below reconcile.
		const seeded = workspaces.get().length > 0 ? workspaces.get() : (knownWorkspaces?.get() ?? []);
		if (workspaces.get().length === 0 && seeded.length > 0) workspaces.set(seeded);
		chosenWorkspace.set(seeded.find((workspace) => workspace.slug === workspaceSlug) ?? null);
		try {
			// Read on open rather than at module load: there is no storage during
			// SSR, and another tab may have flipped it since.
			createMore.set(loadCreateMore());

			// Consumed here so a later open — the sidebar button, `c` — is a plain
			// composer again rather than the last template picked.
			const template = pendingTemplate.get();
			pendingTemplate.set(null);

			const draft = template === null ? loadIssueDraft(workspaceSlug) : null;
			hasDraft.set(draft !== null);

			if (template !== null) {
				reset();
				title.set(template.title);
				description.set(template.description);
				status.set(template.status);
				priority.set(template.priority);
			} else if (draft === null) {
				reset();
			} else {
				title.set(draft.title);
				description.set(draft.description);
				status.set(draft.status);
				priority.set(draft.priority);
				attachments.set(draft.attachments);
				uploads.set([]);
			}

			// Consumed after the template/draft settle so a column's "+" always
			// opens on that column, whatever the draft last said.
			const wantedStatus = pendingStatus.get();
			pendingStatus.set(null);
			if (wantedStatus !== null) status.set(wantedStatus);

			// Draft team wins when it still exists; otherwise Engineering. With no
			// draft, open on the team you were looking at, then Engineering. A
			// template that pins no team is not an instruction to ignore where you
			// were — it falls through to the same defaults as a plain open.
			const wantedTeam =
				template !== null
					? (template.team?.key ?? preferredTeam.get())
					: draft !== null
						? (draft.teamKey ?? "")
						: preferredTeam.get();

			// ENG-68: the team is what gives the issue its identifier, and the create
			// button stays disabled without one — so a composer that opens teamless
			// is not merely missing a crumb, it cannot be used at all. Waiting on the
			// requests below is waiting on the slowest of five, which is how the
			// dialog came to sit on a blank "Team" pill. The shell already loaded
			// this workspace's teams, so open on those and let the response reconcile
			// them (issue counts move, a team may have been added since).
			const shellTeams = knownTeamsFor(workspaceSlug);
			if (shellTeams.length > 0) cacheTeams(workspaceSlug, shellTeams);
			// Opened from somewhere the shell knows nothing about — a workspace the
			// crumb visited earlier this session still has its teams (ENG-71).
			const seededTeams = shellTeams.length > 0 ? shellTeams : cachedTeams(workspaceSlug);
			let seededKey: string | null = null;
			if (seededTeams.length > 0) {
				teams.set(seededTeams);
				const seed = teamRefFor(seededTeams, wantedTeam);
				seededKey = seed?.key ?? null;
				chosenTeam.set(seed);
			}

			const [memberResult, labelResult, teamResult, repoResult, workspaceResult] =
				await Promise.all([
					api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
					api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
					api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
					api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
					api.GET("/api/v1/workspaces"),
				]);
			if (workspaceResult.error === undefined) {
				workspaces.set(workspaceResult.data);
				// Swap the seeded object for its freshly fetched self — without
				// undoing a retarget made while these requests were in flight.
				const pickedSlug = chosenWorkspace.get()?.slug ?? workspaceSlug;
				chosenWorkspace.set(
					workspaceResult.data.find((workspace) => workspace.slug === pickedSlug) ??
						chosenWorkspace.get(),
				);
			}
			// A crumb pick mid-flight owns the workspace scope now — its own
			// loadWorkspaceScope is (or was) fetching against the new slug.
			if (ticket !== scopeTicket) return;
			if (repoResult.error === undefined) {
				repositories.set(repoResult.data);
				// Either source names a repository by id, and either can name one that
				// has since been unlinked — which is dropped rather than restored as a
				// scope pointing at nothing.
				const wantedRepository =
					template !== null ? (template.repository?.id ?? null) : (draft?.repositoryId ?? null);
				const restored =
					repoResult.data.filter((repo) => repo.id === wantedRepository).map(toRepositoryRef)[0] ??
					null;
				// When nothing names a repository and the workspace has linked exactly
				// one, new issues scope to it by default — on the pill, where it can
				// be seen and cleared. A draft's empty scope is left alone: it may be
				// a deliberate clear.
				chosenRepository.set(
					restored ?? (draft === null ? soleRepositoryRef(repoResult.data) : null),
				);
			}
			if (memberResult.error === undefined) {
				members.set(memberResult.data);
				// Either source names a user by id, and either can name someone who
				// has since left — in which case the field is simply left empty.
				const wantedAssignee =
					template !== null ? (template.assignee?.id ?? null) : (draft?.assigneeId ?? null);
				if (template !== null || draft !== null) {
					assignee.set(
						wantedAssignee === null
							? null
							: (memberResult.data.find((member) => member.user.id === wantedAssignee)?.user ??
									null),
					);
				}
			}
			if (labelResult.error === undefined) {
				labels.set(labelResult.data);
				const wantedLabels =
					template !== null ? template.labels.map((label) => label.id) : (draft?.labelIds ?? null);
				if (wantedLabels !== null) {
					const kept = new Set(wantedLabels);
					chosenLabels.set(labelResult.data.filter((label) => kept.has(label.id)));
				}
			}

			if (teamResult.error !== undefined) return;
			teams.set(teamResult.data);
			cacheTeams(workspaceSlug, teamResult.data);

			// Swap the seeded team for its freshly fetched self — the same answer
			// whenever the seed was current, and the right one when it was not —
			// without undoing a pick made while these requests were in flight. Now
			// that the picker opens on real teams, that pick is reachable.
			const held = chosenTeam.get();
			chosenTeam.set(
				teamRefFor(
					teamResult.data,
					held !== null && seededKey !== null && held.key !== seededKey ? held.key : wantedTeam,
				),
			);
		} finally {
			hydrating = false;
		}
	};

	/**
	 * Everything the pickers show is scoped to a workspace — people, labels,
	 * teams, repositories — so a crumb switch refetches the lot against the new
	 * slug. The team lands on the new workspace's default; the team you were
	 * looking at only means anything back in the workspace you came from.
	 */
	const loadWorkspaceScope = async (workspaceSlug: string) => {
		const ticket = ++scopeTicket;

		// ENG-71: the team pill is the one field a switch cannot leave empty — no
		// team, no identifier, and the Create button is disabled until one lands.
		// The teams for this workspace are usually already known (the crumb has
		// been here before, or opening its menu warmed them), so the pick shows a
		// filled-in composer straight away and the fetch below only reconciles it.
		const seededTeams = cachedTeams(workspaceSlug);
		const wantedTeam = workspaceSlug === slug.get() ? preferredTeam.get() : "";
		let seededKey: string | null = null;
		if (seededTeams.length > 0) {
			teams.set(seededTeams);
			const seed = teamRefFor(seededTeams, wantedTeam);
			seededKey = seed?.key ?? null;
			chosenTeam.set(seed);
		} else {
			// Nothing to file to until this workspace's teams arrive; the create
			// button stays disabled through the gap.
			teams.set([]);
			chosenTeam.set(null);
		}

		const [memberResult, labelResult, teamResult, repoResult] = await Promise.all([
			api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
		]);
		if (ticket !== scopeTicket) return;
		if (memberResult.error === undefined) members.set(memberResult.data);
		if (labelResult.error === undefined) labels.set(labelResult.data);
		if (repoResult.error === undefined) {
			repositories.set(repoResult.data);
			// The retargeted workspace's only repository defaults onto the pill,
			// same as an open — unless a pick already landed during the fetch.
			if (chosenRepository.get() === null) {
				chosenRepository.set(soleRepositoryRef(repoResult.data));
			}
		}
		if (teamResult.error === undefined) {
			teams.set(teamResult.data);
			cacheTeams(workspaceSlug, teamResult.data);
			// Swap the seeded team for its freshly fetched self, without undoing a
			// pick made while these requests were in flight — the seed is what made
			// the picker usable that early, so a pick off it is reachable now.
			const held = chosenTeam.get();
			chosenTeam.set(
				teamRefFor(
					teamResult.data,
					held !== null && seededKey !== null && held.key !== seededKey ? held.key : wantedTeam,
				),
			);
		}
	};

	/**
	 * The breadcrumb picked another workspace. The title and description travel
	 * with you; everything that names something in the workspace being left —
	 * assignee, labels, repository, uploaded files — cannot cross with the
	 * issue, so those are cleared and the files deleted rather than orphaned.
	 */
	const pickWorkspace = (picked: string) => {
		const next = workspaces.get().find((workspace) => workspace.slug === picked);
		if (next === undefined || next.slug === issueSlug.get()) return;

		const leftover = attachments.get();
		const leaving = issueSlug.get();
		for (const file of leftover) {
			void api.DELETE("/api/v1/workspaces/[slug]/attachments/[id]", {
				params: { slug: leaving, id: file.id },
			});
		}

		chosenWorkspace.set(next);
		assignee.set(null);
		chosenLabels.set([]);
		chosenRepository.set(null);
		attachments.set([]);
		uploads.set([]);
		// The team comes from the scope load, which seeds it from what is already
		// known about the new workspace before it fetches anything (ENG-71).
		void loadWorkspaceScope(next.slug);
	};

	const submit = async () => {
		// One create per request: the dialog-level shortcut can fire while a
		// create is already in flight, and must not file the issue twice.
		if (submitting.get()) return;
		const trimmed = title.get().trim();
		const team = chosenTeam.get();
		// A team is what gives the issue its identifier, so there is nothing to
		// create without one.
		if (trimmed === "" || team === null) return;

		submitting.set(true);
		const targetSlug = issueSlug.get();
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/issues", {
			params: { slug: targetSlug },
			body: {
				teamKey: team.key,
				title: trimmed,
				description: description.get(),
				status: status.get(),
				priority: priority.get(),
				assigneeId: assignee.get()?.id ?? null,
				repositoryId: chosenRepository.get()?.id ?? null,
				labelIds: chosenLabels.get().map((label) => label.id),
				attachmentIds: attachments.get().map((attachment) => attachment.id),
			},
		});
		submitting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the issue"));
			return;
		}

		if (targetSlug === slug.get()) {
			issueCreated.set(data);
			toastSuccess(`Created ${data.identifier}`);
		} else {
			// Filed somewhere else: the open pages must not adopt it, and the app
			// does not walk you over there uninvited — the toast carries the way.
			toasts.add({
				type: "success",
				title: `Created ${data.identifier} in ${chosenWorkspace.get()?.name ?? targetSlug}`,
				data: {
					action: {
						label: "View",
						onClick: () =>
							router.navigate("/app/:slug/issue/:identifier", {
								slug: targetSlug,
								identifier: data.identifier,
							}),
					},
				} satisfies ToasterToastData,
			});
		}
		hydrating = true;
		// The draft belonged to the issue that now exists; a pending save of it
		// would only write it back.
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		clearIssueDraft(slug.get());
		hasDraft.set(false);

		// The drawer does not offer "create more", so it must not silently obey a
		// switch left on at a desk: a panel that stayed up after a create, with
		// nothing on it saying why, only reads as a create that did not happen.
		const staysUp =
			createMore.get() &&
			(typeof window === "undefined" || !window.matchMedia(RESPONSIVE_DIALOG_QUERY).matches);

		if (staysUp) {
			// Stay up, but as a fresh composer rather than a copy of what was just
			// filed: every field back to its default, cursor in the title.
			resetToDefaults();
			hydrating = false;
			focusTitle();
			return;
		}

		reset();
		open.set(false);
		hydrating = false;
	};

	const attach = (files: File[]) => {
		beginUploads({
			files,
			slug: issueSlug.get(),
			uploads,
			onUploaded: (attachment) => {
				attachments.push(attachment);
				persist();
			},
		});
	};

	const pickTeam = (key: string) => {
		const picked = teams.get().find((team) => team.key === key);
		if (picked !== undefined) {
			chosenTeam.set({
				id: picked.id,
				name: picked.name,
				key: picked.key,
				icon: picked.icon,
				color: picked.color,
			});
		}
	};

	/**
	 * Where the issue is being filed: the workspace, then the team that will
	 * give it its identifier. The dialog's header only — the drawer builds the
	 * same two pickers into its property row instead, and each is constructed
	 * in one place or the other but never both. A picker that is mounted twice,
	 * or moved between two mount points, is a picker that stops opening
	 * (implementjs ENG-28).
	 */
	const Crumbs = (...trailing: Child[]) =>
		Breadcrumb(
			{ class: "min-w-0" },
			BreadcrumbList(
				{ class: "flex-nowrap items-center gap-1 leading-none sm:gap-1.5" },
				BreadcrumbItem(
					// ENG-58: file into any workspace you belong to, defaulting to the
					// one the composer opened from.
					WorkspacePicker(chosenWorkspace, workspaces, pickWorkspace, {
						open: workspaceOpen,
						crumb: true,
					}),
				),
				BreadcrumbSeparator(),
				BreadcrumbItem(TeamPicker(chosenTeam, teams, pickTeam, { crumb: true })),
				...trailing,
			),
		);

	/**
	 * Built into whichever corner the panel has for it — the drawer's top-right,
	 * or the dialog's footer — and only one of those is ever mounted. Both read
	 * the same signals, so the shape cannot change what the button knows.
	 */
	const SubmitButton = (options: { compact: boolean } = { compact: false }) =>
		Button(
			{
				size: "sm",
				loading: submitting,
				disabled: derived(
					[title, chosenTeam],
					(value, team) => value.trim() === "" || team === null,
				),
				onClick: () => void submit(),
			},
			"Create",
			options.compact
				? null
				: Span({ class: cn("text-[11px] font-normal opacity-70", KEY_HINT_CLASS) }, "⌘⏎"),
		);

	return Div(
		{ class: "contents" },
		FileDragOverlay({ enabled: open, onFiles: attach }),
		ImplementDocument({
			onKeydownCapture: (event) => {
				if (!open.get()) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				// Typing is typing: the title keeps its letters even while it is empty,
				// which is where `a` used to be stolen by the assignee menu. The
				// property letters still work anywhere focus is not in a field.
				if (isTyping(event)) return;
				const key = event.key.toLowerCase();
				const which =
					key === "s"
						? "status"
						: key === "p"
							? "priority"
							: key === "a"
								? "assignee"
								: key === "r"
									? "repository"
									: key === "l"
										? "label"
										: null;
				if (which === null) return;
				event.preventDefault();
				event.stopPropagation();
				openMenu(which);
			},
		}),
		ResponsiveDialog(
			{ open },
			ImplementEffect([open], (isOpen) => {
				if (focusFrame !== undefined) {
					cancelAnimationFrame(focusFrame);
					focusFrame = undefined;
				}
				if (isOpen) {
					// Reset before the panel paints, so an open never animates down
					// from the size the last one was left at.
					expanded.set(false);
					void loadContext(slug.get());
					// The dialog focuses the first tabbable (the team crumb). Steal
					// it back once that pass has run so you can type a title.
					focusFrame = requestAnimationFrame(() => {
						focusFrame = undefined;
						titleInput.get()?.focus();
					});
					return;
				}
				flushPersist();
			}),
			// ENG-71: opening the crumb is the first sign a switch is coming, and it
			// is a good half-second ahead of the pick. Every workspace on the list
			// gets its teams fetched now — one small request each, skipped for the
			// ones already known — so the pick lands on a composer that is filled
			// in rather than one waiting on a round trip.
			ImplementEffect([workspaceOpen], (isOpen) => {
				if (!isOpen) return;
				for (const workspace of workspaces.get()) void warmTeams(workspace.slug);
			}),
			ImplementEffect(
				[
					title,
					description,
					status,
					priority,
					assignee,
					chosenLabels,
					chosenTeam,
					chosenRepository,
					attachments,
				],
				() => schedulePersist(),
				{ immediate: false },
			),
			ResponsiveDialogContent(
				// The base max-width stays at the dialog's default, which keeps a
				// phone's 1rem margins; only wider viewports get the full 3xl.
				{
					class: cn(
						"gap-0 p-0 md:max-w-3xl",
						// `height` joins the properties the panel already transitions —
						// listing them all again because tailwind-merge keeps only the
						// last `transition-property`, and dropping the open/close set
						// would kill the dialog's own entrance. Behind `md:` so the
						// drawer shape, which lives only below that breakpoint, keeps
						// its own `transition-[translate,display]` untouched.
						"md:transition-[height,opacity,scale,translate,display]",
						// Growing to a fixed height means interpolating away from
						// `auto`, which only animates where `interpolate-size` is
						// understood. Everywhere else the panel simply snaps.
						"md:[interpolate-size:allow-keywords]",
						{
							// Content-sized (`grid`) up to here; expanded it becomes a
							// column of a known height so the body region can flex into
							// what is left. The `data-[state=open]` twin is what actually
							// wins the cascade — the panel's own open-state `grid` is more
							// specific than a bare `flex`.
							"flex flex-col h-[85vh] data-[state=open]:flex": expanded,
						},
					),
					showCloseButton: false,
				},
				// Cmd/Ctrl+Enter files the issue from anywhere in the dialog — a
				// property pill, the Create button, an open picker — not just the
				// text fields. Capture phase so it runs ahead of whatever the
				// focused control does with Enter, and stopped so the title input's
				// copy of the shortcut cannot submit a second time. `submit` itself
				// declines while empty, teamless, or in flight. Attached by hand
				// because an element's `onKeydownCapture` prop binds a bogus
				// "keydowncapture" event instead of the capture phase
				// (implementjs ENG-24).
				ImplementLifecycle({
					onMount: (mounted) => {
						// Either shape of the responsive dialog: the panel names itself
						// dialog-content or drawer-content depending on the viewport.
						const root =
							mounted.closest<HTMLElement>(
								"[data-slot='dialog-content'], [data-slot='drawer-content']",
							) ?? mounted;
						const onKeydown = (event: KeyboardEvent) => {
							if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
							event.preventDefault();
							event.stopPropagation();
							void submit();
						};
						root.addEventListener("keydown", onKeydown, true);
						return () => root.removeEventListener("keydown", onKeydown, true);
					},
				}),
				ResponsiveDialogShape((shape) =>
					shape === "drawer"
						? // On a phone the composer's chrome is the two top corners and
							// nothing else: close on the left, Create on the right, and one
							// line of title between them. The crumb is not a subtitle — it
							// is two menus, and stacking them under the title put a row of
							// pills where a caption goes and read as decoration. They
							// belong with the other property pills below, which is what
							// they are.
							ResponsiveDialogHeader(
								{ action: () => SubmitButton({ compact: true }) },
								DialogTitle({}, "New issue"),
							)
						: Div(
								{ class: "flex items-center gap-2 border-b border-border px-3 py-2" },
								Crumbs(
									BreadcrumbSeparator(),
									BreadcrumbItem(
										DialogTitle(
											{ class: "text-[13px] leading-none font-medium text-foreground" },
											"New issue",
										),
									),
								),
								Div({ class: "flex-1" }),
								// One button that relabels rather than two that swap:
								// activating it must not move focus, and a remounted button
								// loses it. Only the icon inside is exchanged.
								Button(
									{
										variant: "ghost",
										size: "icon-sm",
										class: "size-7 shrink-0",
										"aria-label": expanded.bind((on) => (on ? "Collapse" : "Expand")),
										title: expanded.bind((on) => (on ? "Collapse" : "Expand")),
										onClick: () => expanded.update((on) => !on),
									},
									If(expanded)
										.Then(Minimize2({ class: "size-4", "aria-hidden": true }))
										.Else(Maximize2({ class: "size-4", "aria-hidden": true })),
								),
								DialogClose(
									{
										variant: "ghost",
										size: "icon-sm",
										class: "size-7 shrink-0",
									},
									X({ class: "size-4", "aria-hidden": true }),
									Span({ class: "sr-only" }, "Close"),
								),
							),
				),

				Div(
					{
						// The one region that grows: `min-h-0` so it can also give the
						// space back to a tall attachment grid rather than pushing the
						// footer off the panel. On a drawer it always is that region —
						// the pills row below it is the last thing on the panel now that
						// the footer is gone, and it stays on screen.
						class: cn(
							"flex flex-col gap-2 px-4 py-3",
							"max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto",
							{ "min-h-0 flex-1": expanded },
						),
						onPaste: (event) => preventFilePaste(event, attach),
					},
					Input({
						this: titleInput,
						value: title,
						placeholder: "Issue title",
						// 16px on a phone: below that, tapping into the field zooms the
						// page out from under the dialog (ENG-67).
						class:
							"h-8 border-0 bg-transparent p-0 text-[16px] font-medium outline-none placeholder:text-muted-foreground md:text-[15px]",
						autofocus: true,
						onKeydown: (event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
						},
					}),
					BodyComposer({
						value: description,
						element: descriptionRef,
						// `@` in the description offers the workspace's members, then the
						// linked repositories' file index.
						slug: () => issueSlug.get(),
						repository: () => chosenRepository.get()?.id,
						placeholder: "Add description… @ to mention someone or a file",
						rows: 4,
						// Expanded, `rows` stops deciding: the box takes whatever height
						// the panel has left and scrolls inside it.
						fill: expanded,
						onSubmit: () => void submit(),
					}),
					AttachmentGrid({
						attachments,
						uploads,
						slug: issueSlug,
						onRemove: (attachment) =>
							void removeAttachment(issueSlug.get(), attachment, attachments),
					}),
				),

				Div(
					{ class: "flex flex-wrap items-center gap-1.5 px-4 pb-3" },
					AttachTrigger({ onFiles: attach }),
					// Where the issue is filed, in the same pill shape as everything
					// else in the row — the drawer's title bar has no room for two
					// menus, and these are the two that decide the issue's identifier.
					// The dialog keeps them in its breadcrumb instead.
					ResponsiveDialogShape((shape) =>
						shape === "drawer"
							? Fragment(
									WorkspacePicker(chosenWorkspace, workspaces, pickWorkspace, {
										open: workspaceOpen,
										class: "border border-border",
									}),
									// The key alone, as the crumb shows it: every other pill in
									// the row carries one label, and "ENG Engineering" carries
									// two.
									TeamPicker(chosenTeam, teams, pickTeam, {
										class: "border border-border",
									}),
								)
							: null,
					),
					StatusPicker(status, (value) => status.set(value), {
						showLabel: true,
						class: "border border-border",
						open: statusOpen,
					}),
					PriorityPicker(priority, (value) => priority.set(value), {
						showLabel: true,
						class: "border border-border",
						open: priorityOpen,
					}),
					AssigneePicker(
						assignee,
						members,
						(userId) =>
							assignee.set(
								userId === null
									? null
									: (members.get().find((member) => member.user.id === userId)?.user ?? null),
							),
						{ showLabel: true, class: "border border-border", open: assigneeOpen },
					),
					RepositoryPicker(
						chosenRepository,
						repositories,
						(repositoryId) =>
							chosenRepository.set(
								repositoryId === null
									? null
									: (repositories
											.get()
											.filter((repo) => repo.id === repositoryId)
											.map(toRepositoryRef)[0] ?? null),
							),
						{ class: "border border-border", open: repositoryOpen },
					),
					LabelPicker(
						chosenLabels,
						labels,
						(labelId) =>
							chosenLabels.update((current) =>
								current.some((label) => label.id === labelId)
									? current.filter((label) => label.id !== labelId)
									: [...current, labels.get().find((label) => label.id === labelId)!],
							),
						{ class: "border border-border", open: labelOpen },
					),
				),

				DialogDescription({ class: "sr-only" }, "Create a new issue in the selected workspace."),

				// Drops out entirely on a drawer: Create has moved to the top-right
				// corner, Cancel is the close button in the other one, and neither
				// "create more" nor a draft's Discard is worth a row of a phone
				// screen — the draft is still saved, and still restored on the next
				// open, without a control saying so.
				ResponsiveDialogFooter(
					If(
						hasDraft,
						Div(
							{ class: "mr-auto flex items-baseline gap-1.5" },
							Span({ class: "text-[11px] leading-none text-muted-foreground" }, "Draft saved"),
							Button(
								{
									variant: "ghost",
									size: "sm",
									class:
										"h-auto min-h-0 px-0 py-0 text-[11px] leading-none font-normal text-muted-foreground hover:bg-transparent hover:text-foreground",
									onClick: discard,
								},
								"Discard",
							),
						),
					),
					ControlLabel(
						{
							for: "create-more",
							class: "gap-2 pr-1 text-[12px] font-normal text-muted-foreground",
						},
						Switch({
							id: "create-more",
							checked: createMore,
							onCheckedChange: (checked) => saveCreateMore(checked),
						}),
						"Create more",
					),
					Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
					SubmitButton(),
				),
			),
		),
	);
}
