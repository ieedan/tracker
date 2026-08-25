/**
 * The pull request attached to an issue.
 *
 * One at most, in both directions — which is why this is a single row that
 * swaps between "link one" and "here it is" rather than a list with an add
 * button. The input takes a URL, `owner/name#12`, or a bare `#12`, because
 * those are the three things somebody has on their clipboard.
 */
import { A, Div, If, Input, Span, signal, type Readable, type Signal } from "@implementjs/core";
import { GitPullRequest, Link2Off } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import {
	PULL_REQUEST_STATE_COLORS,
	PULL_REQUEST_STATE_LABELS,
	type PullRequestState,
} from "@/lib/domain/providers";
import type { Issue } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

type Linked = NonNullable<Issue["pullRequest"]>;

export function PullRequestLink(options: {
	slug: Readable<string>;
	identifier: Readable<string>;
	current: Signal<Linked | null>;
	/** Hidden entirely when the workspace has linked no repositories. */
	enabled: Readable<boolean>;
}) {
	const reference = signal("");
	const linking = signal(false);
	const editing = signal(false);

	const link = async () => {
		const value = reference.get().trim();
		if (value === "") return;

		linking.set(true);
		const { data, error } = await api.POST(
			"/api/v1/workspaces/[slug]/issues/[identifier]/pull-request",
			{
				params: { slug: options.slug.get(), identifier: options.identifier.get() },
				body: { reference: value },
			},
		);
		linking.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not link that pull request"));
			return;
		}
		options.current.set({
			id: data.id,
			number: data.number,
			title: data.title,
			state: data.state,
			url: data.url,
		});
		reference.set("");
		editing.set(false);
	};

	const unlink = async () => {
		const before = options.current.get();
		options.current.set(null);
		const { error } = await api.DELETE(
			"/api/v1/workspaces/[slug]/issues/[identifier]/pull-request",
			{ params: { slug: options.slug.get(), identifier: options.identifier.get() } },
		);
		if (error !== undefined) {
			options.current.set(before);
			toastError(messageOf(error, "Could not unlink"));
		}
	};

	return If(
		options.enabled,
		Div(
			{ class: "flex flex-col gap-1.5" },

			If(options.current.bind((value) => value !== null))
				.Then(
					Div(
						{ class: "group flex items-start gap-2" },
						PullRequestIcon(options.current.bind((value) => value?.state ?? "open")),
						A(
							{
								href: options.current.bind((value) => value?.url ?? "#"),
								target: "_blank",
								rel: "noreferrer",
								class: "min-w-0 flex-1 text-[12px] hover:underline",
							},
							Div(
								{ class: "truncate" },
								options.current.bind((value) => value?.title ?? ""),
							),
							Div(
								{ class: "text-[11px] text-muted-foreground" },
								options.current.bind((value) =>
									value === null
										? ""
										: `#${value.number} · ${PULL_REQUEST_STATE_LABELS[value.state]}`,
								),
							),
						),
						Button(
							{
								size: "icon-xs",
								variant: "ghost",
								class: "size-6 opacity-0 group-hover:opacity-100",
								title: "Unlink",
								onClick: () => void unlink(),
							},
							Link2Off({ class: "size-3" }),
						),
					),
				)
				.Else(
					If(editing)
						.Then(
							Div(
								{ class: "flex flex-col gap-1.5" },
								Input({
									value: reference,
									autofocus: true,
									placeholder: "URL, owner/repo#12, or #12",
									class:
										"h-7 w-full rounded-md border border-input bg-background px-2 text-[12px] outline-none focus:border-ring",
									onKeydown: (event) => {
										if (event.key === "Enter") void link();
										if (event.key === "Escape") editing.set(false);
									},
								}),
								Div(
									{ class: "flex items-center gap-1.5" },
									Button(
										{
											size: "sm",
											class: "h-6 px-2 text-[11px]",
											loading: linking,
											disabled: reference.bind((value) => value.trim() === ""),
											onClick: () => void link(),
										},
										"Link",
									),
									Button(
										{
											size: "sm",
											variant: "ghost",
											class: "h-6 px-2 text-[11px]",
											onClick: () => editing.set(false),
										},
										"Cancel",
									),
								),
							),
						)
						.Else(
							Button(
								{
									size: "sm",
									variant: "ghost",
									class: "h-6 justify-start gap-1.5 px-1.5 text-[12px] text-muted-foreground",
									onClick: () => editing.set(true),
								},
								GitPullRequest({ class: "size-3.5" }),
								"Link a pull request",
							),
						),
				),
		),
	);
}

export function PullRequestIcon(state: Readable<PullRequestState>, className?: string) {
	return GitPullRequest({
		class: state.bind((value) =>
			cn("size-3.5 shrink-0", PULL_REQUEST_STATE_COLORS[value], className),
		),
	});
}

/** The compact marker on an issue row. */
export function PullRequestBadge(pull: Readable<Issue["pullRequest"]>) {
	return If(
		pull.bind((value) => value !== null),
		Span(
			{
				class: "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
				title: pull.get()?.title,
			},
			PullRequestIcon(pull.bind((value) => value?.state ?? "open")),
			pull.bind((value) => (value === null ? "" : `#${value.number}`)),
		),
	);
}
