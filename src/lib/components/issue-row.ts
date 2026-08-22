import { router } from "$implement/router";
import { Div, ForEach, If, Span, type Readable } from "@implementjs/core";
import { InlineMarkdown } from "@/lib/components/markdown";
import { ReactivePriorityIcon } from "@/lib/components/priority-icon";
import { ReactiveStatusIcon } from "@/lib/components/status-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/lib/components/ui/avatar";
import type { IssueDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** `2h`, `3d`, `Apr 12` — short enough to sit at the end of a row. */
function relative(iso: string): string {
	const then = new Date(iso).getTime();
	const seconds = Math.round((Date.now() - then) / 1000);
	if (seconds < 60) return "now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
	if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
	return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("");
}

/**
 * The reactive form. `Key` cannot help here: it re-invokes the mountable it was
 * given, which has already captured its user — so the bindings have to be on
 * the inside.
 */
export function ReactiveUserAvatar(
	user: Readable<{ id: string; name: string; image: string | null } | null>,
	className?: string,
) {
	return If(user.bind((value) => value === null))
		.Then(
			Div({
				class: cn(
					"size-5 shrink-0 rounded-full border border-dashed border-muted-foreground/40",
					className,
				),
				title: "Unassigned",
			}),
		)
		.Else(
			Avatar(
				{ class: cn("size-5 shrink-0", className), title: user.bind((value) => value?.name ?? "") },
				AvatarImage({
					src: user.bind((value) => value?.image ?? ""),
					alt: user.bind((value) => value?.name ?? ""),
				}),
				AvatarFallback(
					{ class: "text-[10px]" },
					user.bind((value) => (value === null ? "" : initials(value.name))),
				),
			),
		);
}

export function UserAvatar(
	user: { name: string; image: string | null } | null,
	className?: string,
) {
	if (user === null) {
		return Div({
			class: cn(
				"size-5 shrink-0 rounded-full border border-dashed border-muted-foreground/40",
				className,
			),
			title: "Unassigned",
		});
	}

	return Avatar(
		{ class: cn("size-5 shrink-0", className), title: user.name },
		user.image === null ? null : AvatarImage({ src: user.image, alt: user.name }),
		AvatarFallback({ class: "text-[10px]" }, initials(user.name)),
	);
}

export type IssueRowProps = {
	issue: Readable<IssueDto>;
	workspace: string;
	/** Highlighted by keyboard navigation. */
	active: Readable<boolean>;
	onFocus?: () => void;
};

/**
 * One line of the issue list. Everything reads through bindings so a change
 * arriving over SSE repaints the row rather than rebuilding the list.
 */
export function IssueRow({ issue, workspace, active, onFocus }: IssueRowProps) {
	return router.Link(
		{
			to: "/:workspace/issue/:identifier",
			params: { workspace, identifier: issue.bind("identifier") },
			onMouseenter: onFocus,
			class: active.bind((isActive) =>
				cn(
					"group flex items-center gap-3 border-b px-4 py-2 text-sm transition-colors last:border-b-0",
					isActive ? "bg-accent" : "hover:bg-accent/50",
				),
			),
		},

		ReactivePriorityIcon(issue.bind("priority")),
		ReactiveStatusIcon(issue.bind("status")),

		Span(
			{ class: "w-24 shrink-0 truncate font-mono text-xs text-muted-foreground" },
			issue.bind("identifier"),
		),

		InlineMarkdown(issue.bind("titleHtml"), "min-w-0 flex-1 truncate"),

		Div(
			{ class: "flex shrink-0 items-center gap-1.5" },
			ForEach(
				issue.bind("labels"),
				(label) => label.id,
				(label) =>
					Span(
						{
							class:
								"hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex",
						},
						Span({
							class: "size-2 rounded-full",
							style: { backgroundColor: label.bind("color") },
						}),
						label.bind("name"),
					),
			),
		),

		If(issue.bind((value) => value.repo !== null)).Then(
			Span(
				{ class: "hidden shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground md:inline" },
				issue.bind((value) => value.repo?.name ?? ""),
			),
		),

		If(issue.bind((value) => value.commentCount > 0)).Then(
			Span(
				{ class: "shrink-0 text-xs text-muted-foreground" },
				issue.bind((value) => `${value.commentCount}`),
			),
		),

		Span(
			{ class: "w-12 shrink-0 text-right text-xs text-muted-foreground" },
			issue.bind((value) => relative(value.updatedAt)),
		),

		ReactiveUserAvatar(issue.bind("assignee")),
	);
}
