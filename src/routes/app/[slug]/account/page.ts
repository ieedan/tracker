import { Fragment } from "@implementjs/core";
import { AccountPage } from "@/lib/features/settings/account-page";
import { PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: pageTitle("Account settings"),
			description: "Your profile, appearance, and sign-in settings.",
		}),
		AccountPage(props),
	);
}
