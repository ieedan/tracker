import { Button, Div, Input, Label, Span, signal } from "@implementjs/core";
import { createForm, Field, Form } from "@implementjs/formish";
import * as v from "valibot";

const styles = {
	form: "flex w-full max-w-xs flex-col gap-4",
	field: "flex flex-col gap-1.5",
	label: "text-sm font-medium text-foreground",
	input: "rounded-md border px-3 py-2 text-sm outline-none border-input bg-background focus:border-ring",
	error: "min-h-4 text-xs text-destructive",
	submit: "cursor-pointer rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90",
	success: "text-sm text-muted-foreground",
};

const SignUpSchema = v.object({
	email: v.pipe(v.string(), v.minLength(1, "Enter your email"), v.email("Enter a valid email")),
	password: v.pipe(v.string(), v.minLength(8, "At least 8 characters")),
});

export function SignUpForm() {
	const form = createForm({ schema: SignUpSchema });
	const signedUpAs = signal("");

	return Form(
		{ class: styles.form, of: form, onSubmit: (output) => signedUpAs.set(output.email) },
		TextField(form, "email", "Email", "email"),
		TextField(form, "password", "Password", "password"),
		Button({ class: styles.submit, type: "submit", disabled: form.isSubmitting }, "Sign up"),
		Span({ class: styles.success }, signedUpAs.bind((email) => (email ? `Signed up as ${email}` : ""))),
	);
}

/** One labelled input, wired to the field at `path` and showing whatever the schema says about it. */
function TextField(
	form: ReturnType<typeof createForm<typeof SignUpSchema>>,
	path: "email" | "password",
	label: string,
	type: "email" | "password",
) {
	return Field({ of: form, path: [path] }, (field) =>
		Div(
			{ class: styles.field },
			Label({ class: styles.label, htmlFor: path }, label),
			Input({ ...field.props, class: styles.input, id: path, type, value: field.input }),
			Span({ class: styles.error }, field.error),
		),
	);
}
