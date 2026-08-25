import { Div, H1, H2, P, type Readable } from "@implementjs/core";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { AgentsSection } from "./agents-section";

interface PageData {
	user: { id: string; name: string; email: string };
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
			{ class: "min-h-0 flex-1 overflow-y-auto px-6 py-6" },
			Div(
				{ class: "mx-auto flex max-w-2xl flex-col gap-10" },
				Div(
					{ class: "flex flex-col gap-3" },
					Div(
						{},
						H2({ class: "text-[14px] font-semibold" }, "You"),
						P(
							{ class: "text-[12px] text-muted-foreground" },
							data.bind((value) => `${value.user.name} · ${value.user.email}`),
						),
					),
				),
				AgentsSection(copy),
			),
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
