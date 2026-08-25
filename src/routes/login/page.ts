import { Fragment } from "@implementjs/core";
import { LoginPage } from "@/lib/features/auth/auth-form";
import { PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page({ data }: PageProps) {
	return Fragment(
		PageMeta({
			title: pageTitle("Log in"),
			description: "Sign in to your tracker workspace.",
		}),
		LoginPage(data),
	);
}
