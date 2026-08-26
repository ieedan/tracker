/**
 * Who is in the workspace, and — for an admin — what to do about it.
 *
 * Everyone can see the roster; the controls only appear for an admin, and the
 * server checks again regardless. The two dangerous edges are enforced there
 * too: the last admin can neither be demoted nor removed, because a workspace
 * with no admin is one nobody can manage.
 */
import {
	Div,
	ForEach,
	H2,
	If,
	ImplementEffect,
	Input,
	P,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ChevronDown, Copy, Shield, User, UserMinus } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { AgentBadge, UserAvatar } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import { DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/lib/components/ui/responsive-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import type { WorkspaceRole } from "@/lib/domain/issues";
import type { Member, Workspace } from "@/lib/domain/schemas";

interface MembersData {
	workspace: Workspace;
	members: Member[];
	/** The signed-in person, so their own row can say so. */
	viewerId: string;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
	admin: "Admin",
	member: "Member",
};

const ROLE_HINTS: Record<WorkspaceRole, string> = {
	admin: "Manages members, settings and integrations",
	member: "Full access to issues and feedback",
};

const badgeClass =
	"rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground capitalize";

export function MembersSection(
	data: Readable<MembersData>,
	slug: Readable<string>,
	copy: (value: string) => Promise<void>,
) {
	const members = signal(data.get().members);
	const isAdmin = data.bind((value) => value.workspace.role === "admin");
	const viewerId = data.bind((value) => value.viewerId);
	data.onChange((next) => members.set(next.members));

	const email = signal("");
	const adding = signal(false);
	const inviteUrl = signal("");

	// The row the confirmation is about. Held apart from `confirming` so the
	// name stays on screen while the dialog animates shut.
	const pending = signal<Member | null>(null);
	const confirming = signal(false);
	const removing = signal(false);

	const addByEmail = async () => {
		const address = email.get().trim();
		if (address === "") return;

		adding.set(true);
		const { data: member, error } = await api.POST("/api/v1/workspaces/[slug]/members", {
			params: { slug: slug.get() },
			body: { email: address },
		});
		adding.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not add them"));
			return;
		}
		members.push(member);
		email.set("");
		toastSuccess(`${member.user.name} joined the workspace`);
	};

	const createInvite = async () => {
		const { data: invite, error } = await api.POST("/api/v1/workspaces/[slug]/invites", {
			params: { slug: slug.get() },
			body: {},
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not create an invite link"));
			return;
		}
		inviteUrl.set(invite.url);
		await copy(invite.url);
	};

	/** Resolves to whether it stuck, so the picker can snap back if it did not. */
	const changeRole = async (target: Member, role: WorkspaceRole): Promise<boolean> => {
		if (target.role === role) return true;

		const { data: updated, error } = await api.PATCH("/api/v1/workspaces/[slug]/members/[userId]", {
			params: { slug: slug.get(), userId: target.user.id },
			body: { role },
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not change their role"));
			return false;
		}

		members.update((list) => list.map((row) => (row.id === updated.id ? updated : row)));
		toastSuccess(`${updated.user.name} is now ${ROLE_LABELS[updated.role].toLowerCase()}`);
		return true;
	};

	const askToRemove = (target: Member) => {
		pending.set(target);
		confirming.set(true);
	};

	const confirmRemove = async () => {
		const target = pending.get();
		if (target === null) return;

		removing.set(true);
		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/members/[userId]", {
			params: { slug: slug.get(), userId: target.user.id },
		});
		removing.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not remove them"));
			return;
		}
		members.update((list) => list.filter((row) => row.id !== target.id));
		confirming.set(false);
		toastSuccess(`${target.user.name} was removed from the workspace`);
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, "Members"),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"Who can see and work on this workspace. Admins can change roles and remove people.",
			),
		),

		Div(
			{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
			ForEach(
				members,
				(member) => member.id,
				(member) => MemberRow(member, isAdmin, viewerId, changeRole, askToRemove),
			),
		),

		If(
			isAdmin,
			Div(
				{ class: "flex flex-col gap-3" },
				Div(
					{ class: "flex gap-2" },
					Input({
						value: email,
						type: "email",
						placeholder: "teammate@example.com",
						class:
							"h-8 flex-1 rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring",
						onKeydown: (event) => {
							if (event.key === "Enter") void addByEmail();
						},
					}),
					Button({ size: "sm", loading: adding, onClick: () => void addByEmail() }, "Add"),
					Button(
						{ size: "sm", variant: "secondary", onClick: () => void createInvite() },
						"Invite link",
					),
				),

				If(
					inviteUrl.bind((value) => value !== ""),
					Div(
						{
							class:
								"flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2",
						},
						Span({ class: "min-w-0 flex-1 truncate font-mono text-[11px]" }, inviteUrl),
						Button(
							{
								size: "icon-sm",
								variant: "ghost",
								title: "Copy link",
								onClick: () => void copy(inviteUrl.get()),
							},
							Copy({ class: "size-3.5" }),
						),
					),
				),
			),
		),

		RemoveDialog(pending, confirming, removing, confirmRemove),
	);
}

function MemberRow(
	member: Signal<Member>,
	isAdmin: Readable<boolean>,
	viewerId: Readable<string>,
	changeRole: (target: Member, role: WorkspaceRole) => Promise<boolean>,
	askToRemove: (target: Member) => void,
) {
	// A bot's membership is not ours to edit: it exists because someone
	// authorized an agent, and it comes back the moment that agent acts again.
	// Its role is fixed at `member` by the guards either way.
	const manageable = derived(
		[isAdmin, member],
		(admin, value) => admin && value.user.type !== "agent",
	);
	const isViewer = derived([viewerId, member], (id, value) => value.user.id === id);

	return Div(
		{ class: "flex items-center gap-3 px-3 py-2.5" },
		UserAvatar(member.get().user),
		Div(
			{ class: "min-w-0 flex-1" },
			Div(
				{ class: "flex items-center gap-1.5" },
				Span(
					{ class: "truncate text-[13px]" },
					member.bind((value) => value.user.name),
				),
				If(
					member.bind((value) => value.user.type === "agent"),
					AgentBadge(),
				),
				If(isViewer, Span({ class: "text-[11px] text-muted-foreground" }, "You")),
			),
			Div(
				{ class: "truncate text-[12px] text-muted-foreground" },
				// A bot's address is a synthetic `@agents.invalid` placeholder that
				// exists only because `user.email` is NOT NULL. Showing it is noise,
				// and it leaks the client id.
				member.bind((value) =>
					value.user.type === "agent" ? "Authorized to act in this workspace" : value.user.email,
				),
			),
		),

		RolePicker(member, manageable, changeRole),

		If(
			manageable,
			Button(
				{
					size: "icon-xs",
					variant: "ghost",
					class: "size-7 text-muted-foreground hover:text-destructive",
					title: "Remove from workspace",
					onClick: () => askToRemove(member.get()),
				},
				UserMinus({ class: "size-3.5" }),
			),
		),
	);
}

/** A menu for an admin, the same badge everyone else has always seen otherwise. */
function RolePicker(
	member: Signal<Member>,
	manageable: Readable<boolean>,
	changeRole: (target: Member, role: WorkspaceRole) => Promise<boolean>,
) {
	const value = signal<string | null>(member.get().role);

	return If(manageable)
		.Then(
			DropdownMenu(
				ImplementEffect([member], (next) => value.set(next.role)),
				DropdownMenuTrigger(
					{
						variant: "ghost",
						size: "xs",
						class: "gap-1 bg-secondary px-1.5 text-[11px] font-normal text-muted-foreground",
						title: "Change role",
					},
					Span(
						{},
						member.bind((next) => ROLE_LABELS[next.role]),
					),
					ChevronDown({ class: "size-3" }),
				),
				DropdownMenuContent(
					{ class: "w-60", align: "end", hotkeys: true },
					DropdownMenuRadioGroup(
						{
							value,
							onValueChange: (next) => {
								if (typeof next !== "string") return;
								void (async () => {
									const target = member.get();
									const kept = await changeRole(target, next as WorkspaceRole);
									// The menu already moved the tick; put it back if the
									// server refused — the last admin cannot step down.
									if (!kept) value.set(member.get().role);
								})();
							},
						},
						DropdownMenuGroupHeading("Role"),
						RoleOption("admin", Shield({ class: "size-3.5" })),
						RoleOption("member", User({ class: "size-3.5" })),
					),
				),
			),
		)
		.Else(
			Span(
				{ class: badgeClass },
				member.bind((next) => ROLE_LABELS[next.role]),
			),
		);
}

function RoleOption(role: WorkspaceRole, icon: ReturnType<typeof Shield>) {
	return DropdownMenuRadioItem(
		{ value: role },
		icon,
		Div(
			{ class: "flex min-w-0 flex-1 flex-col" },
			Span({ class: "text-[13px]" }, ROLE_LABELS[role]),
			Span({ class: "text-[11px] text-muted-foreground" }, ROLE_HINTS[role]),
		),
	);
}

function RemoveDialog(
	pending: Readable<Member | null>,
	open: Signal<boolean>,
	removing: Readable<boolean>,
	confirm: () => Promise<void>,
) {
	return ResponsiveDialog(
		{ open },
		ResponsiveDialogContent(
			{ class: "gap-0 p-0 md:max-w-md" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle({ class: "text-[15px] font-semibold" }, "Remove from workspace"),
				DialogDescription(
					{ class: "text-[12px]" },
					pending.bind((member) =>
						member === null
							? ""
							: `${member.user.name} loses access immediately, and anything assigned to them is unassigned. You can add them back later.`,
					),
				),
			),
			Div(
				{ class: "flex justify-end gap-2 px-4 py-3" },
				Button({ size: "sm", variant: "secondary", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						variant: "destructive",
						loading: removing,
						onClick: () => void confirm(),
					},
					"Remove",
				),
			),
		),
	);
}
