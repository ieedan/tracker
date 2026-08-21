import { Div, If, type Signal } from "@implementjs/core";
import { createForm, Field as FormishField, Form, type SubmitHandler } from "@implementjs/formish";
import z from "zod";
import { IssueManagerContext } from "./issues-manager";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/lib/components/ui/field";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import { Button } from "@/lib/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/lib/components/ui/dialog";

type CreateIssueDialogProps = {
    open: Signal<boolean>
}

export const CreateIssueSchema = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
})

export function CreateIssueDialog({ open }: CreateIssueDialogProps) {
    return IssueManagerContext.Use((manager) => {
        const form = createForm({ schema: CreateIssueSchema });

        const onSubmit: SubmitHandler<typeof CreateIssueSchema> = async (data) => {
            await manager.createIssue(data);
            open.set(false)
        }

        return Dialog(
            { open },
            DialogContent(
                Div({ class: "flex flex-col gap-2" },
                    DialogTitle("Create Issue"),
                    DialogDescription("Create a new issue"),
                ),
                Form({ of: form, onSubmit },
                    FieldGroup(
                        FormishField({ of: form, path: ['title'] }, (field) => {
                            return Field(
                                FieldLabel("Title"),
                                Input({ ...field.props, id: "title", type: 'text', value: field.input }),
                                If(field.error).Then(FieldError(field.error))
                            )
                        }),
                        FormishField({ of: form, path: ['body'] }, (field) => {
                            return Field(
                                FieldLabel("Body"),
                                Textarea({ ...field.props, id: "body", value: field.input }),
                                If(field.error).Then(FieldError(field.error))
                            )
                        }),
                        Button({ type: 'submit', disabled: form.isSubmitting }, "Create Issue")
                    )
                )
            )
        )
    })
}
