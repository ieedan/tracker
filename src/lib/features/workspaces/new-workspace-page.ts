import { Div, H1, Input, Label, P, Span, signal } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { Button } from "@/lib/components/ui/button";
import { workspaceKeyPreview } from "./key-preview";

export function NewWorkspacePage() {
	const name = signal("");
	const key = signal("");
	const failure = signal("");
	const creating = signal(false);

	// The key follows the name until someone types one of their own.
	const keyTouched = signal(false);
	name.onChange((value) => {
		if (!keyTouched.get()) key.set(workspaceKeyPreview(value));
	});

	const create = async () => {
		if (name.get().trim() === "") return;
		failure.set("");
		creating.set(true);

		const { data, error } = await api.POST("/api/v1/workspaces", {
			body: { name: name.get().trim(), key: key.get().trim() || undefined },
		});
		creating.set(false);

		if (error !== undefined) {
			failure.set(messageOf(error, "Could not create the workspace"));
			return;
		}
		// A full load so the shell picks up the new workspace list.
		window.location.assign(`/app/${data.slug}`);
	};

	return Div(
		{ class: "flex flex-1 items-center justify-center px-4" },
		Div(
			{ class: "w-full max-w-sm" },
			H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "Create a workspace"),
			P(
				{ class: "mb-6 text-sm text-muted-foreground" },
				"Workspaces hold issues, labels and people.",
			),

			Div(
				{ class: "flex flex-col gap-3.5" },
				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ class: "text-[13px] font-medium", htmlFor: "name" }, "Name"),
					Input({
						id: "name",
						value: name,
						autofocus: true,
						placeholder: "Engineering",
						class:
							"h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring",
						onKeydown: (event) => {
							if (event.key === "Enter") void create();
						},
					}),
				),
				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ class: "text-[13px] font-medium", htmlFor: "key" }, "Issue prefix"),
					Input({
						id: "key",
						value: key,
						placeholder: "ENG",
						maxLength: 6,
						class:
							"h-9 w-28 rounded-md border border-input bg-background px-3 font-mono text-sm uppercase outline-none focus:border-ring",
						onInput: () => keyTouched.set(true),
					}),
					Span(
						{ class: "text-[12px] text-muted-foreground" },
						key.bind(
							(value) => `Issues will be numbered ${(value || "WS").toUpperCase()}-1, -2, …`,
						),
					),
				),
				P({ class: "text-xs text-destructive empty:hidden" }, failure),
				Button(
					{
						class: "mt-1 w-full",
						loading: creating,
						disabled: name.bind((value) => value.trim() === ""),
						onClick: () => void create(),
					},
					"Create workspace",
				),
			),
		),
	);
}
