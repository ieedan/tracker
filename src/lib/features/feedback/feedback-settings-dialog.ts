/**
 * Feedback intake, set up from the screen it fills.
 *
 * Two choices — who may send feedback, and who may read it — plus the endpoint
 * URL, because the first thing anyone does after opening intake is paste it
 * into whatever is going to call it.
 *
 * The two mode signals belong to the page rather than this dialog: the list
 * header and its empty state read the same settings, and kit cannot re-run a
 * load after a mutation, so a save has to be visible without a reload.
 */
import {
	Code,
	Div,
	Dynamic,
	P,
	Pre,
	Span,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Check, Copy, ExternalLink } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/lib/components/ui/responsive-dialog";
import {
	FEEDBACK_BOARD_MODES,
	FEEDBACK_INTAKE_HINTS,
	FEEDBACK_INTAKE_LABELS,
	FEEDBACK_INTAKE_MODES,
	FEEDBACK_RATE_LIMITS,
	type FeedbackBoard,
	type FeedbackIntake,
} from "@/lib/domain/feedback";
import { cn } from "@/lib/utils";

const BOARD_LABELS: Record<FeedbackBoard, string> = {
	private: "Members only",
	public: "Anyone with the link",
};

const BOARD_HINTS: Record<FeedbackBoard, string> = {
	private: "Feedback stays inside the workspace. The public page returns 404.",
	public: "Feedback marked public is readable by anyone, and signed-in visitors can reply.",
};

export interface FeedbackSettingsDialogProps {
	open: Signal<boolean>;
	slug: Readable<string>;
	/** Owned by the page — this dialog writes the saved value back into them. */
	intake: Signal<FeedbackIntake>;
	board: Signal<FeedbackBoard>;
}

export function FeedbackSettingsDialog({ open, slug, intake, board }: FeedbackSettingsDialogProps) {
	const saving = signal(false);

	const save = async (patch: {
		feedbackIntake?: FeedbackIntake;
		feedbackBoard?: FeedbackBoard;
	}) => {
		const before = { intake: intake.get(), board: board.get() };
		if (patch.feedbackIntake !== undefined) intake.set(patch.feedbackIntake);
		if (patch.feedbackBoard !== undefined) board.set(patch.feedbackBoard);

		saving.set(true);
		const { data, error } = await api.PATCH("/api/v1/workspaces/[slug]", {
			params: { slug: slug.get() },
			body: patch,
		});
		saving.set(false);

		if (error !== undefined) {
			intake.set(before.intake);
			board.set(before.board);
			toastError(messageOf(error, "Could not save that"));
			return;
		}
		intake.set(data.feedbackIntake);
		board.set(data.feedbackBoard);

		// Closing the board un-publishes everything on it, which is a big enough
		// consequence to say out loud rather than leave to be discovered.
		if (patch.feedbackBoard === "private") {
			toastSuccess("Board closed. Everything on it is private again.");
		}
	};

	return ResponsiveDialog(
		{ open },
		ResponsiveDialogContent(
			{ class: "gap-0 p-0 md:max-w-lg" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle({ class: "text-[15px] font-semibold" }, "Feedback settings"),
				DialogDescription({ class: "text-[12px]" }, "Who can send feedback, and who can read it."),
			),

			Div(
				{ class: "flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 py-4" },

				OptionGroup(
					"Intake",
					FEEDBACK_INTAKE_MODES,
					intake,
					(mode) => FEEDBACK_INTAKE_LABELS[mode],
					(mode) => FEEDBACK_INTAKE_HINTS[mode],
					saving,
					(mode) => void save({ feedbackIntake: mode }),
				),

				OptionGroup(
					"Public board",
					FEEDBACK_BOARD_MODES,
					board,
					(mode) => BOARD_LABELS[mode],
					(mode) => BOARD_HINTS[mode],
					saving,
					(mode) => void save({ feedbackBoard: mode }),
				),

				EndpointCard(intake, slug),
			),

			Div(
				{ class: "flex items-center justify-between gap-2 border-t border-border px-4 py-2.5" },
				Button(
					{
						size: "sm",
						variant: "ghost",
						class: "gap-1.5 text-[12px] text-muted-foreground",
						disabled: board.bind((value) => value !== "public"),
						onClick: () => window.open(`/${slug.get()}/public/feedback`, "_blank"),
					},
					ExternalLink({ class: "size-3.5" }),
					"Open the public board",
				),
				// Every choice saves as it is made, so there is nothing to confirm.
				Button({ size: "sm", onClick: () => open.set(false) }, "Done"),
			),
		),
	);
}

/** A row of mutually exclusive choices, each carrying its own consequence. */
function OptionGroup<T extends string>(
	title: string,
	modes: readonly T[],
	current: Readable<T>,
	label: (mode: T) => string,
	hint: (mode: T) => string,
	saving: Readable<boolean>,
	onPick: (mode: T) => void,
) {
	return Div(
		{ class: "flex flex-col gap-1.5" },
		Span({ class: "text-[12px] font-medium" }, title),
		Div(
			{ class: "flex flex-col gap-1" },
			...modes.map((mode) => {
				const active = current.bind((value) => value === mode);
				return Button(
					{
						variant: "ghost",
						disabled: saving,
						class: active.bind((isActive) =>
							cn(
								// `whitespace-normal` undoes the button base's nowrap: the
								// hint has to wrap on a phone, not push the panel sideways.
								"h-auto w-full items-start justify-start gap-2 rounded-md border px-2.5 py-2 text-left whitespace-normal",
								isActive ? "border-primary bg-accent/50" : "border-border hover:bg-accent/40",
							),
						),
						onClick: () => onPick(mode),
					},
					Div(
						{ class: "mt-0.5 flex size-3.5 shrink-0 items-center justify-center" },
						// A `Readable<Mountable>` is not a valid child — swapping an
						// element needs `Dynamic`. See PAPERCUTS.md #5.
						Dynamic([active], (isActive) =>
							isActive ? Check({ class: "size-3.5 text-primary" }) : Span({}),
						),
					),
					Div(
						{ class: "flex min-w-0 flex-col gap-0.5" },
						Span({ class: "text-[13px] font-normal" }, label(mode)),
						Span({ class: "text-[11px] font-normal text-muted-foreground" }, hint(mode)),
					),
				);
			}),
		),
	);
}

/** The URL and a working request, ready to paste. */
function EndpointCard(intake: Readable<FeedbackIntake>, slug: Readable<string>) {
	const copied = signal(false);

	const path = slug.bind((value) => `/api/v1/workspaces/${value}/user-feedback`);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(`${window.location.origin}${path.get()}`);
			copied.set(true);
			setTimeout(() => copied.set(false), 1500);
		} catch {
			toastError("Could not copy — your browser refused clipboard access");
		}
	};

	return Div(
		{ class: "flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3" },
		Div(
			{ class: "flex items-center gap-2" },
			Span({ class: "text-[12px] font-medium" }, "Endpoint"),
			Code({ class: "min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" }, path),
			Button(
				{
					size: "icon-xs",
					variant: "ghost",
					class: "size-6",
					title: "Copy the full URL",
					onClick: () => void copy(),
				},
				Dynamic([copied], (done) =>
					done ? Check({ class: "size-3 text-primary" }) : Copy({ class: "size-3" }),
				),
			),
		),
		Pre(
			{
				class:
					"overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground",
			},
			derivedSample(intake, path),
		),
		P(
			{ class: "text-[11px] text-muted-foreground" },
			intake.bind((mode) =>
				mode === "public"
					? `Rate limited to ${FEEDBACK_RATE_LIMITS.public.limit} submissions per minute per IP.`
					: `Rate limited to ${FEEDBACK_RATE_LIMITS.api_key.limit} submissions per minute per API key.`,
			),
		),
	);
}

function derivedSample(intake: Readable<FeedbackIntake>, path: Readable<string>) {
	return intake.bind((mode) => {
		const auth = mode === "public" ? "" : ` \\\n  -H "x-api-key: $TRACKER_API_KEY"`;
		return [
			`curl -X POST ${path.get()} \\`,
			`  -H "content-type: application/json"${auth} \\`,
			`  -d '{"title":"Dark mode","email":"you@example.com","subscribe":true}'`,
		].join("\n");
	});
}
