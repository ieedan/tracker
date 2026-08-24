import { Div, Form, signal } from "@implementjs/core";
import { Dialog, DialogContent } from "@/lib/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/lib/components/ui/field";
import { IssueManagerContext } from "./issue-manager";
import type { Signal } from "@implementjs/core";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import { Button } from "@/lib/components/ui/button";
import { PRIORITIES, STATUSES } from "@/lib/constants";
import { z } from "zod";
import { PriorityPicker } from "./priority-picker";
import { StatusPicker } from "./status-picker";
import { handleError } from "@/lib/errors";
import { LabelPicker } from "./label-picker";

export const NewIssueSchema = z.object({
    teamId: z.int(),
    title: z.string().min(1),
    body: z.string().min(1),
    status: z.enum(STATUSES),
    priority: z.enum(PRIORITIES),
    assignee: z.number().nullable(),
    labels: z.array(z.number()),
});

export function CreateIssueDialog({ open }: { open: Signal<boolean> }) {
    return IssueManagerContext.Use((manager) => {
        const newIssue = signal<z.infer<typeof NewIssueSchema>>({
            teamId: 1,
            title: "",
            body: "",
            status: "Backlog",
            priority: "None",
            assignee: null,
            labels: [],
        });

        const isSubmitting = signal(false);

        async function onSubmit(e: SubmitEvent) {
            e.preventDefault();
            isSubmitting.set(true);
            (await manager.createIssue(newIssue.get())).match((issue) => {
                manager.issues.push(issue);
                open.set(false)
            }, (e) => handleError(e, 'creating your issue'))
            isSubmitting.set(false);
        }

        return Dialog(
            { open },
            DialogContent(
                {},
                Form({ onSubmit, class: 'flex flex-col gap-2' },
                    FieldGroup(
                        {},
                        TitleField(newIssue.bind('title')),
                        BodyField(newIssue.bind('body')),

                        Div(
                            { class: "flex items-center gap-2" },
                            PriorityPicker({ value: newIssue.bind('priority') }),
                            StatusPicker({ value: newIssue.bind('status') }),
                            LabelPicker({ value: newIssue.bind('labels'), labels: manager.labels }),
                            // TODO: Add assignee picker
                        ),
                    ),
                    Div(
                        { class: "flex items-center justify-between" },
                        Button({ variant: "outline", onClick: () => open.set(false) }, "Cancel"),
                        Button({ type: "submit", disabled: isSubmitting }, "Create Issue"),
                    ),
                )
            ),
        );
    });
}

export function TitleField(title: Signal<string>) {
    return Field(
        {},
        FieldLabel({}, "Title"),
        Input({ id: "title", type: "text", placeholder: "Enter your issue title", value: title }),
    );
}

export function BodyField(body: Signal<string>) {
    return Field(
        {},
        FieldLabel({}, "Body"),
        Textarea({ id: "body", placeholder: "Enter your issue body", value: body }),

    );
}
