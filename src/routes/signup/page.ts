import { Fragment } from "@implementjs/core";
import { SignUpPage } from "@/lib/features/auth/auth-form";
import { PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page({ data }: PageProps) {
	return Fragment(
		PageMeta({
			title: pageTitle("Sign up"),
			description: "Create a tracker account and start tracking issues with your team.",
		}),
		SignUpPage(data),
	);
}
