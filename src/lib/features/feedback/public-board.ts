/**
 * The public feedback board.
 *
 * Deliberately not the workspace tab with things hidden. It is a different
 * audience — people who sent feedback and want to know what happened to it —
 * so it is a different page: no triage controls, no submitter addresses, no
 * internal notes, and a subscribe box where the team's tools would be.
 *
 * The only thing that needs an account is replying, which is what stops the
 * board from becoming a comment spam target.
 */
import { router } from "$implement/router";
import {
	A,
	Div,
	ForEach,
	H1,
	H2,
	If,
	ImplementHead,
	Input,
	P,
	Span,
	derived,
	signal,
	type Readable,
} from "@implementjs/core";
import { ChevronLeft, Mail, MessageSquareQuote, Search } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import {
	FEEDBACK_STATUSES,
	FEEDBACK_STATUS_LABELS,
	type FeedbackStatus,
} from "@/lib/domain/feedback";
import type { Feedback, FeedbackComment } from "@/lib/domain/schemas";
import { fullTime, relativeTime } from "@/lib/format";
import { FeedbackStatusIcon } from "./glyphs";
import { FeedbackThread } from "./thread";

interface BoardData {
	workspaceName: string;
	slug: string;
	feedback: Feedback[];
	signedIn: boolean;
}

export function PublicBoardPage({ data }: { data: Readable<BoardData> }) {
	const query = signal("");
	const statusFilter = signal<FeedbackStatus | null>(null);

	const visible = derived([data, query, statusFilter], (value, term, status) => {
		const needle = term.trim().toLowerCase();
		const byStatus =
			status === null ? value.feedback : value.feedback.filter((entry) => entry.status === status);
		if (needle === "") return byStatus;
		return byStatus.filter(
			(entry) =>
				entry.title.toLowerCase().includes(needle) ||
				entry.description.toLowerCase().includes(needle),
		);
	});

	return Div(
		{ class: "min-h-dvh bg-background" },
		// A public page is shared and bookmarked, so the tab title has to say
		// whose board it is.
		ImplementHead(ImplementHead.Title(data.bind((value) => `Feedback · ${value.workspaceName}`))),

		Div(
			{ class: "border-b border-border" },
			Div(
				{ class: "mx-auto flex max-w-3xl flex-col gap-1 px-4 py-6 sm:px-6 sm:py-8" },
				H1(
					{ class: "text-2xl font-semibold tracking-tight" },
					data.bind((value) => `${value.workspaceName} feedback`),
				),
				P(
					{ class: "text-[13px] text-muted-foreground" },
					"What people have asked for, and where each request has got to.",
				),
			),
		),

		Div(
			{ class: "mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6" },

			Div(
				{ class: "flex flex-wrap items-center gap-2" },
				StatusFilter(statusFilter, data),
				Input({
					value: query,
					placeholder: "Search…",
					class:
						"ml-auto h-8 w-48 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring",
				}),
			),

			If(visible.bind((list) => list.length === 0))
				.Then(BoardEmpty(query, statusFilter))
				.Else(
					Div(
						{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
						ForEach(
							visible,
							(entry) => entry.id,
							(entry) => BoardRow(entry, data),
						),
					),
				),
		),
	);
}

function BoardEmpty(query: Readable<string>, statusFilter: Readable<FeedbackStatus | null>) {
	return If(
		query.bind((term) => term.trim() !== ""),
		Empty(
			{ class: "border" },
			EmptyHeader(
				EmptyMedia({ variant: "icon" }, Search({ "aria-hidden": true })),
				EmptyTitle("Nothing matches"),
				EmptyDescription(query.bind((term) => `Nothing matches “${term.trim()}”.`)),
			),
		),
	)
		.ElseIf(
			statusFilter.bind((status) => status !== null),
			Empty(
				{ class: "border" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, MessageSquareQuote({ "aria-hidden": true })),
					EmptyTitle("Nothing in this status"),
					EmptyDescription(
						statusFilter.bind((status) =>
							status === null
								? ""
								: `Nothing is ${FEEDBACK_STATUS_LABELS[status].toLowerCase()} right now.`,
						),
					),
				),
			),
		)
		.Else(
			Empty(
				{ class: "border" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, MessageSquareQuote({ "aria-hidden": true })),
					EmptyTitle("No public feedback yet"),
					EmptyDescription("What people ask for will show up here."),
				),
			),
		);
}

function StatusFilter(
	statusFilter: ReturnType<typeof signal<FeedbackStatus | null>>,
	data: Readable<BoardData>,
) {
	const chip = (status: FeedbackStatus | null, label: string) => {
		const count = derived([data], (value) =>
			status === null
				? value.feedback.length
				: value.feedback.filter((entry) => entry.status === status).length,
		);
		const active = derived([statusFilter], (current) => current === status);

		return Button(
			{
				size: "sm",
				variant: "ghost",
				class: active.bind((isActive) =>
					isActive
						? "h-7 gap-1.5 bg-accent text-[12px] text-accent-foreground"
						: "h-7 gap-1.5 text-[12px] text-muted-foreground",
				),
				onClick: () => statusFilter.set(status),
			},
			status === null ? null : FeedbackStatusIcon(status),
			label,
			Span(
				{ class: "text-[11px] text-muted-foreground" },
				count.bind((value) => `${value}`),
			),
		);
	};

	return Div(
		{ class: "flex flex-wrap items-center gap-0.5" },
		chip(null, "All"),
		// Declined is on the board, but not in the filter row — nobody browses a
		// feedback board looking for the things that were turned down.
		...FEEDBACK_STATUSES.filter((status) => status !== "declined").map((status) =>
			chip(status, FEEDBACK_STATUS_LABELS[status]),
		),
	);
}

function BoardRow(entry: Readable<Feedback>, data: Readable<BoardData>) {
	return router.Link(
		{
			to: "/:slug/public/feedback/:number",
			params: {
				slug: data.bind((value) => value.slug),
				number: entry.bind((value) => `${value.number}`),
			},
			class: "flex items-center gap-3 px-4 py-3 hover:bg-accent/40",
		},
		FeedbackStatusIcon(entry.bind("status")),
		Div(
			{ class: "min-w-0 flex-1" },
			Div({ class: "truncate text-[13px] font-medium" }, entry.bind("title")),
			Div(
				{ class: "truncate text-[12px] text-muted-foreground" },
				entry.bind((value) =>
					value.description.trim() === ""
						? FEEDBACK_STATUS_LABELS[value.status]
						: value.description,
				),
			),
		),
		If(
			entry.bind((value) => value.commentCount > 0),
			Span(
				{ class: "shrink-0 text-[11px] text-muted-foreground" },
				entry.bind((value) => `${value.commentCount} 💬`),
			),
		),
		Span(
			{ class: "shrink-0 text-[11px] text-muted-foreground" },
			entry.bind((value) => relativeTime(value.createdAt)),
		),
	);
}

// ---------------------------------------------------------------------------

interface DetailData {
	workspaceName: string;
	slug: string;
	feedback: Feedback;
	comments: FeedbackComment[];
	signedIn: boolean;
}

export function PublicFeedbackPage({ data }: { data: Readable<DetailData> }) {
	const comments = signal(data.get().comments);
	data.onChange((next) => comments.set(next.comments));

	const entry = data.bind((value) => value.feedback);

	return Div(
		{ class: "min-h-dvh bg-background" },
		ImplementHead(
			ImplementHead.Title(data.bind((value) => `${value.feedback.title} · ${value.workspaceName}`)),
		),

		Div(
			{ class: "mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8" },

			router.Link(
				{
					to: "/:slug/public/feedback",
					params: { slug: data.bind((value) => value.slug) },
					class:
						"flex w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground",
				},
				ChevronLeft({ class: "size-3.5" }),
				"All feedback",
			),

			Div(
				{ class: "flex flex-col gap-2" },
				Div(
					{ class: "flex items-center gap-2" },
					FeedbackStatusIcon(entry.bind("status")),
					Span(
						{ class: "text-[12px] text-muted-foreground" },
						entry.bind((value) => FEEDBACK_STATUS_LABELS[value.status]),
					),
					Span(
						{ class: "text-[12px] text-muted-foreground" },
						entry.bind((value) => `· ${fullTime(value.createdAt)}`),
					),
				),
				H1({ class: "text-2xl font-semibold tracking-tight" }, entry.bind("title")),
			),

			If(entry.bind((value) => value.description.trim() !== ""))
				.Then(
					Div(
						{ class: "text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90" },
						entry.bind("description"),
					),
				)
				.Else(null),

			SubscribeCard(data),

			FeedbackThread({
				comments,
				slug: data.bind((value) => value.slug),
				feedback: entry,
				canPost: data.bind((value) => value.signedIn),
				signInPrompt: "Sign in to reply. An account keeps the board free of spam.",
			}),

			If(
				data.bind((value) => !value.signedIn),
				Div(
					{ class: "flex items-center gap-2 text-[12px] text-muted-foreground" },
					A({ href: "/login", class: "underline hover:text-foreground" }, "Sign in"),
					Span({}, "or"),
					A({ href: "/signup", class: "underline hover:text-foreground" }, "create an account"),
				),
			),
		),
	);
}

/** Collects an address so the person who asked hears when this moves. */
function SubscribeCard(data: Readable<DetailData>) {
	const email = signal("");
	const busy = signal(false);
	const done = signal(false);

	const subscribe = async () => {
		const address = email.get().trim();
		if (address === "") return;

		busy.set(true);
		const { error } = await api.POST("/api/v1/workspaces/[slug]/user-feedback/[id]/subscribe", {
			params: { slug: data.get().slug, id: data.get().feedback.id },
			body: { email: address },
		});
		busy.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not subscribe you"));
			return;
		}
		done.set(true);
		email.set("");
		toastSuccess("You will hear when this changes.");
	};

	return If(done)
		.Then(
			Div(
				{
					class:
						"flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-3 text-[12px] text-muted-foreground",
				},
				Mail({ class: "size-3.5" }),
				"You are subscribed to updates on this.",
			),
		)
		.Else(
			Div(
				{ class: "flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3" },
				H2({ class: "text-[13px] font-medium" }, "Get updates on this"),
				Div(
					{ class: "flex gap-2" },
					Input({
						value: email,
						type: "email",
						placeholder: "you@example.com",
						class:
							"h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring",
						onKeydown: (event) => {
							if (event.key === "Enter") void subscribe();
						},
					}),
					Button(
						{
							size: "sm",
							loading: busy,
							disabled: email.bind((value) => value.trim() === ""),
							onClick: () => void subscribe(),
						},
						"Subscribe",
					),
				),
				Span(
					{ class: "text-[11px] text-muted-foreground" },
					"Only used to tell you about this request.",
				),
			),
		);
}
