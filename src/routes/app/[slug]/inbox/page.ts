import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { InboxPage } from "@/lib/features/inbox/inbox-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			// The unread count rides in the tab title, the way a mail client does it.
			title: props.data.bind((data) =>
				pageTitle(data.unread > 0 ? `Inbox (${data.unread})` : "Inbox", data.workspace.name),
			),
			description: props.data.bind(
				(data) => `Notifications from issues and feedback you follow in ${data.workspace.name}.`,
			),
		}),
		InboxPage(props),
	);
}
