import {
	Div,
	If,
	ImplementEffect,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Dialog, DialogContent } from "@/lib/components/ui/dialog";
import { Field, FieldError, FieldGroup } from "@/lib/components/ui/field";
import { IssueManagerContext } from "./issue-manager";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import { Button } from "@/lib/components/ui/button";
import { PRIORITIES, STATUSES, type Priority, type Status } from "@/lib/constants";
import * as v from "valibot";
import { PriorityPicker } from "./priority-picker";
import { StatusPicker } from "./status-picker";
import { handleError } from "@/lib/errors";
import { LabelPicker } from "./label-picker";
import { createForm, Form, Field as FormishField, reset, submit } from "@implementjs/formish";
import type { Label, Team } from "@/lib/db/types";
import { TeamPicker } from "./team-picker";
import { cn } from "@/lib/utils";

export const NewIssueSchema = v.object({
	teamId: v.pipe(v.number(), v.integer()),
	title: v.pipe(v.string(), v.minLength(1, "Title is required")),
	body: v.pipe(v.string(), v.minLength(1, "Body is required")),
	status: v.picklist(STATUSES),
	priority: v.picklist(PRIORITIES),
	assignee: v.nullable(v.number()),
	labels: v.array(v.number()),
});

export type NewIssue = v.InferOutput<typeof NewIssueSchema>;

type NewIssueForm = ReturnType<typeof createForm<typeof NewIssueSchema>>;

const DEFAULT_STATUS: Status = "Backlog";
const DEFAULT_PRIORITY: Priority = "None";

export function CreateIssueDialog({ open }: { open: Signal<boolean> }) {
	return IssueManagerContext.Use((manager) => {
		const form = createForm({
			schema: NewIssueSchema,
			initialInput: {
				teamId: 2,
				status: DEFAULT_STATUS,
				priority: DEFAULT_PRIORITY,
				labels: [],
				assignee: null,
			},
		});

		async function onSubmit(input: NewIssue) {
			(await manager.createIssue(input)).match(
				(issue) => {
					manager.issues.push(issue);
					open.set(false);
				},
				(e) => handleError(e, "creating your issue"),
			);
		}

		return Dialog(
			{ open },
			DialogContent(
				{  },
				ImplementEffect(
					[open],
					(isOpen) => {
						if (!isOpen) reset(form);
					},
					{ immediate: false },
				),
				Form(
					{ of: form, onSubmit, class: "flex flex-col gap-2" },
                    Div({ class: 'flex items-center' },
                        TeamField(form, manager.teams)
                    ),
					FieldGroup(
						{ class: "gap-1" },
						TitleField(form),
						BodyField(form),

						Div(
							{ class: "mt-2 flex items-center gap-2" },
							PriorityField(form),
							StatusField(form),
							LabelsField(form, manager.labels),
							// TODO: Add assignee picker
						),
					),
					Div(
						{ class: "flex items-center justify-between" },
						Button({ variant: "outline", onClick: () => open.set(false) }, "Cancel"),
						Button({ type: "submit", disabled: form.isSubmitting }, "Create Issue"),
					),
				),
			),
		);
	});
}

const BORDERLESS_FIELD_CLASS =
	"border-none bg-transparent shadow-none px-0 dark:bg-transparent focus-visible:border-none focus-visible:ring-0";

export function TitleField(form: NewIssueForm) {
	return FormishField({ of: form, path: ["title"] }, (field) => {
		return Field(
			{ class: "gap-1" },
			Input({
				...field.props,
				id: "title",
				type: "text",
				placeholder: "Issue title",
				"aria-label": "Issue title",
				value: field.input,
				class: cn(BORDERLESS_FIELD_CLASS, "h-auto py-1 text-lg md:text-lg font-semibold"),
			}),
			If(field.error).Then(FieldError(field.error)),
		);
	});
}

export function BodyField(form: NewIssueForm) {
	return FormishField({ of: form, path: ["body"] }, (field) => {
		return Field(
			{ class: "gap-1" },
			Textarea({
				...field.props,
				id: "body",
				placeholder: "Add description...",
				"aria-label": "Description",
				value: field.input,
				class: cn(BORDERLESS_FIELD_CLASS, "min-h-20 py-1 resize-none md:text-base"),
				onKeydown: (event) => {
					if (event.key === "Enter" && event.metaKey) {
						submit(form);
					}
				},
			}),
			If(field.error).Then(FieldError(field.error)),
		);
	});
}

export function PriorityField(form: NewIssueForm) {
	return FormishField({ of: form, path: ["priority"] }, (field) =>
		bindPicker(field, DEFAULT_PRIORITY, (value) => PriorityPicker({ value })),
	);
}

export function StatusField(form: NewIssueForm) {
	return FormishField({ of: form, path: ["status"] }, (field) =>
		bindPicker(field, DEFAULT_STATUS, (value) => StatusPicker({ value })),
	);
}

export function LabelsField(form: NewIssueForm, labels: Readable<Label[]>) {
	return FormishField({ of: form, path: ["labels"] }, (field) =>
		bindPicker(field, [] as number[], (value) => LabelPicker({ value, labels })),
	);
}

export function TeamField(form: NewIssueForm, teams: Readable<Team[]>) {
	return FormishField({ of: form, path: ["teamId"] }, (field) =>
		bindPicker(field, 2, (value) => TeamPicker({ value, teams })),
	);
}

/**
 * Primitives like Select need a writable signal. Formish fields expose a
 * readable plus `setInput` — this keeps the two in step without a native input.
 */
function bindPicker<T extends string | number | number[]>(
	field: { input: Readable<T | undefined>; setInput: (value: T) => void },
	fallback: T,
	render: (value: Signal<T>) => Child,
) {
	const value = signal(field.input.get() ?? fallback) as Signal<T>;

	return [
		ImplementEffect(
			[value],
			(next) => {
				if (!sameValue(field.input.get(), next)) field.setInput(next);
			},
			{ immediate: false },
		),
		ImplementEffect(
			[field.input],
			(current) => {
				const next = current ?? fallback;
				if (!sameValue(value.get(), next)) value.set(next);
			},
			{ immediate: false },
		),
		render(value),
	];
}

function sameValue<T>(left: T | undefined, right: T) {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((item, index) => item === right[index]);
	}
	return false;
}
