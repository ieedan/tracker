import { router } from "$implement/router";
import {
	Div,
	ForEach,
	H1,
	If,
	Input,
	Span,
	derived,
	signal,
	type Readable,
} from "@implementjs/core";
import { ArrowRight, ExternalLink, Search } from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
import {
	FEEDBACK_STATUSES,
	FEEDBACK_STATUS_LABELS,
	type FeedbackStatus,
} from "@/lib/domain/feedback";
import type { Feedback, Label, Team, Workspace } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { LabelChips } from "@/lib/features/issues/pickers";
import { FeedbackStatusIcon } from "./glyphs";
import { patchFeedback } from "./feedback-store";
import { FeedbackLabelPicker, FeedbackStatusPicker, VisibilityIcon } from "./pickers";
import { ConvertButton } from "./convert";

interface PageData {
	feedback: Feedback[];
	workspace: Workspace;
	teams: Team[];
	labels: Label[];
}

export function FeedbackListPage({
	data,
	params,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
}) {
	const feedback = signal(data.get().feedback);
	data.onChange((next) => feedback.set(next.feedback));

	const query = signal("");
	/** `null` means every status — the default view. */
	const statusFilter = signal<FeedbackStatus | null>(null);

	const visible = derived([feedback, query, statusFilter], (list, term, status) => {
		const needle = term.trim().toLowerCase();
		const byStatus = status === null ? list : list.filter((entry) => entry.status === status);
		if (needle === "") return byStatus;
		return byStatus.filter(
			(entry) =>
				entry.title.toLowerCase().includes(needle) ||
				entry.description.toLowerCase().includes(needle) ||
				entry.identifier.toLowerCase().includes(needle),
		);
	});

	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },

		Div(
			{ class: "flex h-12 shrink-0 items-center gap-3 border-b border-border px-4" },
			H1({ class: "text-[15px] font-semibold tracking-tight" }, "User feedback"),
			Span(
				{ class: "rounded bg-secondary px-1.5 text-[11px] text-muted-foreground" },
				visible.bind((list) => `${list.length}`),
			),

			StatusTabs(statusFilter, feedback),

			Div(
				{ class: "relative ml-auto" },
				Search({
					class:
						"pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground",
				}),
				Input({
					value: query,
					placeholder: "Search feedback…",
					class:
						"h-7 w-56 rounded-md border border-input bg-background pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring",
				}),
			),

			// Only worth offering when there is a board to look at.
			If(
				data.bind((value) => value.workspace.feedbackBoard === "public"),
				Button(
					{
						size: "sm",
						variant: "secondary",
						class: "gap-1.5",
						onClick: () => window.open(`/${params.slug.get()}/public/feedback`, "_blank"),
					},
					ExternalLink({ class: "size-3.5" }),
					"Public board",
				),
			),
		),

		Div(
			{ class: "min-h-0 flex-1 overflow-y-auto" },
			If(
				visible.bind((list) => list.length === 0),
				EmptyState(query, statusFilter, data),
			),
			ForEach(
				visible,
				(entry) => entry.id,
				(entry) => FeedbackRow(entry, feedback, data, params),
			),
		),
	);
}

/** New first — the whole job of this screen is working through the new ones. */
function StatusTabs(
	statusFilter: ReturnType<typeof signal<FeedbackStatus | null>>,
	feedback: Readable<Feedback[]>,
) {
	const tab = (status: FeedbackStatus | null, label: string) => {
		const count = derived([feedback], (list) =>
			status === null ? list.length : list.filter((entry) => entry.status === status).length,
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
		{ class: "flex items-center gap-0.5" },
		tab(null, "All"),
		...FEEDBACK_STATUSES.map((status) => tab(status, FEEDBACK_STATUS_LABELS[status])),
	);
}

function FeedbackRow(
	entry: Readable<Feedback>,
	feedback: ReturnType<typeof signal<Feedback[]>>,
	data: Readable<PageData>,
	params: { slug: Readable<string> },
) {
	const slug = params.slug;
	const id = entry.get().id;

	return Div(
		{
			class:
				"row-hover group flex min-h-11 items-center gap-2 border-b border-border/40 px-4 text-[13px]",
		},

		FeedbackStatusPicker(
			entry.bind("status"),
			(status) =>
				void patchFeedback(feedback, slug.get(), id, { status }, (value) => ({ ...value, status })),
		),

		Span(
			{ class: "w-12 shrink-0 font-mono text-[12px] text-muted-foreground" },
			entry.bind("identifier"),
		),

		router.Link(
			{
				to: "/app/:slug/feedback/:number",
				params: { slug, number: entry.bind((value) => `${value.number}`) },
				class: "min-w-0 flex-1 truncate hover:underline",
			},
			entry.bind("title"),
		),

		Div(
			{ class: "flex shrink-0 items-center gap-1.5" },
			// Who asked, when it is known. Anonymous board posts show nothing
			// rather than a placeholder that implies a missing name.
			If(
				entry.bind((value) => value.submitter.name !== null || value.submitter.email !== null),
				Span(
					{ class: "max-w-[12rem] truncate text-[12px] text-muted-foreground" },
					entry.bind((value) => value.submitter.name ?? value.submitter.email ?? ""),
				),
			),

			If(
				entry.bind((value) => value.source !== null),
				Span(
					{
						class: "rounded border border-border px-1 font-mono text-[10px] text-muted-foreground",
					},
					entry.bind((value) => value.source ?? ""),
				),
			),

			If(
				entry.bind((value) => value.commentCount > 0),
				Span(
					{ class: "text-[11px] text-muted-foreground" },
					entry.bind((value) => `${value.commentCount} 💬`),
				),
			),

			VisibilityIcon(entry.bind("visibility"), "text-muted-foreground"),

			LabelChips(entry.bind("labels")),

			// The picker is hover-only: a row with no labels showing the word
			// "Label" ten times down the page is noise, and every row here has
			// no labels until someone triages it.
			Div(
				{ class: "opacity-0 transition-opacity group-hover:opacity-100" },
				FeedbackLabelPicker(
					entry.bind("labels"),
					data.bind((value) => value.labels),
					(labelId) => {
						const current = entry.get().labels;
						const next = current.some((label) => label.id === labelId)
							? current.filter((label) => label.id !== labelId)
							: [...current, data.get().labels.find((label) => label.id === labelId)!];
						void patchFeedback(
							feedback,
							slug.get(),
							id,
							{ labelIds: next.map((label) => label.id) },
							(value) => ({ ...value, labels: next }),
						);
					},
				),
			),
		),

		Span(
			{ class: "w-10 shrink-0 text-right text-[12px] text-muted-foreground" },
			entry.bind((value) => relativeTime(value.createdAt)),
		),

		// Converted feedback shows where it went; the rest offers the one click.
		If(entry.bind((value) => value.issue !== null))
			.Then(
				router.Link(
					{
						to: "/app/:slug/issue/:identifier",
						params: { slug, identifier: entry.bind((value) => value.issue?.identifier ?? "") },
						class:
							"flex w-28 shrink-0 items-center justify-end gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline",
					},
					ArrowRight({ class: "size-3" }),
					entry.bind((value) => value.issue?.identifier ?? ""),
				),
			)
			.Else(
				Div(
					{ class: "flex w-28 shrink-0 justify-end" },
					ConvertButton({
						slug,
						feedback: entry,
						teams: data.bind((value) => value.teams),
						list: feedback,
					}),
				),
			),
	);
}

function EmptyState(
	query: Readable<string>,
	statusFilter: Readable<FeedbackStatus | null>,
	data: Readable<PageData>,
) {
	return Div(
		{ class: "flex flex-col items-center justify-center gap-3 px-6 py-24 text-center" },
		Div(
			{ class: "text-[13px] text-muted-foreground" },
			derived([query, statusFilter], (term, status) => {
				if (term.trim() !== "") return `Nothing matches “${term}”.`;
				if (status !== null)
					return `No feedback is ${FEEDBACK_STATUS_LABELS[status].toLowerCase()}.`;
				return "No feedback yet.";
			}),
		),
		Div(
			{ class: "max-w-md text-[12px] text-muted-foreground/80" },
			data.bind((value) =>
				value.workspace.feedbackIntake === "disabled"
					? "Feedback intake is closed. Open it in Settings to start collecting."
					: `POST to /api/v1/workspaces/${value.workspace.slug}/user-feedback to send some.`,
			),
		),
	);
}
