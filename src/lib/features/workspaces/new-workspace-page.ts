import { Div, H1, Input, Label, P, Span, derived, signal } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { Button } from "@/lib/components/ui/button";
import { ImagePicker, imageChoice } from "./image-picker";
import { slugPreview } from "./slug-preview";

export function NewWorkspacePage() {
	const name = signal("");
	const failure = signal("");
	const creating = signal(false);
	const picture = imageChoice();

	// What the URL will read once this exists. The server still has the last
	// word — it appends `-2` if the slug is taken — but showing it here is what
	// makes "this name becomes an address" obvious before you commit to it.
	const slug = derived([name], (value) => slugPreview(value));

	const create = async () => {
		if (name.get().trim() === "") return;
		failure.set("");
		creating.set(true);

		const chosen = picture.key.get();
		const { data, error } = await api.POST("/api/v1/workspaces", {
			body: {
				name: name.get().trim(),
				...(chosen === "" ? {} : { imageKey: chosen }),
			},
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
		// This page has no shell to sit inside, so it takes the viewport height
		// itself — `flex-1` needs a flex parent, and the root layout is not one.
		{ class: "flex min-h-dvh items-center justify-center px-4 py-10" },
		Div(
			{ class: "w-full max-w-sm" },
			H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "Create a workspace"),
			P(
				{ class: "mb-6 text-sm text-muted-foreground" },
				"Workspaces hold teams, issues, labels and people.",
			),

			Div(
				{ class: "flex flex-col gap-3.5" },

				// The picture uploads the moment it is chosen, so by the time the
				// name is typed there is already a key to submit with it.
				ImagePicker({
					choice: picture,
					// The slug, so the tile previewed here is the one the workspace
					// keeps: the name can be renamed later, the slug cannot.
					seed: slug,
					fallback: name,
					label: "Add a picture",
				}),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ class: "text-[13px] font-medium", htmlFor: "name" }, "Name"),
					Input({
						id: "name",
						value: name,
						autofocus: true,
						placeholder: "Acme",
						class:
							"h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring",
						onKeydown: (event) => {
							if (event.key === "Enter") void create();
						},
					}),
					Span(
						{ class: "text-[12px] text-muted-foreground" },
						derived([slug], (value) => `tracker.app/${value || "…"}`),
					),
				),

				// Deliberately no issue-prefix field. A prefix belongs to a team, not
				// a workspace — `ENG-42` and `PRD-7` live side by side in here — so
				// asking for one at this point would be asking the wrong question.
				P(
					{ class: "text-[12px] text-muted-foreground" },
					"You will start with Engineering (ENG) and Product (PRD) teams. Issues take their prefix from the team that owns them.",
				),

				P({ class: "text-xs text-destructive empty:hidden" }, failure),
				Button(
					{
						class: "mt-1 w-full",
						loading: creating,
						disabled: derived(
							[name, picture.uploading],
							(value, uploading) => value.trim() === "" || uploading,
						),
						onClick: () => void create(),
					},
					"Create workspace",
				),
			),
		),
	);
}
