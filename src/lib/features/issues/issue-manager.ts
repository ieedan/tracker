import type { Issue, Label, Team } from "@/lib/db/types";
import { context, signal, type Readable, type Signal } from "@implementjs/core";
import { api } from "$implement/client";
import type { NewIssue } from "./create-issue-dialog";

export const IssueManagerContext = context<IssueManager>();

export class IssueManager {
	issues: Signal<Issue[]>;
	labels: Signal<Label[]>;
	teams: Signal<Team[]>;
	createIssueDialogOpen = signal(false);
	constructor(issues: Readable<Issue[]>, labels: Readable<Label[]>, teams: Readable<Team[]>) {
		this.issues = signal(issues.get());
		this.labels = signal(labels.get());
		this.teams = signal(teams.get());
	}

	openCreateIssueDialog() {
		this.createIssueDialogOpen.set(true);
	}

	async createIssue(issue: NewIssue) {
		return await api.POST("/api/issues", { body: issue });
	}
}
