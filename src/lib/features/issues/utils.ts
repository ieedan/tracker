import type { Issue } from "@/lib/db/types";

export function formatIssueId(issue: Issue): string;
export function formatIssueId(team: string, id: number): string;
export function formatIssueId(teamOrIssue: string | Issue, id?: number) {
	if (typeof teamOrIssue !== "string") {
		return formatIssueId(teamOrIssue.team.shortHand, teamOrIssue.id);
	}

	return `${teamOrIssue}-${id!.toString().padStart(3, "0")}`;
}
