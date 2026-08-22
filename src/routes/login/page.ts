import { router } from "$implement/router";
import { Div, Form, H1, If, Implement, P, Span, Svg, signal } from "@implementjs/core";
import { authApi } from "@/lib/api";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Label } from "@/lib/components/ui/label";
import { Separator } from "@/lib/components/ui/separator";
import { env } from "@/lib/env.public";
import type { PageProps } from "./$types";

/** lucide dropped its brand icons, so the GitHub mark is drawn here. */
function GithubMark() {
	return Svg(
		`<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
		{ class: "size-4" },
	);
}

/**
 * Signing in. Rendered with the root layout only — there is no workspace to
 * put a sidebar around yet.
 */
export default function Page({ data }: PageProps) {
	const githubConfigured = data.bind("githubConfigured");
	const devLoginEnabled = data.bind("devLoginEnabled");

	const email = signal("demo@tracker.local");
	const password = signal("demo-password-1234");
	const busy = signal(false);
	const failure = signal<string | null>(null);

	const signInWithGithub = async () => {
		busy.set(true);
		failure.set(null);
		try {
			const { url } = await authApi.signInWithGithub();
			window.location.href = url;
		} catch (thrown) {
			failure.set(thrown instanceof Error ? thrown.message : "Could not reach GitHub");
			busy.set(false);
		}
	};

	const signInWithPassword = async (event: SubmitEvent) => {
		event.preventDefault();
		busy.set(true);
		failure.set(null);
		try {
			await authApi.signInWithPassword(email.get(), password.get());
			// A full load, so every server load re-runs with the new session.
			window.location.href = "/";
		} catch (thrown) {
			failure.set(thrown instanceof Error ? thrown.message : "Could not sign in");
			busy.set(false);
		}
	};

	return Div(
		{ class: "flex min-h-dvh items-center justify-center p-6" },
		Implement.Head(Implement.Head.Title(`Sign in · ${env.PUBLIC_APP_NAME}`)),
		Div(
			{ class: "w-full max-w-sm space-y-6" },
			Div(
				{ class: "space-y-1.5 text-center" },
				H1({ class: "text-xl font-semibold tracking-tight" }, env.PUBLIC_APP_NAME),
				P(
					{ class: "text-sm text-muted-foreground" },
					"Issue tracking for your GitHub organizations.",
				),
			),

			If(githubConfigured)
				.Then(
					Button(
						{
							class: "w-full",
							disabled: busy,
							onClick: () => void signInWithGithub(),
						},
						GithubMark(),
						"Continue with GitHub",
					),
				)
				.Else(
					Div(
						{ class: "rounded-md border border-dashed p-4 text-sm text-muted-foreground" },
						P({ class: "font-medium text-foreground" }, "GitHub sign-in isn't configured"),
						P(
							{ class: "mt-1.5" },
							"Register an OAuth App with the callback URL ",
							Span(
								{ class: "rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground" },
								`${env.PUBLIC_APP_URL}/api/auth/callback/github`,
							),
							", then set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.",
						),
					),
				),

			If(devLoginEnabled).Then(
				Div(
					{ class: "space-y-4" },
					Div(
						{ class: "relative" },
						Separator(),
						Span(
							{
								class:
									"absolute inset-0 -top-2 mx-auto w-fit bg-background px-2 text-xs text-muted-foreground",
							},
							"or use the demo account",
						),
					),
					Form(
						{ class: "space-y-3", onSubmit: signInWithPassword },
						Div(
							{ class: "space-y-1.5" },
							Label({ for: "email" }, "Email"),
							Input({ id: "email", type: "email", value: email, autocomplete: "username" }),
						),
						Div(
							{ class: "space-y-1.5" },
							Label({ for: "password" }, "Password"),
							Input({
								id: "password",
								type: "password",
								value: password,
								autocomplete: "current-password",
							}),
						),
						Button({ type: "submit", variant: "outline", class: "w-full", disabled: busy }, "Sign in"),
					),
					P(
						{ class: "text-center text-xs text-muted-foreground" },
						"Run ",
						Span({ class: "font-mono" }, "pnpm db:seed"),
						" if this account doesn't exist yet.",
					),
				),
			),

			If(failure.bind((value) => value !== null)).Then(
				P(
					{ class: "rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive" },
					failure.bind((value) => value ?? ""),
				),
			),
		),
	);
}
