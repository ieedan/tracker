import { router } from "$implement/router";
import { Div, ForEach, H1, If, Span, signal, type Readable } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { UserAvatar } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import type { Notification, Workspace } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PageData {
	notifications: Notification[];
	workspace: Workspace;
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

	const unread = notifications.bind((list) => list.filter((entry) => !entry.read).length);

	const markAll = async () => {
		const before = notifications.get();
		notifications.set(before.map((entry) => ({ ...entry, read: true })));

		const { error } = await api.POST("/api/v1/notifications", { body: {} });
		if (error !== undefined) {
			notifications.set(before);
			toastError(messageOf(error, "Could not mark them read"));
		}
	};

	const markOne = async (id: string) => {
		const before = notifications.get();
		notifications.set(before.map((entry) => (entry.id === id ? { ...entry, read: true } : entry)));
		const { error } = await api.POST("/api/v1/notifications", { body: { ids: [id] } });
		if (error !== undefined) notifications.set(before);
	};

	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },
		Div(
			{ class: "flex h-12 shrink-0 items-center gap-3 border-b border-border px-4" },
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
			Div({ class: "flex-1" }),
			If(
				unread.bind((count) => count > 0),
				Button({ variant: "ghost", size: "sm", onClick: () => void markAll() }, "Mark all read"),
			),
		),

		Div(
			{ class: "min-h-0 flex-1 overflow-y-auto" },
			If(
				notifications.bind((list) => list.length === 0),
				Div(
					{ class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
					Span({ class: "text-[13px] text-muted-foreground" }, "Nothing here yet."),
					Span(
						{ class: "text-[12px] text-muted-foreground/70" },
						"Assignments, status changes and comments land here.",
					),
				),
			),
			ForEach(
				notifications,
				(entry) => entry.id,
				(entry) => NotificationRow(entry, params, markOne),
			),
		),
	);
}

function NotificationRow(
	entry: Readable<Notification>,
	params: { slug: Readable<string> },
	markOne: (id: string) => Promise<void>,
) {
	const current = entry.get();

	const body = Div(
		{
			class: cn(
				"row-hover flex items-start gap-3 border-b border-border/40 px-4 py-3",
				entry.get().read ? "" : "bg-primary/[0.04]",
			),
			onClick: () => {
				if (!entry.get().read) void markOne(entry.get().id);
			},
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
			Div({ class: "text-[13px]" }, entry.bind("body")),
			If(
				entry.bind((value) => value.issue !== null),
				Div(
					{ class: "mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground" },
					Span(
						{ class: "font-mono" },
						entry.bind((value) => value.issue?.identifier ?? ""),
					),
					Span(
						{ class: "truncate" },
						entry.bind((value) => value.issue?.title ?? ""),
					),
				),
			),
		),
		Span(
			{ class: "shrink-0 text-[11px] text-muted-foreground" },
			entry.bind((value) => relativeTime(value.createdAt)),
		),
	);

	// A notification about an issue is a link to it; one without stays inert.
	if (current.issue === null) return body;

	return router.Link(
		{
			to: "/app/:slug/issue/:identifier",
			params: { slug: params.slug, identifier: current.issue.identifier },
			class: "block",
		},
		body,
	);
}
