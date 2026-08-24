import type { Issue, Label } from "@/lib/db/types";
import { context, signal, type Readable, type Signal } from "@implementjs/core";
import type z from "zod";
import { api } from "$implement/client";
import type { NewIssueSchema } from "./create-issue-dialog";

export const IssueManagerContext = context<IssueManager>();

export class IssueManager {
	issues: Signal<Issue[]>;
	labels: Signal<Label[]>;
	createIssueDialogOpen = signal(false);
	constructor(issues: Readable<Issue[]>, labels: Readable<Label[]>) {
		this.issues = signal(issues.get());
		this.labels = signal(labels.get());
	}

	openCreateIssueDialog() {
		this.createIssueDialogOpen.set(true);
	}

	async createIssue(issue: z.infer<typeof NewIssueSchema>) {
		return await api.POST("/api/issues", { body: issue });
	}
}
