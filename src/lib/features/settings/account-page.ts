import { Div, H1, H2, P, type Readable } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { UserAvatar } from "@/lib/components/glyphs";
import { ImagePicker, imageChoice } from "@/lib/features/workspaces/image-picker";
import { AgentsSection } from "./agents-section";

interface PageData {
	user: { id: string; name: string; email: string; image: string | null };
}

/**
 * Your account, not a workspace's.
 *
 * Agents belong here because one authorization reaches every workspace you are
 * a member of — including ones you join later.
 */
export function AccountPage({ data }: { data: Readable<PageData> }) {
	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },
		Div(
			{ class: "flex h-12 shrink-0 items-center border-b border-border px-4" },
			H1({ class: "text-[15px] font-semibold tracking-tight" }, "Account"),
		),
		Div(
			{ class: "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6 sm:py-6" },
			Div(
				{ class: "mx-auto flex max-w-2xl flex-col gap-10" },
				ProfileSection(data),
				AgentsSection(copy),
			),
		),
	);
}

/** Your picture — the one thing about you this page can change. */
function ProfileSection(data: Readable<PageData>) {
	const user = data.get().user;
	const picture = imageChoice(user.image);
	data.onChange((next) => picture.preview.set(next.user.image ?? ""));

	return Div(
		{ class: "flex flex-col gap-3" },
		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, "You"),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				data.bind((value) => `${value.user.name} · ${value.user.email}`),
			),
		),
		Div(
			{ class: "flex flex-col gap-4 rounded-md border border-border p-3" },
			ImagePicker({
				choice: picture,
				fallback: data.bind((value) => value.user.name),
				// A person is round everywhere else in the app, and their initials
				// are what stands in for a missing picture — so the picker shows
				// exactly the avatar the rest of the chrome will.
				previewClass: "rounded-full",
				placeholder: UserAvatar({ id: user.id, name: user.name }, "size-full text-lg"),
				label: "Upload a picture",
				// Saved on choose rather than behind a button: there is no other
				// field on this control to batch it with.
				onChange: (key) => void savePicture(key),
			}),
		),
	);
}

/** A key from the upload endpoint, or `null` to go back to initials. */
async function savePicture(key: string | null): Promise<void> {
	const { error } = await api.PATCH("/api/v1/me", { body: { imageKey: key } });
	if (error !== undefined) {
		toastError(messageOf(error, "Could not save your picture"));
		return;
	}
	toastSuccess(key === null ? "Picture removed" : "Picture updated");
}

async function copy(value: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value);
		toastSuccess("Copied to clipboard");
	} catch {
		toastError("Could not copy — select and copy manually");
	}
}
