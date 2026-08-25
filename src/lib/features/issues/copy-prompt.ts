/**
 * A right-rail control that copies a ready-to-paste agent prompt for an issue:
 * what the ticket is, the workspace it lives in, and how to update it over
 * this app's API while the agent works.
 */
import { Dynamic, signal, type Readable } from "@implementjs/core";
import { Check, Copy } from "@implementjs/lucide";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/domain/issues";
import type { Issue } from "@/lib/domain/schemas";

export interface CopyPromptButtonProps {
	issue: Readable<Issue>;
	slug: Readable<string>;
}

/** Compact ghost button for the issue detail properties column. */
export function CopyPromptButton({ issue, slug }: CopyPromptButtonProps) {
	const copied = signal(false);

	const copy = async () => {
		const prompt = issueAgentPrompt(issue.get(), slug.get(), window.location.origin);
		try {
			await navigator.clipboard.writeText(prompt);
			copied.set(true);
			toastSuccess("Copied to clipboard");
			setTimeout(() => copied.set(false), 1500);
		} catch {
			toastError("Could not copy. Select and copy manually.");
		}
	};

	return Button(
		{
			size: "sm",
			variant: "ghost",
			class: "h-7 w-full justify-start gap-1.5 px-1.5 text-[12px] text-muted-foreground",
			title: "Copy an agent prompt for this issue",
			onClick: () => void copy(),
		},
		Dynamic([copied], (done) =>
			done ? Check({ class: "size-3.5 text-primary" }) : Copy({ class: "size-3.5" }),
		),
		copied.bind((done) => (done ? "Copied" : "Copy prompt")),
	);
}

/** Tight, paste-ready instructions for an agent working this issue. */
export function issueAgentPrompt(issue: Issue, slug: string, origin: string): string {
	const labels =
		issue.labels.length === 0 ? "none" : issue.labels.map((label) => label.name).join(", ");
	const assignee = issue.assignee?.name ?? "Unassigned";
	const body = issue.description.trim() === "" ? "(no description)" : issue.description.trim();
	const path = `/api/v1/workspaces/${slug}/issues/${issue.identifier}`;

	return [
		`Work on ${issue.identifier}: ${issue.title}`,
		"",
		`Workspace: ${slug}`,
		`Team: ${issue.team.name} (${issue.team.key})`,
		`Status: ${STATUS_LABELS[issue.status]} (${issue.status})`,
		`Priority: ${PRIORITY_LABELS[issue.priority]} (${issue.priority})`,
		`Assignee: ${assignee}`,
		`Labels: ${labels}`,
		"",
		body,
		"",
		"Update this issue through the tracker API while you work.",
		`Base URL: ${origin}`,
		"",
		`PATCH ${path}`,
		"JSON body fields: status (backlog|todo|in_progress|done|canceled), title, description, priority (none|urgent|high|medium|low), assigneeId, labelIds.",
		"",
		`POST ${path}/comments`,
		`{ "body": "..." }`,
		"",
		"Auth: Authorization: Bearer <api key> or x-api-key. Use a key the user will paste separately. Do not invent or embed one.",
		"",
		"Mark the issue in_progress when you start, comment as you go, and mark it done when you finish.",
		"If this covers multiple tickets, split the work across subagents.",
	].join("\n");
}
