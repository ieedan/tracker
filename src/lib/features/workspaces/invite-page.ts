import { A, Div, H1, P, signal, type Readable } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { Button } from "@/lib/components/ui/button";

interface PageData {
	token: string;
	signedIn: boolean;
	invite: { workspaceName: string; workspaceSlug: string } | null;
}

export function InvitePage({ data }: { data: Readable<PageData> }) {
	const failure = signal("");
	const joining = signal(false);
	const current = data.get();

	const accept = async () => {
		failure.set("");
		joining.set(true);
		const { data: joined, error } = await api.POST("/api/v1/invites/[token]/accept", {
			params: { token: current.token },
		});
		joining.set(false);

		if (error !== undefined) {
			failure.set(messageOf(error, "Could not join this workspace"));
			return;
		}
		window.location.assign(`/app/${joined.slug}`);
	};

	return Div(
		{ class: "flex min-h-dvh items-center justify-center px-4" },
		Div(
			{ class: "w-full max-w-sm text-center" },
			current.invite === null
				? Div(
						{},
						H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "Invite not valid"),
						P(
							{ class: "mb-6 text-sm text-muted-foreground" },
							"This link has been revoked, has expired, or never existed.",
						),
						A(
							{
								class: "text-sm underline underline-offset-4",
								href: "/app",
							},
							"Go to tracker",
						),
					)
				: Div(
						{},
						H1(
							{ class: "mb-1 text-xl font-semibold tracking-tight" },
							`Join ${current.invite.workspaceName}`,
						),
						P(
							{ class: "mb-6 text-sm text-muted-foreground" },
							current.signedIn
								? "You have been invited to this workspace."
								: "Sign in or create an account to accept this invite.",
						),
						current.signedIn
							? Div(
									{ class: "flex flex-col gap-2" },
									Button(
										{ class: "w-full", loading: joining, onClick: () => void accept() },
										"Accept invite",
									),
									P({ class: "text-xs text-destructive empty:hidden" }, failure),
								)
							: Div(
									{ class: "flex flex-col gap-2" },
									Button(
										{
											class: "w-full",
											onClick: () =>
												window.location.assign(
													`/login?next=${encodeURIComponent(`/invite/${current.token}`)}`,
												),
										},
										"Sign in",
									),
									Button(
										{
											variant: "secondary",
											class: "w-full",
											onClick: () =>
												window.location.assign(
													`/signup?next=${encodeURIComponent(`/invite/${current.token}`)}`,
												),
										},
										"Create an account",
									),
								),
					),
		),
	);
}
