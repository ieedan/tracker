import { A, Div, H1, Input, Label, P, Span, signal } from "@implementjs/core";
import { createForm, Field, Form } from "@implementjs/formish";
import * as v from "valibot";
import { authClient } from "@/lib/client/auth";
import { Button } from "@/lib/components/ui/button";

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
	mark: "mb-8 flex items-center gap-2",
	title: "mb-1 text-xl font-semibold tracking-tight",
	subtitle: "mb-6 text-sm text-muted-foreground",
	form: "flex flex-col gap-3.5",
	field: "flex flex-col gap-1.5",
	label: "text-[13px] font-medium",
	input:
		"h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/25",
	error: "text-xs text-destructive empty:hidden",
	footer: "mt-6 text-center text-sm text-muted-foreground",
	link: "text-foreground underline underline-offset-4 hover:text-primary",
};

/** The wordmark, so both auth screens open the same way. */
function Wordmark() {
	return Div(
		{ class: styles.mark },
		Div(
			{ class: "flex size-7 items-center justify-center rounded-[7px] bg-primary" },
			Span({ class: "text-sm font-bold text-primary-foreground" }, "T"),
		),
		Span({ class: "text-[15px] font-semibold tracking-tight" }, "tracker"),
	);
}

/** Where to land after authenticating — `?next=` when it is a safe local path. */
function destination(): string {
	if (typeof window === "undefined") return "/app";
	const next = new URL(window.location.href).searchParams.get("next");
	// Only same-origin paths; never an absolute URL an attacker supplied.
	if (next !== null && next.startsWith("/") && !next.startsWith("//")) return next;
	return "/app";
}

export function LoginPage() {
	const form = createForm({ schema: LoginSchema });
	const failure = signal("");

	return Div(
		{ class: styles.shell },
		Div(
			{ class: styles.card },
			Wordmark(),
			H1({ class: styles.title }, "Sign in to tracker"),
			P({ class: styles.subtitle }, "Welcome back. Enter your details to continue."),
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
							failure.set(error.message ?? "Could not sign you in");
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

export function SignUpPage() {
	const form = createForm({ schema: SignUpSchema });
	const failure = signal("");

	return Div(
		{ class: styles.shell },
		Div(
			{ class: styles.card },
			Wordmark(),
			H1({ class: styles.title }, "Create your account"),
			P({ class: styles.subtitle }, "Track issues with your team in minutes."),
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
							failure.set(error.message ?? "Could not create your account");
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
