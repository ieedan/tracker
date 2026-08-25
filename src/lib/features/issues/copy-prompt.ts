/**
 * A right-rail control that copies a ready-to-paste agent prompt for an issue:
 * what the ticket is, the workspace it lives in, and how to keep it updated
 * over this app's MCP server while the agent works.
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

/**
 * Tight, paste-ready instructions for an agent working this issue.
 *
 * The agent reaches the tracker over MCP, not the REST API: the harness holds
 * the credential and renews it, so there is no key in this text — and an agent
 * using someone's key would file its work under that person instead of itself.
 * Tool names are deliberately absent; the server's own descriptions are the
 * contract and stay more current than a string baked in here.
 */
export function issueAgentPrompt(issue: Issue, slug: string, origin: string): string {
	const labels =
		issue.labels.length === 0 ? "none" : issue.labels.map((label) => label.name).join(", ");
	const assignee = issue.assignee?.name ?? "Unassigned";
	const body = issue.description.trim() === "" ? "(no description)" : issue.description.trim();
	const mcp = `${origin}/api/mcp`;

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
		"Track your progress in the tracker over MCP. Look for its tools in your available",
		"tools and read their descriptions — they are the contract. There is no token to",
		"fetch, no key to paste, and no Authorization header to set.",
		"",
		"If those tools are not there, the server has not been added yet. Add it once:",
		`  claude mcp add --transport http tracker ${mcp}`,
		"Harnesses that take JSON instead want the same URL:",
		`  { "mcpServers": { "tracker": { "type": "http", "url": "${mcp}" } } }`,
		"The first connection opens a browser to authorize; after that it renews itself.",
		"Do not register an OAuth client or run a device flow by hand — that creates a",
		"second identity. Do not use an API key or the REST API; keys belong to people, so",
		"your work would be filed under whoever minted one.",
		"",
		`Pass workspace "${slug}" and identifier ${issue.identifier} when a tool asks for them.`,
		"Statuses: backlog, todo, in_progress, done, canceled.",
		"",
		`Set ${issue.identifier} to in_progress when you start, comment as you go, and set it`,
		"done when you finish. If you get blocked, comment with the blocker and leave it",
		"in_progress rather than marking it done.",
		"If this covers multiple tickets, split the work across subagents.",
	].join("\n");
}
