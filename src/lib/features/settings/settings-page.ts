import {
	Div,
	ForEach,
	H1,
	H2,
	Input,
	P,
	Span,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import type { Label, Member, Workspace } from "@/lib/domain/schemas";
import { LABEL_COLORS } from "@/lib/domain/issues";
import { ImagePicker, imageChoice } from "@/lib/features/workspaces/image-picker";
import { MembersSection } from "./members-section";
import { WorkspaceAgentsSection } from "./workspace-agents-section";
import { ApiKeysSection } from "./api-keys-section";
import { FeedbackSection } from "./feedback-section";
import { RepositoriesSection } from "./repositories-section";
import { TemplatesSection } from "./templates-section";
import { WebhooksSection } from "./webhooks-section";

interface PageData {
	workspace: Workspace;
	members: Member[];
	labels: Label[];
	/** The signed-in person, so the member list can mark their own row. */
	viewerId: string;
}

export function SettingsPage({
	data,
	params,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
}) {
	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },
		Div(
			{ class: "flex h-12 shrink-0 items-center border-b border-border px-4" },
			H1({ class: "text-[15px] font-semibold tracking-tight" }, "Settings"),
		),
		Div(
			{ class: "min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6" },
			Div(
				{ class: "mx-auto flex max-w-2xl flex-col gap-10" },
				WorkspaceSection(data, params),
				MembersSection(data, params.slug, copy),
				LabelsSection(data, params),
				TemplatesSection(params.slug),
				RepositoriesSection(params),
				FeedbackSection(
					data.bind((value) => value.workspace),
					params,
				),
				WorkspaceAgentsSection(params.slug),
				WebhooksSection(params.slug, copy),
				ApiKeysSection(copy),
			),
		),
	);
}

function Section(title: string, description: string, ...children: Child[]) {
	return Div(
		{ class: "flex flex-col gap-3" },
		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, title),
			P({ class: "text-[12px] text-muted-foreground" }, description),
		),
		...children,
	);
}

/** Name and picture — the two things that identify a workspace on screen. */
function WorkspaceSection(data: Readable<PageData>, params: { slug: Readable<string> }) {
	const workspace = data.get().workspace;
	const picture = imageChoice(workspace.image);
	const name = signal(workspace.name);
	data.onChange((next) => {
		name.set(next.workspace.name);
		picture.preview.set(next.workspace.image ?? "");
	});

	const save = async (patch: { name?: string; imageKey?: string | null }) => {
		const { error } = await api.PATCH("/api/v1/workspaces/[slug]", {
			params: { slug: params.slug.get() },
			body: patch,
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not save that"));
			return false;
		}
		return true;
	};

	const commitName = async () => {
		const next = name.get().trim();
		if (next === "" || next === data.get().workspace.name) return;
		if (await save({ name: next })) toastSuccess("Workspace renamed");
	};

	return Section(
		"Workspace",
		"How this workspace appears in the sidebar and the switcher.",

		Div(
			{ class: "flex flex-col gap-4 rounded-md border border-border p-3" },
			ImagePicker({
				choice: picture,
				fallback: name,
				seed: params.slug,
				label: "Upload a picture",
				// Saved on choose rather than behind a button: there is no other
				// field on this control to batch it with.
				onChange: (key) => void save({ imageKey: key }),
			}),
			Div(
				{ class: "flex flex-col gap-1.5" },
				Span({ class: "text-[12px] font-medium" }, "Name"),
				Input({
					value: name,
					class:
						"h-8 max-w-xs rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus:border-ring",
					onBlur: () => void commitName(),
					onKeydown: (event) => {
						if (event.key === "Enter") void commitName();
					},
				}),
			),
		),
	);
}

function LabelsSection(data: Readable<PageData>, params: { slug: Readable<string> }) {
	const labels = signal(data.get().labels);
	data.onChange((next) => labels.set(next.labels));

	const name = signal("");
	const color = signal<string>(LABEL_COLORS[0]);
	const creating = signal(false);

	const create = async () => {
		const trimmed = name.get().trim();
		if (trimmed === "") return;

		creating.set(true);
		const { data: label, error } = await api.POST("/api/v1/workspaces/[slug]/labels", {
			params: { slug: params.slug.get() },
			body: { name: trimmed, color: color.get() },
		});
		creating.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the label"));
			return;
		}
		labels.push(label);
		name.set("");
	};

	return Section(
		"Labels",
		"Labels are shared across every issue in this workspace.",

		Div(
			{ class: "flex flex-wrap gap-1.5" },
			ForEach(
				labels,
				(label) => label.id,
				(label) =>
					Span(
						{
							class:
								"inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px]",
						},
						Span({
							class: "size-2 rounded-full",
							style: { backgroundColor: label.get().color },
						}),
						label.bind("name"),
					),
			),
		),

		// The swatches take their own row on a phone, where nine circles plus an
		// input plus a button cannot share one.
		Div(
			{ class: "flex flex-wrap items-center gap-2" },
			Div(
				{ class: "flex items-center gap-1" },
				...LABEL_COLORS.map((swatch) =>
					Div({
						class: color.bind((current) =>
							current === swatch
								? "size-5 cursor-pointer rounded-full ring-2 ring-ring ring-offset-2 ring-offset-background"
								: "size-5 cursor-pointer rounded-full",
						),
						style: { backgroundColor: swatch },
						title: swatch,
						onClick: () => color.set(swatch),
					}),
				),
			),
			Input({
				value: name,
				placeholder: "Label name",
				class:
					"h-8 min-w-40 flex-1 rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring",
				onKeydown: (event) => {
					if (event.key === "Enter") void create();
				},
			}),
			Button({ size: "sm", loading: creating, onClick: () => void create() }, "Add label"),
		),
	);
}

async function copy(value: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value);
		toastSuccess("Copied to clipboard");
	} catch {
		toastError("Could not copy — select and copy manually");
	}
}
