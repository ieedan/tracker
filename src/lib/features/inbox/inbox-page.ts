/**
 * The inbox, in Linear's shape: a list on the left, the selected notification
 * on the right.
 *
 * Three moving parts:
 *
 *   - **Filters** — a read filter (All / Unread) and a type filter, both held
 *     in signals rather than the URL: the inbox is a working surface, not
 *     something you link someone to.
 *   - **Order** — newest or oldest first, sorted client side over the page the
 *     loader already fetched.
 *   - **Read state** — clicking, or arrowing onto, a notification marks it
 *     read; the detail pane can put it back. Every write is optimistic and
 *     rolls the list back if the request fails.
 */
import { router } from "$implement/router";
import {
	Div,
	Dynamic,
	ForEach,
	H1,
	H2,
	If,
	ImplementDocument,
	ImplementEffect,
	P,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import {
	ArrowUpDown,
	CheckCheck,
	ExternalLink,
	Inbox,
	ListFilter,
	Mail,
	MailOpen,
	MessageSquare,
	RefreshCw,
	UserMinus,
	UserPlus,
	Users,
} from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { isTyping } from "@/lib/client/is-typing";
import { toastError } from "@/lib/client/toast";
import { UserAvatar } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/domain/issues";
import type {
	Label,
	Member,
	Notification,
	NotificationOrder,
	Team,
	Workspace,
} from "@/lib/domain/schemas";
import { fullTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InboxIssuePane, type IssuePaneContext } from "./issue-pane";
import { adjustUnreadCount, seedUnreadCount, unreadCount } from "./unread";

interface PageData {
	notifications: Notification[];
	// From the workspace layout, and handed to the issue pane so it does not
	// refetch what the shell already loaded.
	workspace: Workspace;
	teams: Team[];
	members: Member[];
	labels: Label[];
	/** From the app layout — whose comments the issue pane offers to edit. */
	user: { id: string };
}

/** Everything, or only what you have not looked at yet. */
type ReadFilter = "all" | "unread";

const TYPE_LABELS: Record<NotificationType, string> = {
	issue_assigned: "Assigned",
	issue_unassigned: "Unassigned",
	issue_status_changed: "Status changed",
	issue_commented: "Comment",
	workspace_invited: "Invite",
};

const ORDER_LABELS: Record<NotificationOrder, string> = {
	newest: "Newest first",
	oldest: "Oldest first",
};

/** Radio items need a string value, and "every type" is not one of the types. */
const ANY_TYPE = "__any__";

function TypeIcon(type: NotificationType, className = "size-3.5") {
	switch (type) {
		case "issue_assigned":
			return UserPlus({ class: className, "aria-hidden": true });
		case "issue_unassigned":
			return UserMinus({ class: className, "aria-hidden": true });
		case "issue_status_changed":
			return RefreshCw({ class: className, "aria-hidden": true });
		case "issue_commented":
			return MessageSquare({ class: className, "aria-hidden": true });
		case "workspace_invited":
			return Users({ class: className, "aria-hidden": true });
	}
}

export function InboxPage({
	data,
	params,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
}) {
	const notifications = signal(data.get().notifications);
	data.onChange((next) => notifications.set(next.notifications));

	const readFilter = signal<ReadFilter>("all");
	const typeFilter = signal<NotificationType | null>(null);
	const order = signal<NotificationOrder>("newest");
	/** `null` until something is picked; the pane falls back to the first row. */
	const selectedId = signal<string | null>(null);

	const unread = notifications.bind((list) => list.filter((entry) => !entry.read).length);

	const visible = derived(
		[notifications, readFilter, typeFilter, order, selectedId],
		(list, read, type, sort, current) => {
			const filtered = list.filter((entry) => {
				if (type !== null && entry.type !== type) return false;
				// Opening an unread notification marks it read, so the unread filter
				// keeps whichever one you are reading — otherwise it would vanish out
				// from under the pane the moment you clicked it.
				if (read === "unread" && entry.read && entry.id !== current) return false;
				return true;
			});

			return filtered.toSorted((left, right) => {
				const delta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
				return sort === "oldest" ? delta : -delta;
			});
		},
	);

	// Nothing picked yet still shows something, and it is never marked read by
	// the pane alone: only an actual click or keypress does that.
	const selected = derived(
		[visible, selectedId],
		(list, id) => list.find((entry) => entry.id === id) ?? list[0] ?? null,
	);

	/**
	 * Flips read state for some ids, or for the whole inbox when `ids` is
	 * omitted. Applied locally first and rolled back if the server disagrees.
	 *
	 * The sidebar badge moves with the list rather than with the response: the
	 * count and the rows are the same fact shown twice, and waiting out a poll
	 * before the badge agrees with what is plainly on screen reads as a bug.
	 */
	const setRead = async (ids: string[] | undefined, read: boolean) => {
		const before = notifications.get();
		const target = ids === undefined ? null : new Set(ids);
		const alreadyThere = before.every(
			(entry) => (target !== null && !target.has(entry.id)) || entry.read === read,
		);
		if (alreadyThere) return;

		const after = before.map((entry) =>
			target === null || target.has(entry.id) ? { ...entry, read } : entry,
		);
		// Only the rows that actually changed state count against the badge —
		// re-marking something already read moves nothing.
		const flipped = after.filter((entry, index) => entry.read !== before[index]!.read).length;
		const badgeBefore = unreadCount.get();

		notifications.set(after);
		// "Mark all read" clears every notification the account has, not only the
		// page this screen is holding — so it zeroes the badge rather than
		// subtracting what happens to be loaded.
		if (ids === undefined && read) seedUnreadCount(0);
		else adjustUnreadCount(read ? -flipped : flipped);

		const { error } = await api.POST("/api/v1/notifications", { body: { ids, read } });
		if (error !== undefined) {
			notifications.set(before);
			seedUnreadCount(badgeBefore);
			toastError(
				messageOf(error, read ? "Could not mark that read" : "Could not mark that unread"),
			);
		}
	};

	const select = (id: string) => {
		selectedId.set(id);
		const entry = notifications.get().find((value) => value.id === id);
		if (entry !== undefined && !entry.read) void setRead([id], true);

		// Keyboard moves can land on a row that is scrolled out of the list.
		document
			.querySelector(`[data-notification="${CSS.escape(id)}"]`)
			?.scrollIntoView({ block: "nearest" });
	};

	const move = (delta: number) => {
		const list = visible.get();
		if (list.length === 0) return;
		const current = selected.get();
		const index = current === null ? -1 : list.findIndex((entry) => entry.id === current.id);
		const next = list[Math.min(Math.max(index + delta, 0), list.length - 1)];
		if (next !== undefined) select(next.id);
	};

	const openSelected = () => {
		const current = selected.get();
		if (current?.issue == null) return;
		void router.navigate("/app/:slug/issue/:identifier", {
			slug: params.slug.get(),
			identifier: current.issue.identifier,
		});
	};

	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },

		ImplementDocument({
			onKeydown: (event) => {
				if (isTyping(event)) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;

				const key = event.key.toLowerCase();
				if (key === "arrowdown" || key === "j") {
					event.preventDefault();
					move(1);
					return;
				}
				if (key === "arrowup" || key === "k") {
					event.preventDefault();
					move(-1);
					return;
				}
				if (key === "u") {
					const current = selected.get();
					if (current === null) return;
					event.preventDefault();
					void setRead([current.id], !current.read);
					return;
				}
				if (key === "enter") {
					const current = selected.get();
					if (current?.issue == null) return;
					event.preventDefault();
					openSelected();
				}
			},
		}),

		Div(
			{
				class:
					"flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 md:h-12 md:flex-nowrap md:py-0",
			},
			H1({ class: "text-[15px] font-semibold tracking-tight" }, "Inbox"),
			If(
				unread.bind((count) => count > 0),
				Span(
					{
						class:
							"rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground",
					},
					unread,
				),
			),

			ReadTabs(readFilter, notifications),

			Div({ class: "flex-1" }),
			TypeMenu(typeFilter),
			OrderMenu(order),
			If(
				unread.bind((count) => count > 0),
				Button(
					{
						variant: "ghost",
						size: "sm",
						class: "gap-1.5 text-[12px]",
						onClick: () => void setRead(undefined, true),
					},
					CheckCheck({ class: "size-3.5" }),
					"Mark all read",
				),
			),
		),

		// Side by side where there is room; stacked — list above the reading
		// pane — on a phone, where 380px of list would be the whole screen.
		Div(
			{ class: "flex min-h-0 flex-1 flex-col md:flex-row" },

			// Left: the list. Fixed width so the detail pane keeps the room it needs.
			Div(
				{
					class:
						"flex max-h-[40dvh] w-full shrink-0 flex-col overflow-x-hidden overflow-y-auto border-b border-border md:max-h-none md:w-[380px] md:border-r md:border-b-0",
				},
				If(
					visible.bind((list) => list.length === 0),
					ListEmptyState(readFilter, typeFilter, notifications),
				),
				ForEach(
					visible,
					(entry) => entry.id,
					(entry) => NotificationRow(entry, selected, select),
				),
			),

			// Right: whatever is selected. The issue pane scrolls its own regions,
			// so the column holds no scrollbar of its own.
			Div(
				{ class: "flex min-w-0 flex-1 flex-col overflow-hidden" },
				DetailPane(selected, params, setRead, {
					workspace: data.bind((value) => value.workspace),
					teams: data.bind((value) => value.teams),
					members: data.bind((value) => value.members),
					labels: data.bind((value) => value.labels),
					viewer: data.bind((value) => value.user),
				}),
			),
		),
	);
}

/** All / Unread, with counts — the two views worth one click. */
function ReadTabs(readFilter: Signal<ReadFilter>, notifications: Readable<Notification[]>) {
	const tab = (value: ReadFilter, label: string) => {
		const count = derived([notifications], (list) =>
			value === "unread" ? list.filter((entry) => !entry.read).length : list.length,
		);
		const active = derived([readFilter], (current) => current === value);

		return Button(
			{
				size: "sm",
				variant: "ghost",
				class: active.bind((isActive) =>
					isActive
						? "h-7 gap-1.5 bg-accent text-[12px] text-accent-foreground"
						: "h-7 gap-1.5 text-[12px] text-muted-foreground",
				),
				onClick: () => readFilter.set(value),
			},
			label,
			Span(
				{ class: "text-[11px] text-muted-foreground" },
				count.bind((value_) => `${value_}`),
			),
		);
	};

	return Div({ class: "flex items-center gap-0.5" }, tab("all", "All"), tab("unread", "Unread"));
}

const menuTriggerClass = "h-7 gap-1.5 text-[12px] text-muted-foreground";

function TypeMenu(typeFilter: Signal<NotificationType | null>) {
	// The radio group drives its own writable value, so the filter is mirrored
	// into one rather than bound to — the same shape the issue pickers use.
	const value = signal<string | null>(typeFilter.get() ?? ANY_TYPE);

	return DropdownMenu(
		ImplementEffect([typeFilter], (next) => value.set(next ?? ANY_TYPE)),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: menuTriggerClass },
			ListFilter({ class: "size-3.5" }),
			typeFilter.bind((current) => (current === null ? "All types" : TYPE_LABELS[current])),
		),
		DropdownMenuContent(
			{ class: "w-44", align: "end", hotkeys: true },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (next) => {
						if (typeof next !== "string") return;
						typeFilter.set(next === ANY_TYPE ? null : (next as NotificationType));
					},
				},
				DropdownMenuGroupHeading("Type"),
				DropdownMenuRadioItem({ value: ANY_TYPE }, Span({ class: "flex-1" }, "All types")),
				...NOTIFICATION_TYPES.map((type) =>
					DropdownMenuRadioItem(
						{ value: type },
						TypeIcon(type),
						Span({ class: "flex-1" }, TYPE_LABELS[type]),
					),
				),
			),
		),
	);
}

function OrderMenu(order: Signal<NotificationOrder>) {
	const value = signal<string | null>(order.get());

	return DropdownMenu(
		ImplementEffect([order], (next) => value.set(next)),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: menuTriggerClass },
			ArrowUpDown({ class: "size-3.5" }),
			order.bind((current) => ORDER_LABELS[current]),
		),
		DropdownMenuContent(
			{ class: "w-40", align: "end", hotkeys: true },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (next) => {
						if (next === "newest" || next === "oldest") order.set(next);
					},
				},
				DropdownMenuGroupHeading("Sort"),
				DropdownMenuRadioItem({ value: "newest" }, Span({ class: "flex-1" }, ORDER_LABELS.newest)),
				DropdownMenuRadioItem({ value: "oldest" }, Span({ class: "flex-1" }, ORDER_LABELS.oldest)),
			),
		),
	);
}

/**
 * One row. Selecting is what a click does now — following through to the issue
 * is the detail pane's job, so a click no longer navigates away from the inbox.
 */
function NotificationRow(
	entry: Readable<Notification>,
	selected: Readable<Notification | null>,
	select: (id: string) => void,
) {
	const current = entry.get();
	const isSelected = derived([entry, selected], (value, active) => active?.id === value.id);

	return Div(
		{
			"data-notification": current.id,
			role: "button",
			tabIndex: 0,
			class: derived([entry, isSelected], (value, active) =>
				cn(
					"row-hover flex w-full cursor-default items-start gap-2.5 border-b border-border/40 px-3 py-3 text-left",
					!value.read && "bg-primary/[0.04]",
					active && "bg-accent hover:bg-accent",
				),
			),
			onClick: () => select(current.id),
		},

		// The unread dot, kept in the gutter so rows stay aligned either way.
		Span({
			class: entry.bind((value) =>
				cn("mt-1.5 size-1.5 shrink-0 rounded-full", value.read ? "bg-transparent" : "bg-primary"),
			),
		}),
		UserAvatar(current.actor, "mt-0.5"),

		Div(
			{ class: "min-w-0 flex-1" },
			Div(
				{ class: "flex items-center gap-1.5 text-[11px] text-muted-foreground" },
				TypeIcon(current.type, "size-3"),
				Span({ class: "truncate" }, TYPE_LABELS[current.type]),
				Span(
					{ class: "ml-auto shrink-0" },
					entry.bind((value) => relativeTime(value.createdAt)),
				),
			),
			Div(
				{
					class: entry.bind((value) =>
						cn("mt-0.5 line-clamp-2 text-[13px]", value.read ? "" : "font-medium"),
					),
				},
				entry.bind("body"),
			),
			If(
				entry.bind((value) => value.issue !== null),
				Div(
					{ class: "mt-1 flex items-center gap-2 text-[12px] text-muted-foreground" },
					Span(
						{ class: "shrink-0 font-mono" },
						entry.bind((value) => value.issue?.identifier ?? ""),
					),
					Span(
						{ class: "truncate" },
						entry.bind((value) => value.issue?.title ?? ""),
					),
				),
			),
		),
	);
}

/**
 * The right-hand pane: a bar saying why this is in your inbox, and under it the
 * thing it is about.
 *
 * For everything that names an issue — assignments, status changes, comments —
 * that is the issue itself, the same view its own page shows. A summary card
 * only restated the row you clicked, and left every reply and every reassign
 * one navigation further away.
 */
function DetailPane(
	selected: Readable<Notification | null>,
	params: { slug: Readable<string> },
	setRead: (ids: string[] | undefined, read: boolean) => Promise<void>,
	context: IssuePaneContext,
) {
	const identifier = selected.bind((value) => value?.issue?.identifier ?? "");

	return If(selected.bind((value) => value !== null))
		.Then(
			Div(
				{ class: "flex min-h-0 flex-1 flex-col" },

				Div(
					{ class: "flex h-12 shrink-0 items-center gap-2 border-b border-border px-4" },
					Span(
						{
							class:
								"flex shrink-0 items-center gap-1.5 text-[12px] whitespace-nowrap text-muted-foreground",
						},
						Dynamic([selected], (value) =>
							value === null ? Span({}) : TypeIcon(value.type, "size-3.5"),
						),
						// The glyph alone carries it where the row is tight — the type is
						// also the first thing the list row says.
						Span(
							{ class: "hidden sm:inline" },
							selected.bind((value) => (value === null ? "" : TYPE_LABELS[value.type])),
						),
					),

					Div({ class: "flex-1" }),

					// Reading something you meant to keep for later should be undoable.
					Button(
						{
							variant: "ghost",
							size: "sm",
							class: "gap-1.5 text-[12px]",
							onClick: () => {
								const current = selected.get();
								if (current === null) return;
								void setRead([current.id], !current.read);
							},
						},
						Dynamic([selected], (value) =>
							value?.read === true ? Mail({ class: "size-3.5" }) : MailOpen({ class: "size-3.5" }),
						),
						Span(
							{ class: "hidden sm:inline" },
							selected.bind((value) => (value?.read === true ? "Mark unread" : "Mark read")),
						),
					),

					If(
						selected.bind((value) => value?.issue != null),
						router.Link(
							{
								to: "/app/:slug/issue/:identifier",
								params: { slug: params.slug, identifier },
								class:
									"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium whitespace-nowrap hover:bg-accent",
							},
							ExternalLink({ class: "size-3.5" }),
							"Open issue",
						),
					),
				),

				// What the notification said, in one line. The row you clicked is
				// scrolled away up the list by the time you are reading down here.
				Div(
					{ class: "flex shrink-0 items-center gap-2 border-b border-border px-4 py-2" },
					Dynamic([selected], (value) =>
						value === null ? Span({}) : UserAvatar(value.actor, "size-5"),
					),
					Span(
						{ class: "min-w-0 truncate text-[13px]" },
						selected.bind((value) => value?.body ?? ""),
					),
					Span(
						{ class: "ml-auto hidden shrink-0 text-[11px] text-muted-foreground sm:block" },
						selected.bind((value) => (value === null ? "" : fullTime(value.createdAt))),
					),
				),

				// The issue, whole. An invite names none, so that one keeps the card.
				If(selected.bind((value) => value?.issue != null))
					.Then(InboxIssuePane({ slug: params.slug, identifier, context }))
					.Else(
						Div(
							{ class: "min-h-0 flex-1 overflow-y-auto px-6 py-5" },
							Div(
								{ class: "flex items-start gap-3" },
								Div(
									{ class: "mt-0.5" },
									Dynamic([selected], (value) =>
										value === null ? Span({}) : UserAvatar(value.actor),
									),
								),
								Div(
									{ class: "min-w-0 flex-1" },
									H2(
										{ class: "text-[15px] leading-snug font-medium" },
										selected.bind((value) => value?.body ?? ""),
									),
									P(
										{ class: "mt-1 text-[12px] text-muted-foreground" },
										selected.bind((value) =>
											value === null ? "" : `${value.actor.name} · ${fullTime(value.createdAt)}`,
										),
									),
								),
							),
						),
					),
			),
		)
		.Else(
			Empty(
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, Inbox({ "aria-hidden": true })),
					EmptyTitle("Nothing selected"),
					EmptyDescription("Pick a notification on the left to read it here."),
				),
			),
		);
}

/** Why the list is empty: filtered down to nothing, or genuinely empty. */
function ListEmptyState(
	readFilter: Readable<ReadFilter>,
	typeFilter: Readable<NotificationType | null>,
	notifications: Readable<Notification[]>,
) {
	return If(notifications.bind((list) => list.length > 0))
		.Then(
			Empty(
				{ class: "p-6" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, ListFilter({ "aria-hidden": true })),
					EmptyTitle("Nothing matches"),
					EmptyDescription(
						derived([readFilter, typeFilter], (read, type) =>
							read === "unread" && type === null
								? "You are all caught up."
								: "No notification matches these filters.",
						),
					),
				),
			),
		)
		.Else(
			Empty(
				{ class: "p-6" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, Inbox({ "aria-hidden": true })),
					EmptyTitle("Nothing here yet"),
					EmptyDescription("Assignments, status changes and comments land here."),
				),
			),
		);
}
