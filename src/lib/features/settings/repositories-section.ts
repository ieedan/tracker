/**
 * Connecting a provider and linking repositories.
 *
 * Two steps, deliberately visible as two: granting access is somebody else's
 * decision (a GitHub org admin's), and picking repositories is yours. Collapsing
 * them into one button would hide which of the two failed.
 */
import {
	Div,
	ForEach,
	H2,
	If,
	Input,
	P,
	Span,
	derived,
	signal,
	type Readable,
} from "@implementjs/core";
import {
	ExternalLink,
	FolderGit2,
	Link2Off,
	RefreshCw,
	Search,
	TriangleAlert,
} from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { GithubMark } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import type { Repository } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";

interface Available {
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	description: string;
	linked: boolean;
}

export function RepositoriesSection(params: { slug: Readable<string> }) {
	const repositories = signal<Repository[]>([]);
	const available = signal<Available[]>([]);
	const connection = signal<{ account: string } | null>(null);
	const reusable = signal<Array<{ account: string; externalId: string }>>([]);
	const installUrl = signal("");
	const providerReady = signal(false);
	const loading = signal(true);
	const picking = signal(false);
	const query = signal("");

	const load = async () => {
		const [state, linked] = await Promise.all([
			api.GET("/api/v1/workspaces/[slug]/repositories/connect", {
				params: { slug: params.slug.get() },
			}),
			api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: params.slug.get() } }),
		]);
		loading.set(false);

		if (state.error === undefined) {
			providerReady.set(state.data.provider !== null);
			installUrl.set(state.data.installUrl ?? "");
			connection.set(
				state.data.connected === null ? null : { account: state.data.connected.account },
			);
			reusable.set(state.data.reusable);
		}
		if (linked.error === undefined) repositories.set(linked.data);
	};

	const loadAvailable = async () => {
		picking.set(true);
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/repositories/available", {
			params: { slug: params.slug.get() },
		});
		picking.set(false);
		if (error !== undefined) {
			toastError(messageOf(error, "Could not list repositories"));
			return;
		}
		available.set(data);
	};

	/**
	 * Attaches an installation this person already granted elsewhere.
	 *
	 * The server still checks it was theirs — this is a convenience, not the
	 * authority.
	 */
	const reuse = async (entry: { account: string; externalId: string }) => {
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/repositories/connect", {
			params: { slug: params.slug.get() },
			body: { externalId: entry.externalId, account: entry.account },
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not use that connection"));
			return;
		}
		connection.set({ account: data.account });
		reusable.set([]);
		toastSuccess(`Connected to ${data.account || "GitHub"}`);
		void loadAvailable();
	};

	const link = async (entry: Available) => {
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/repositories", {
			params: { slug: params.slug.get() },
			body: { externalId: entry.externalId },
		});
		if (error !== undefined) {
			toastError(messageOf(error, `Could not link ${entry.fullName}`));
			return;
		}
		repositories.update((list) =>
			list.some((repo) => repo.id === data.id) ? list : [...list, data],
		);
		available.update((list) =>
			list.map((row) => (row.externalId === entry.externalId ? { ...row, linked: true } : row)),
		);
		toastSuccess(`Linked ${data.fullName}`);
		// The index builds in the background; look again shortly so the count
		// stops saying zero without the person having to reload.
		setTimeout(() => void refreshOne(data.id), 2500);
	};

	const refreshOne = async (id: string) => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/repositories/[id]", {
			params: { slug: params.slug.get(), id },
		});
		if (error !== undefined) return;
		repositories.update((list) => list.map((repo) => (repo.id === id ? data : repo)));
	};

	const reindex = async (repo: Repository) => {
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/repositories/[id]/reindex", {
			params: { slug: params.slug.get(), id: repo.id },
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not reindex"));
			return;
		}
		repositories.update((list) => list.map((entry) => (entry.id === repo.id ? data : entry)));
		toastSuccess(`Indexed ${data.index.fileCount} files`);
	};

	const unlink = async (repo: Repository) => {
		const before = repositories.get();
		repositories.set(before.filter((entry) => entry.id !== repo.id));
		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/repositories/[id]", {
			params: { slug: params.slug.get(), id: repo.id },
		});
		if (error !== undefined) {
			repositories.set(before);
			toastError(messageOf(error, "Could not unlink"));
		}
	};

	void load();

	const matches = derived([available, query], (list, term) => {
		const needle = term.trim().toLowerCase();
		if (needle === "") return list.slice(0, 30);
		return list.filter((row) => row.fullName.toLowerCase().includes(needle)).slice(0, 30);
	});

	return Div(
		{ class: "flex flex-col gap-3" },
		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, "Repositories"),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"Link repositories to scope issues to them, reference files with @, and attach pull requests.",
			),
		),

		If(loading.bind((value) => !value)).Then(
			Div(
				{ class: "flex flex-col gap-3" },

				// Not configured at all — say so rather than showing a dead button.
				If(providerReady.bind((ready) => !ready)).Then(
					Empty(
						{ class: "border md:p-8" },
						EmptyHeader(
							EmptyMedia({ variant: "icon" }, TriangleAlert({ "aria-hidden": true })),
							EmptyTitle("No git provider"),
							EmptyDescription(
								"No git provider is configured on this server. Set the GitHub App credentials to enable this.",
							),
						),
					),
				),

				If(
					derived([providerReady, connection], (ready, current) => ready && current === null),
				).Then(
					Div(
						{ class: "flex flex-col gap-2 rounded-md border border-border p-3" },
						Span({ class: "text-[13px] font-medium" }, "Connect GitHub"),

						// Offered first when it applies. GitHub installs an app onto an
						// account once, so for a second workspace this is the path that
						// works — the install page would only show a configure screen and
						// never redirect back.
						If(
							reusable.bind((list) => list.length > 0),
							Div(
								{ class: "flex flex-col gap-1.5" },
								Span(
									{ class: "text-[12px] text-muted-foreground" },
									"Use an installation you have already granted:",
								),
								ForEach(
									reusable,
									(entry) => entry.externalId,
									(entry) =>
										Div(
											{
												class:
													"flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2.5 py-1.5",
											},
											GithubMark({ class: "size-3.5 shrink-0 text-muted-foreground" }),
											Span(
												{ class: "min-w-0 flex-1 truncate text-[13px]" },
												entry.bind((value) => value.account || `Installation ${value.externalId}`),
											),
											Button(
												{
													size: "sm",
													variant: "secondary",
													class: "h-6 px-2 text-[11px]",
													onClick: () => void reuse(entry.get()),
												},
												"Use",
											),
										),
								),
							),
						),

						Span(
							{ class: "text-[12px] text-muted-foreground" },
							reusable.bind((list) =>
								list.length > 0
									? "Or install it somewhere new:"
									: "Install the app on your organization and choose which repositories it can see.",
							),
						),
						Div(
							{ class: "flex items-center gap-2" },
							Button(
								{
									size: "sm",
									class: "gap-2",
									disabled: installUrl.bind((value) => value === ""),
									onClick: () => window.location.assign(installUrl.get()),
								},
								GithubMark({ class: "size-3.5" }),
								"Install on GitHub",
							),
							If(
								installUrl.bind((value) => value === ""),
								Span(
									{ class: "text-[11px] text-muted-foreground" },
									"Set GITHUB_APP_SLUG to enable the install link.",
								),
							),
						),
					),
				),

				If(connection.bind((current) => current !== null)).Then(
					Div(
						{ class: "flex flex-col gap-3" },
						Div(
							{
								class:
									"flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2",
							},
							GithubMark({ class: "size-3.5 text-muted-foreground" }),
							Span(
								{ class: "text-[12px]" },
								connection.bind((current) => `Connected to ${current?.account || "GitHub"}`),
							),
							Button(
								{
									size: "sm",
									variant: "ghost",
									class: "ml-auto h-7 gap-1.5 text-[12px] text-muted-foreground",
									loading: picking,
									onClick: () => void loadAvailable(),
								},
								"Add a repository",
							),
						),

						LinkedList(repositories, reindex, unlink),
						Picker(matches, query, available, link),
					),
				),
			),
		),
	);
}

function LinkedList(
	repositories: Readable<Repository[]>,
	reindex: (repo: Repository) => Promise<void>,
	unlink: (repo: Repository) => Promise<void>,
) {
	return Div(
		{ class: "flex flex-col gap-1.5" },
		If(
			repositories.bind((list) => list.length === 0),
			Empty(
				{ class: "border md:p-8" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, FolderGit2({ "aria-hidden": true })),
					EmptyTitle("No repositories linked"),
					EmptyDescription(
						"Add a repository to scope issues, mention files, and attach pull requests.",
					),
				),
			),
		),
		ForEach(
			repositories,
			(repo) => repo.id,
			(repo) =>
				Div(
					{ class: "flex items-center gap-2 rounded-md border border-border px-3 py-2" },
					GithubMark({ class: "size-3.5 shrink-0 text-muted-foreground" }),
					Div(
						{ class: "min-w-0 flex-1" },
						Div(
							{ class: "flex items-center gap-1.5" },
							Span({ class: "truncate text-[13px] font-medium" }, repo.bind("fullName")),
							If(
								repo.bind((value) => value.private),
								Span(
									{
										class: "rounded border border-border px-1 text-[10px] text-muted-foreground",
									},
									"private",
								),
							),
						),
						Span({ class: "text-[11px] text-muted-foreground" }, repo.bind(indexSummary)),
					),
					Button(
						{
							size: "icon-xs",
							variant: "ghost",
							class: "size-7 text-muted-foreground",
							title: "Reindex files",
							onClick: () => void reindex(repo.get()),
						},
						RefreshCw({ class: "size-3.5" }),
					),
					Button(
						{
							size: "icon-xs",
							variant: "ghost",
							class: "size-7 text-muted-foreground",
							title: "Open on GitHub",
							onClick: () => window.open(repo.get().url, "_blank"),
						},
						ExternalLink({ class: "size-3.5" }),
					),
					Button(
						{
							size: "icon-xs",
							variant: "ghost",
							class: "size-7 text-muted-foreground hover:text-destructive",
							title: "Unlink",
							onClick: () => void unlink(repo.get()),
						},
						Link2Off({ class: "size-3.5" }),
					),
				),
		),
	);
}

/** One line saying how usable the `@` index is, and why not when it is not. */
function indexSummary(repo: Repository): string {
	switch (repo.index.state) {
		case "never":
			return "Not indexed yet";
		case "indexing":
			return "Indexing…";
		case "failed":
			return `Indexing failed — ${repo.index.error || "unknown error"}`;
		case "ready": {
			const when = repo.index.indexedAt === null ? "" : ` · ${relativeTime(repo.index.indexedAt)}`;
			const partial = repo.index.truncated ? " (partial — the tree was capped)" : "";
			return `${repo.index.fileCount} files on ${repo.index.ref}${partial}${when}`;
		}
	}
}

function Picker(
	matches: Readable<Available[]>,
	query: ReturnType<typeof signal<string>>,
	available: Readable<Available[]>,
	link: (entry: Available) => Promise<void>,
) {
	return If(
		available.bind((list) => list.length > 0),
		Div(
			{ class: "flex flex-col gap-2 rounded-md border border-border p-3" },
			Div(
				{ class: "relative" },
				Search({
					class:
						"pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground",
				}),
				Input({
					value: query,
					placeholder: "Filter repositories…",
					class:
						"h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring",
				}),
			),
			Div(
				{ class: "flex max-h-64 flex-col gap-0.5 overflow-y-auto" },
				ForEach(
					matches,
					(entry) => entry.externalId,
					(entry) =>
						Div(
							{ class: "flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-accent/40" },
							Span({ class: "min-w-0 flex-1 truncate text-[13px]" }, entry.bind("fullName")),
							If(entry.bind((value) => value.linked))
								.Then(Span({ class: "text-[11px] text-muted-foreground" }, "Linked"))
								.Else(
									Button(
										{
											size: "sm",
											variant: "secondary",
											class: "h-6 px-2 text-[11px]",
											onClick: () => void link(entry.get()),
										},
										"Link",
									),
								),
						),
				),
			),
		),
	);
}
