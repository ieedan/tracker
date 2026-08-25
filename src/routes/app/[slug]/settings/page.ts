import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { SettingsPage } from "@/lib/features/settings/settings-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) => pageTitle("Settings", data.workspace.name)),
			description: props.data.bind(
				(data) =>
					`Manage teams, members, labels, repositories, and API keys for ${data.workspace.name}.`,
			),
		}),
		SettingsPage(props),
	);
}
