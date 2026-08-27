/**
 * Teams, and what they look like.
 *
 * A team is the thing whose key every issue identifier carries, so this is
 * where one gets created — and where its tile gets chosen, because the icon and
 * the color are identity, not decoration: they are what the sidebar, the
 * composer and every team menu draw. Everyone can read the roster; only an
 * admin gets the editors, matching how the members list behaves.
 */
import {
	Div,
	Dynamic,
	ForEach,
	H2,
	If,
	ImplementLifecycle,
	Input,
	P,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import type { Team } from "@/lib/domain/schemas";
import { TEAM_COLORS, type TeamIconName } from "@/lib/domain/team-icons";
import { TeamIcon } from "@/lib/features/teams/team-icon";
import { TeamLookPicker } from "@/lib/features/teams/team-look-picker";

const inputClass =
	"h-8 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus:border-ring";

/** The column stores a plain string; the picker only ever writes known names. */
function asIconName(value: string | null): TeamIconName | null {
	return value as TeamIconName | null;
}

export function TeamsSection(slug: Readable<string>, isAdmin: Readable<boolean>) {
	const teams = signal<Team[]>([]);
	const loading = signal(true);

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/teams", {
			params: { slug: slug.get() },
		});
		loading.set(false);
		if (error !== undefined) return;
		teams.set(data);
	};

	const patch = async (
		team: Team,
		body: { name?: string; icon?: string | null; color?: string | null },
	) => {
		const { data, error } = await api.PATCH("/api/v1/workspaces/[slug]/teams/[key]", {
			params: { slug: slug.get(), key: team.key },
			body: {
				...(body.name === undefined ? {} : { name: body.name }),
				...(body.icon === undefined ? {} : { icon: asIconName(body.icon) }),
				...(body.color === undefined ? {} : { color: body.color }),
			},
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not save that"));
			await load();
			return null;
		}
		teams.update((list) => list.map((entry) => (entry.id === data.id ? data : entry)));
		return data;
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		ImplementLifecycle({ onMount: () => void load() }),

		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, "Teams"),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"A team owns its issues, and its key is their prefix — the ENG in ENG-42.",
			),
		),

		If(
			derived([loading, teams], (busy, list) => !busy && list.length > 0),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				ForEach(
					teams,
					(team) => team.id,
					(team) => TeamRow(team, isAdmin, patch),
				),
			),
		),

		If(isAdmin, CreateTeam(slug, teams)),
	);
}

function TeamRow(
	team: Signal<Team>,
	isAdmin: Readable<boolean>,
	patch: (
		team: Team,
		body: { name?: string; icon?: string | null; color?: string | null },
	) => Promise<Team | null>,
) {
	const name = signal(team.get().name);
	team.onChange((next) => name.set(next.name));

	const commitName = async () => {
		const next = name.get().trim();
		if (next === "" || next === team.get().name) {
			name.set(team.get().name);
			return;
		}
		if ((await patch(team.get(), { name: next })) !== null) toastSuccess("Team renamed");
	};

	return Div(
		{ class: "flex items-center gap-3 px-3 py-2.5" },

		If(isAdmin)
			.Then(
				TeamLookPicker({
					name,
					teamKey: team.bind("key"),
					// Two-way views into the row, so the glyph beside the name updates
					// as the panel is used and the server only hears the settled choice.
					icon: team.bind("icon"),
					color: team.bind("color"),
					onChange: (look) => void patch(team.get(), look),
				}),
			)
			.Else(Dynamic([team], (value) => TeamIcon(value, "size-5"))),

		Div(
			{ class: "flex min-w-0 flex-1 items-center gap-2" },
			If(isAdmin)
				.Then(
					Input({
						value: name,
						class: `${inputClass} min-w-0 flex-1`,
						onBlur: () => void commitName(),
						onKeydown: (event) => {
							if (event.key === "Enter") void commitName();
						},
					}),
				)
				.Else(Span({ class: "min-w-0 flex-1 truncate text-[13px]" }, team.bind("name"))),
			Span(
				{
					class:
						"shrink-0 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground",
					title: "Issue prefix — it cannot change once issues carry it",
				},
				team.bind("key"),
			),
		),

		Span(
			{ class: "shrink-0 text-[12px] text-muted-foreground" },
			team.bind((value) => `${value.issueCount} issue${value.issueCount === 1 ? "" : "s"}`),
		),
	);
}

/**
 * The key is left blank by default — the server derives one from the name, and
 * a guess it can suffix beats a collision it has to refuse.
 */
function CreateTeam(slug: Readable<string>, teams: Signal<Team[]>) {
	const name = signal("");
	const key = signal("");
	const icon = signal<string | null>(null);
	const color = signal<string | null>(TEAM_COLORS[0]);
	const creating = signal(false);

	const create = async () => {
		const trimmed = name.get().trim();
		if (trimmed === "") return;

		creating.set(true);
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/teams", {
			params: { slug: slug.get() },
			body: {
				name: trimmed,
				...(key.get().trim() === "" ? {} : { key: key.get().trim().toUpperCase() }),
				icon: asIconName(icon.get()),
				color: color.get(),
			},
		});
		creating.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the team"));
			return;
		}

		teams.push(data);
		toastSuccess(`Created ${data.name} (${data.key})`);
		name.set("");
		key.set("");
		icon.set(null);
		color.set(TEAM_COLORS[0]);
	};

	return Div(
		{ class: "flex flex-wrap items-center gap-2" },
		TeamLookPicker({
			name: name.bind((value) => (value.trim() === "" ? "New team" : value)),
			teamKey: key,
			icon,
			color,
		}),
		Input({
			value: name,
			placeholder: "Team name",
			class: `${inputClass} min-w-40 flex-1`,
			onKeydown: (event) => {
				if (event.key === "Enter") void create();
			},
		}),
		Input({
			value: key,
			placeholder: "KEY",
			maxLength: 6,
			class: `${inputClass} w-20 font-mono uppercase`,
			onKeydown: (event) => {
				if (event.key === "Enter") void create();
			},
		}),
		Button({ size: "sm", loading: creating, onClick: () => void create() }, "Add team"),
	);
}
