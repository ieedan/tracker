import { router } from "$implement/router";
import {
	Div,
	H1,
	If,
	P,
	Span,
	derived,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import { ArrowRight, ChevronLeft, ExternalLink, Mail } from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
import { LabelChips } from "@/lib/features/issues/pickers";
import type { Feedback, FeedbackComment, Label, Team, Workspace } from "@/lib/domain/schemas";
import { fullTime } from "@/lib/format";
import { ConvertButton } from "./convert";
import { patchFeedback } from "./feedback-store";
import { FeedbackLabelPicker, FeedbackStatusPicker, VisibilityPicker } from "./pickers";
import { FeedbackThread } from "./thread";

interface PageData {
	feedback: Feedback;
	comments: FeedbackComment[];
	workspace: Workspace;
	teams: Team[];
	labels: Label[];
}

export function FeedbackDetailPage({
	data,
	params,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string>; number: Readable<string> };
}) {
	// `patchFeedback` works over a list, so this page keeps a list of one.
	const list = signal<Feedback[]>([data.get().feedback]);
	data.onChange((next) => list.set([next.feedback]));
	const entry = list.bind((values) => values[0]!);

	const comments = signal(data.get().comments);
	data.onChange((next) => comments.set(next.comments));

	const boardOpen = data.bind((value) => value.workspace.feedbackBoard === "public");

	// There is only a public page to open when both the board is on and this
	// particular item is on it.
	const hasPublicPage = derived(
		[entry, boardOpen],
		(value, open) => open && value.visibility === "public",
	);

	const update = (
		patch: Parameters<typeof patchFeedback>[3],
		apply: (value: Feedback) => Feedback,
	) => void patchFeedback(list, params.slug.get(), data.get().feedback.id, patch, apply);

	return Div(
		{ class: "flex min-h-0 flex-1" },

		Div(
			{ class: "flex min-w-0 flex-1 flex-col" },
			Div(
				{ class: "flex h-12 shrink-0 items-center gap-2 border-b border-border px-4" },
				router.Link(
					{
						to: "/app/:slug/feedback",
						params: { slug: params.slug },
						class:
							"flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground",
					},
					ChevronLeft({ class: "size-3.5" }),
					"User feedback",
				),
				Span({ class: "text-muted-foreground" }, "/"),
				Span({ class: "font-mono text-[12px] text-muted-foreground" }, entry.bind("identifier")),

				Div(
					{ class: "ml-auto flex items-center gap-2" },
					If(
						hasPublicPage,
						Button(
							{
								size: "sm",
								variant: "ghost",
								class: "h-7 gap-1.5 text-[12px] text-muted-foreground",
								onClick: () =>
									window.open(
										`/${params.slug.get()}/public/feedback/${entry.get().number}`,
										"_blank",
									),
							},
							ExternalLink({ class: "size-3.5" }),
							"View public page",
						),
					),
					If(entry.bind((value) => value.issue === null))
						.Then(
							ConvertButton({
								slug: params.slug,
								feedback: entry,
								teams: data.bind((value) => value.teams),
								list,
							}),
						)
						.Else(
							router.Link(
								{
									to: "/app/:slug/issue/:identifier",
									params: {
										slug: params.slug,
										identifier: entry.bind((value) => value.issue?.identifier ?? ""),
									},
									class:
										"flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 font-mono text-[11px] hover:bg-accent",
									title: "Open the issue this became",
								},
								ArrowRight({ class: "size-3" }),
								entry.bind((value) => value.issue?.identifier ?? ""),
							),
						),
				),
			),

			Div(
				{ class: "min-h-0 flex-1 overflow-y-auto px-8 py-6" },
				Div(
					{ class: "mx-auto flex max-w-3xl flex-col gap-6" },

					H1({ class: "text-2xl font-semibold tracking-tight" }, entry.bind("title")),

					// The submitter's own words, shown as written. Feedback is not
					// edited in place the way an issue is — rewriting what somebody
					// told you and then quoting it back is how the record stops
					// meaning anything.
					If(entry.bind((value) => value.description.trim() !== ""))
						.Then(
							Div(
								{ class: "text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90" },
								entry.bind("description"),
							),
						)
						.Else(
							Div({ class: "text-[13px] text-muted-foreground italic" }, "No description given."),
						),

					FeedbackThread({
						comments,
						slug: params.slug,
						feedbackId: entry.bind((value) => value.id),
						canPost: signal(true),
						canNote: signal(true),
					}),
				),
			),
		),

		Div(
			{ class: "hidden w-64 shrink-0 flex-col gap-4 border-l border-border p-4 lg:flex" },
			PropertyRow(
				"Status",
				FeedbackStatusPicker(
					entry.bind("status"),
					(status) => update({ status }, (value) => ({ ...value, status })),
					{ showLabel: true },
				),
			),
			PropertyRow(
				"Visibility",
				VisibilityPicker(entry.bind("visibility"), boardOpen, (visibility) =>
					update({ visibility }, (value) => ({ ...value, visibility })),
				),
			),
			PropertyRow(
				"Labels",
				Div(
					{ class: "flex flex-col items-start gap-1.5" },
					Div({ class: "flex flex-wrap gap-1" }, LabelChips(entry.bind("labels"))),
					FeedbackLabelPicker(
						entry.bind("labels"),
						data.bind((value) => value.labels),
						(labelId) => {
							const current = entry.get().labels;
							const next = current.some((label) => label.id === labelId)
								? current.filter((label) => label.id !== labelId)
								: [...current, data.get().labels.find((label) => label.id === labelId)!];
							update({ labelIds: next.map((label) => label.id) }, (value) => ({
								...value,
								labels: next,
							}));
						},
					),
				),
			),

			Div(
				{ class: "mt-2 flex flex-col gap-2 border-t border-border pt-3" },
				Span({ class: "text-[11px] font-medium text-muted-foreground" }, "Submitted by"),
				Div(
					{ class: "text-[12px]" },
					entry.bind((value) => value.submitter.name ?? value.submitter.email ?? "Anonymous"),
				),
				If(
					entry.bind((value) => value.submitter.email !== null),
					Div(
						{ class: "flex items-center gap-1.5 text-[11px] text-muted-foreground" },
						Mail({ class: "size-3" }),
						Span(
							{ class: "truncate" },
							entry.bind((value) => value.submitter.email ?? ""),
						),
					),
				),
				If(
					entry.bind((value) => value.source !== null),
					Div(
						{ class: "text-[11px] text-muted-foreground" },
						entry.bind((value) => `via ${value.source ?? ""}`),
					),
				),
			),

			Div(
				{ class: "border-t border-border pt-3 text-[11px] text-muted-foreground" },
				P(
					{},
					entry.bind((value) => `Received ${fullTime(value.createdAt)}`),
				),
				P(
					{},
					entry.bind((value) =>
						value.subscriberCount === 1
							? "1 person subscribed to updates"
							: `${value.subscriberCount} people subscribed to updates`,
					),
				),
			),
		),
	);
}

function PropertyRow(label: string, control: Child) {
	return Div(
		{ class: "flex items-center gap-2" },
		Span({ class: "w-16 shrink-0 text-[12px] text-muted-foreground" }, label),
		Div({ class: "min-w-0 flex-1" }, control),
	);
}
