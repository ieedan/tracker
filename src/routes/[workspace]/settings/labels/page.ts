import { Div, ForEach, Span, signal } from "@implementjs/core";
import { TrashIcon } from "@implementjs/lucide";
import { api, ApiError } from "@/lib/api";
import { SettingsPage } from "@/lib/components/settings-page";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { toast } from "@/lib/toast";
import { WorkspaceContext } from "@/lib/workspace-context";

export default function Page() {
	return WorkspaceContext.Use((store) => {
		const name = signal("");
		const color = signal("#5e6ad2");
		const busy = signal(false);

		const slug = () => store.workspace.get().slug;
		const refresh = async () => store.labels.set((await api.labels.list(slug())).items);

		const add = async () => {
			if (name.get().trim() === "") return;
			busy.set(true);
			try {
				await api.labels.create(slug(), { name: name.get().trim(), color: color.get() });
				name.set("");
				await refresh();
			} catch (thrown) {
				toast.add({
					title: "Could not create the label",
					description: thrown instanceof ApiError ? thrown.message : "Something went wrong",
					type: "error",
				});
			} finally {
				busy.set(false);
			}
		};

		const remove = async (id: string) => {
			try {
				await api.labels.remove(slug(), id);
				await refresh();
			} catch {
				toast.add({ title: "Could not delete the label", type: "error" });
			}
		};

		return SettingsPage(
			"Labels",
			"Labels are workspace-wide, and any issue can carry as many as it needs.",

			Div(
				{ class: "flex items-center gap-2" },
				Input({ value: name, placeholder: "New label name", class: "h-9" }),
				Input({ value: color, type: "color", class: "h-9 w-14 p-1", "aria-label": "Label colour" }),
				Button({ size: "sm", disabled: busy, onClick: () => void add() }, "Add"),
			),

			Div(
				{ class: "divide-y rounded-md border" },
				ForEach(
					store.labels,
					(label) => label.id,
					(label) =>
						Div(
							{ class: "group flex items-center gap-2.5 px-3 py-2" },
							Span({
								class: "size-2.5 rounded-full",
								style: { backgroundColor: label.bind("color") },
							}),
							Span({ class: "text-sm" }, label.bind("name")),
							Button(
								{
									variant: "ghost",
									size: "icon-xs",
									class: "ml-auto opacity-0 group-hover:opacity-100",
									"aria-label": "Delete label",
									onClick: () => void remove(label.get().id),
								},
								TrashIcon({ class: "size-3" }),
							),
						),
				),
			),
		);
	});
}
