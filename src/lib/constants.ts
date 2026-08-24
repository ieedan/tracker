import type { Mountable } from "@implementjs/core";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	CircleDotDashedIcon,
	CircleDotIcon,
	CircleIcon,
	CircleSlashIcon,
	CopyIcon,
	EllipsisIcon,
	RotateCcwIcon,
	SignalHighIcon,
	SignalLowIcon,
	SignalMediumIcon,
} from "@implementjs/lucide";

export type UIEnumList = Record<string, { icon: () => Mountable }>;

export const ISSUE_STATUSES = {
	Backlog: {
		icon: () => CircleDashedIcon({ class: "text-neutral-400" }),
	},
	Todo: {
		icon: () => CircleIcon({ class: "text-muted-foreground" }),
	},
	Rework: {
		icon: () => RotateCcwIcon({ class: "text-orange-400" }),
	},
	"In Progress": {
		icon: () => CircleDotIcon({ class: "text-yellow-400" }),
	},
	"In Review": {
		icon: () => CircleDotDashedIcon({ class: "text-indigo-500" }),
	},
	Done: {
		icon: () => CircleCheckIcon({ class: "text-emerald-500" }),
	},
	Canceled: {
		icon: () => CircleSlashIcon({ class: "text-neutral-400" }),
	},
	Duplicate: {
		icon: () => CopyIcon({ class: "text-neutral-400" }),
	},
} as const satisfies UIEnumList;

export type Status = keyof typeof ISSUE_STATUSES;

export const STATUSES = Object.keys(ISSUE_STATUSES) as [Status, ...Status[]];

export const ISSUE_PRIORITIES = {
	None: {
		icon: () => EllipsisIcon({ class: "text-muted-foreground" }),
	},
	Urgent: {
		icon: () => CircleAlertIcon({ class: "text-orange-500" }),
	},
	High: {
		icon: () => SignalHighIcon({ class: "text-muted-foreground" }),
	},
	Medium: {
		icon: () => SignalMediumIcon({ class: "text-muted-foreground" }),
	},
	Low: {
		icon: () => SignalLowIcon({ class: "text-muted-foreground" }),
	},
} as const satisfies UIEnumList;

export type Priority = keyof typeof ISSUE_PRIORITIES;

export const PRIORITIES = Object.keys(ISSUE_PRIORITIES) as [Priority, ...Priority[]];
