// In-progress composer state, kept in localStorage so a refresh does not lose
// the issue they were writing. Keyed by workspace slug; the dialog restores
// and auto-saves. SSR has no storage, so every helper no-ops there.
import * as v from "valibot";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	type IssuePriority,
	type IssueStatus,
} from "@/lib/domain/issues";
import { AttachmentSchema, type Attachment } from "@/lib/domain/schemas";

export type IssueDraft = {
	title: string;
	description: string;
	status: IssueStatus;
	priority: IssuePriority;
	assigneeId: string | null;
	labelIds: string[];
	teamKey: string | null;
	/** The repository the issue was scoped to, if any. */
	repositoryId: string | null;
	/** Ready uploads; ids are adopted when the issue is created. */
	attachments: Attachment[];
};

export function issueDraftKey(slug: string): string {
	return `tracker:issue-draft:${slug}`;
}

function canUseStorage(): boolean {
	return typeof localStorage !== "undefined";
}

function isStatus(value: unknown): value is IssueStatus {
	return typeof value === "string" && ISSUE_STATUSES.some((status) => status === value);
}

function isPriority(value: unknown): value is IssuePriority {
	return typeof value === "string" && ISSUE_PRIORITIES.some((priority) => priority === value);
}

function parseDraft(raw: string): IssueDraft | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return null;
		const record = value as Record<string, unknown>;

		const title = typeof record.title === "string" ? record.title : "";
		const description = typeof record.description === "string" ? record.description : "";
		const status = isStatus(record.status) ? record.status : "backlog";
		const priority = isPriority(record.priority) ? record.priority : "none";
		const assigneeId = typeof record.assigneeId === "string" ? record.assigneeId : null;
		const teamKey =
			typeof record.teamKey === "string" && record.teamKey !== "" ? record.teamKey : null;
		// Read leniently: a draft written before repositories existed simply has
		// no scope, which is the same as not choosing one.
		const repositoryId =
			typeof record.repositoryId === "string" && record.repositoryId !== ""
				? record.repositoryId
				: null;
		const labelIds = Array.isArray(record.labelIds)
			? record.labelIds.filter((id): id is string => typeof id === "string")
			: [];
		// Drafts written before attachments were persisted simply have none.
		const attachments = parseAttachments(record.attachments);

		return {
			title,
			description,
			status,
			priority,
			assigneeId,
			labelIds,
			teamKey,
			repositoryId,
			attachments,
		};
	} catch {
		return null;
	}
}

function parseAttachments(value: unknown): Attachment[] {
	const parsed = v.safeParse(v.array(AttachmentSchema), value);
	return parsed.success ? parsed.output : [];
}

/** True when the form is still at defaults — nothing worth keeping. */
export function isBlankIssueDraft(draft: IssueDraft): boolean {
	return (
		draft.title.trim() === "" &&
		draft.description.trim() === "" &&
		draft.status === "backlog" &&
		draft.priority === "none" &&
		draft.assigneeId === null &&
		draft.labelIds.length === 0 &&
		// Unlike the team, which is chosen for you, a repository scope is only
		// ever there because somebody picked it.
		draft.repositoryId === null &&
		draft.attachments.length === 0
	);
}

export function loadIssueDraft(slug: string): IssueDraft | null {
	if (!canUseStorage() || slug === "") return null;
	const raw = localStorage.getItem(issueDraftKey(slug));
	if (raw === null) return null;
	return parseDraft(raw);
}

export function saveIssueDraft(slug: string, draft: IssueDraft): void {
	if (!canUseStorage() || slug === "") return;
	localStorage.setItem(issueDraftKey(slug), JSON.stringify(draft));
}

export function clearIssueDraft(slug: string): void {
	if (!canUseStorage() || slug === "") return;
	localStorage.removeItem(issueDraftKey(slug));
}

const CREATE_MORE_KEY = "tracker:create-more";

/**
 * Whether the composer stays open after a create. Not part of a draft — it is
 * a preference that outlives any one issue, so it is stored on its own and
 * shared by every workspace, the way Linear remembers the switch.
 */
export function loadCreateMore(): boolean {
	if (!canUseStorage()) return false;
	return localStorage.getItem(CREATE_MORE_KEY) === "true";
}

export function saveCreateMore(value: boolean): void {
	if (!canUseStorage()) return;
	localStorage.setItem(CREATE_MORE_KEY, value ? "true" : "false");
}
