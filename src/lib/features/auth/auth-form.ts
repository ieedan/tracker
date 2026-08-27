import { A, Div, H1, If, Input, Label, P, Span, signal, type Readable } from "@implementjs/core";
import { createForm, Field, Form } from "@implementjs/formish";
import { ZapIcon } from "@implementjs/lucide";
import * as v from "valibot";
import { authClient } from "@/lib/client/auth";
import { Button } from "@/lib/components/ui/button";
import { AppWordmark } from "@/lib/components/app-mark";
import { GithubMark } from "@/lib/components/glyphs";

const LoginSchema = v.object({
	email: v.pipe(v.string(), v.minLength(1, "Enter your email"), v.email("Enter a valid email")),
	password: v.pipe(v.string(), v.minLength(1, "Enter your password")),
});

const SignUpSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, "Enter your name")),
	email: v.pipe(v.string(), v.minLength(1, "Enter your email"), v.email("Enter a valid email")),
	password: v.pipe(v.string(), v.minLength(8, "At least 8 characters")),
});

const styles = {
	shell: "flex min-h-dvh items-center justify-center bg-background px-4",
	card: "w-full max-w-sm",
	mark: "mb-8",
	title: "mb-1 text-xl font-semibold tracking-tight",
	subtitle: "mb-6 text-sm text-muted-foreground",
	form: "flex flex-col gap-3.5",
	field: "flex flex-col gap-1.5",
	label: "text-[13px] font-medium",
	// A real 16px below sm — not `text-base`, which the 15px root undercuts —
	// so mobile Safari does not zoom onto a focused field.
	input:
		"h-9 rounded-md border border-input bg-background px-3 text-[16px] outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/25 sm:text-sm",
	error: "text-xs text-destructive empty:hidden",
	footer: "mt-6 text-center text-sm text-muted-foreground",
	link: "text-foreground underline underline-offset-4 hover:text-primary",
};

export interface AuthPageData {
	providers: { github: boolean };
	/**
	 * The demo account's address, where this deployment has one, or `null`.
	 *
	 * Its password stays on the server — `/api/demo-login` is what signs in —
	 * so this is only ever a label for the button.
	 */
	demo: string | null;
}

/**
 * Everything that is not the password form: the social buttons, the one-click
 * demo account, and the rule that separates them from the fields.
 *
 * Rendered above the fields rather than below: someone who has an account
 * through GitHub is looking for the button, and making them read past a
 * password form to find it is how you get duplicate accounts.
 *
 * The whole block goes away when neither is configured, rather than leaving a
 * rule hanging over the form with nothing above it.
 */
function AlternativeSignIn(data: Readable<AuthPageData>, verb: string) {
	return If(
		data.bind((value) => value.providers.github || value.demo !== null),
		Div(
			{ class: "mb-5 flex flex-col gap-3" },
			DemoSignIn(data),
			SocialSignIn(data, verb),
			Div(
				{ class: "flex items-center gap-3" },
				Div({ class: "h-px flex-1 bg-border" }),
				Span({ class: "text-[11px] tracking-wide text-muted-foreground" }, "OR"),
				Div({ class: "h-px flex-1 bg-border" }),
			),
		),
	);
}

/**
 * One click into the seeded demo account.
 *
 * It leads because it is the reason the block is on screen at all where it
 * appears — a preview deployment, where nobody wants to type
 * `demo@tracker.dev` and a password to look at a pull request.
 *
 * The POST carries no body: which account this is belongs to the server's
 * configuration, and letting the page name one would turn this into a way to
 * sign in as anybody whose password you can guess, without the rate limiting
 * better-auth puts on its own sign-in route.
 */
function DemoSignIn(data: Readable<AuthPageData>) {
	const busy = signal(false);
	const failure = signal("");

	const start = async () => {
		failure.set("");
		busy.set(true);
		try {
			const response = await fetch("/api/demo-login", { method: "POST" });
			if (!response.ok) {
				busy.set(false);
				failure.set(await demoMessage(response));
				return;
			}
		} catch {
			busy.set(false);
			failure.set("Could not reach the server. Check your connection.");
			return;
		}
		// A full load, so the server hook sees the new cookie — the same reason
		// the password form navigates rather than routing on the client.
		window.location.assign(destination());
	};

	return If(
		data.bind((value) => value.demo !== null),
		Div(
			{ class: "flex flex-col gap-3" },
			Button(
				{
					variant: "secondary",
					class: "w-full gap-2",
					loading: busy,
					onClick: () => void start(),
				},
				ZapIcon({ class: "size-4" }),
				data.bind((value) => `Sign in as ${value.demo ?? ""}`),
			),
			P({ class: styles.error }, failure),
		),
	);
}

/** The endpoint answers JSON on both of its failures; neither is worth hiding. */
async function demoMessage(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { message?: unknown };
		if (typeof body.message === "string" && body.message !== "") return body.message;
	} catch {
		// Not JSON — a proxy's error page, most likely.
	}
	return "Could not sign in to the demo account.";
}

/** "Sign in with GitHub", where this deployment has the credentials for it. */
function SocialSignIn(data: Readable<AuthPageData>, verb: string) {
	const busy = signal(false);
	const failure = signal("");

	const start = async () => {
		failure.set("");
		busy.set(true);
		const { error } = await authClient.signIn.social({
			provider: "github",
			callbackURL: destination(),
		});
		// Success navigates away, so reaching here at all means it did not.
		busy.set(false);
		if (error) {
			failure.set(
				error.message !== undefined && error.message !== ""
					? error.message
					: "Could not reach GitHub. Try again.",
			);
		}
	};

	return If(
		data.bind((value) => value.providers.github),
		Div(
			{ class: "flex flex-col gap-3" },
			Button(
				{
					variant: "secondary",
					class: "w-full gap-2",
					loading: busy,
					onClick: () => void start(),
				},
				GithubMark({ class: "size-4" }),
				`${verb} with GitHub`,
			),
			P({ class: styles.error }, failure),
		),
	);
}

/**
 * Turns better-auth's error into something a person can act on.
 *
 * Wrong password and "no such account" deliberately produce the *same* message:
 * telling them apart turns the sign-in form into an account-enumeration oracle,
 * and it makes no difference to someone who simply mistyped.
 */
function signInMessage(error: { status?: number; message?: string }): string {
	if (error.status === 0) return "Could not reach the server. Check your connection.";
	if (error.status === 401 || error.status === 403 || error.status === 400) {
		return "Incorrect email or password.";
	}
	if (error.status === 429) return "Too many attempts. Wait a moment and try again.";
	return error.message !== undefined && error.message !== ""
		? error.message
		: "Something went wrong signing you in.";
}

/** Sign-up's failures are different: the useful one is "that email is taken". */
function signUpMessage(error: { status?: number; message?: string }): string {
	if (error.status === 0) return "Could not reach the server. Check your connection.";
	if (error.status === 409 || error.status === 422) {
		return "An account with that email already exists.";
	}
	if (error.status === 429) return "Too many attempts. Wait a moment and try again.";
	return error.message !== undefined && error.message !== ""
		? error.message
		: "Something went wrong creating your account.";
}

/** Where to land after authenticating — `?next=` when it is a safe local path. */
function destination(): string {
	if (typeof window === "undefined") return "/app";
	const next = new URL(window.location.href).searchParams.get("next");
	// Only same-origin paths; never an absolute URL an attacker supplied.
	if (next !== null && next.startsWith("/") && !next.startsWith("//")) return next;
	return "/app";
}

export function LoginPage(data: Readable<AuthPageData>) {
	const form = createForm({ schema: LoginSchema });
	const failure = signal("");

	return Div(
		{ class: styles.shell },
		Div(
			{ class: styles.card },
			AppWordmark({ class: styles.mark }),
			H1({ class: styles.title }, "Sign in to tracker"),
			P({ class: styles.subtitle }, "Welcome back. Enter your details to continue."),
			AlternativeSignIn(data, "Sign in"),
			Form(
				{
					class: styles.form,
					of: form,
					onSubmit: async (output) => {
						failure.set("");
						const { error } = await authClient.signIn.email({
							email: output.email,
							password: output.password,
						});
						if (error) {
							failure.set(signInMessage(error));
							return;
						}
						// A full load, so the server hook sees the new cookie.
						window.location.assign(destination());
					},
				},
				TextField(form, "email", "Email", "email", "you@example.com"),
				TextField(form, "password", "Password", "password", "••••••••"),
				P({ class: styles.error }, failure),
				Button({ type: "submit", class: "mt-1 w-full", loading: form.isSubmitting }, "Sign in"),
			),
			P(
				{ class: styles.footer },
				"No account? ",
				A({ class: styles.link, href: "/signup" }, "Create one"),
			),
		),
	);
}

export function SignUpPage(data: Readable<AuthPageData>) {
	const form = createForm({ schema: SignUpSchema });
	const failure = signal("");

	return Div(
		{ class: styles.shell },
		Div(
			{ class: styles.card },
			AppWordmark({ class: styles.mark }),
			H1({ class: styles.title }, "Create your account"),
			P({ class: styles.subtitle }, "Track issues with your team in minutes."),
			AlternativeSignIn(data, "Continue"),
			Form(
				{
					class: styles.form,
					of: form,
					onSubmit: async (output) => {
						failure.set("");
						const { error } = await authClient.signUp.email({
							name: output.name,
							email: output.email,
							password: output.password,
						});
						if (error) {
							failure.set(signUpMessage(error));
							return;
						}
						window.location.assign(destination());
					},
				},
				TextField(form, "name", "Name", "text", "Ada Lovelace"),
				TextField(form, "email", "Email", "email", "you@example.com"),
				TextField(form, "password", "Password", "password", "At least 8 characters"),
				P({ class: styles.error }, failure),
				Button(
					{ type: "submit", class: "mt-1 w-full", loading: form.isSubmitting },
					"Create account",
				),
			),
			P(
				{ class: styles.footer },
				"Already have an account? ",
				A({ class: styles.link, href: "/login" }, "Sign in"),
			),
		),
	);
}

type AnyForm = ReturnType<typeof createForm<typeof SignUpSchema>>;

function TextField(
	form: AnyForm | ReturnType<typeof createForm<typeof LoginSchema>>,
	path: string,
	label: string,
	type: "text" | "email" | "password",
	placeholder: string,
) {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one helper serves both schemas
	return Field({ of: form as AnyForm, path: [path as "name"] }, (field) =>
		Div(
			{ class: styles.field },
			Label({ class: styles.label, htmlFor: path }, label),
			Input({
				...field.props,
				class: styles.input,
				id: path,
				type,
				placeholder,
				value: field.input,
			}),
			Span({ class: styles.error }, field.error),
		),
	);
}
