import type { Issue, issues } from "@/lib/db.server";
import { context, signal, type Readable, type Signal } from "@implementjs/core";
import type { InferInsertModel } from "drizzle-orm";

export type NewIssue = InferInsertModel<typeof issues>

export const IssueManagerContext = context<IssuesManager>()

export class IssuesManager {
    issues: Signal<Issue[]>
    createIssueDialogOpen = signal(false);

    constructor(issues: Readable<Issue[]>) {
        this.issues = signal(issues.get())
    }

    async createIssue(issue: NewIssue) {
        const response = await fetch('/api/issues', {
            method: 'POST',
            body: JSON.stringify(issue),
        });

        console.log(response)

        const data = await response.json();

        console.log(data)

        this.issues.push(data);

        console.log(this.issues)

        return data;
    }

    async deleteIssue(id: number) {

    }

    async updateIssue(id: number, issue: Partial<Issue>) {

    }

    openCreateIssueDialog() {
        this.createIssueDialogOpen.set(true);
    }

    closeCreateIssueDialog() {
        this.createIssueDialogOpen.set(false);
    }
}
