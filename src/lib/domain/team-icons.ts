/**
 * A team's icon and color vocabulary, as plain data.
 *
 * The glyphs themselves live in `@/lib/features/teams/team-icon`, which pulls in
 * lucide components — nothing a server route may import. The server still has to
 * agree with the picker about what a valid icon name is, so the names and the
 * palette live here, in a module with no DOM imports, and both sides read them
 * from one place.
 */
import * as v from "valibot";

/**
 * What the `team.icon` column stores. Renaming an entry is a data migration —
 * add, don't rename. `TEAM_ICONS` in the feature folder maps each of these to a
 * glyph and is typed to stay exhaustive, so the two lists cannot drift.
 */
export const TEAM_ICON_NAMES = [
	"code",
	"terminal",
	"server",
	"database",
	"cpu",
	"cloud",
	"package",
	"layers",
	"bug",
	"wrench",
	"flask",
	"shield",
	"gauge",
	"zap",
	"palette",
	"pen-tool",
	"sparkles",
	"compass",
	"box",
	"puzzle",
	"rocket",
	"target",
	"megaphone",
	"chart",
	"briefcase",
	"globe",
	"users",
	"headphones",
	"book",
	"smartphone",
] as const;

export type TeamIconName = (typeof TEAM_ICON_NAMES)[number];

export function isTeamIconName(value: string): value is TeamIconName {
	return (TEAM_ICON_NAMES as readonly string[]).includes(value);
}

/** Preset tile colors the picker offers (Linear's palette, roughly). */
export const TEAM_COLORS = [
	"#6e79d6", // indigo
	"#5e9be0", // blue
	"#4cb782", // green
	"#dfa438", // amber
	"#e07a4c", // orange
	"#d65e5e", // red
	"#d15dc0", // pink
	"#9d5dd1", // purple
	"#5dc9d1", // teal
	"#8a8f98", // gray
] as const;

/**
 * Any six-digit hex, not just the presets — the swatches are a shortcut, not a
 * closed set, and a workspace pasting its brand color should not be refused.
 */
export const TEAM_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** `icon` as it arrives over the wire: a known name, or null to clear it. */
export const TeamIconNameSchema = v.picklist(TEAM_ICON_NAMES);

/** `color` as it arrives over the wire — normalized to lowercase hex. */
export const TeamColorSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.regex(TEAM_COLOR_PATTERN, "color must be a hex value like #6e79d6"),
);

export interface TeamLook {
	icon: TeamIconName | null;
	color: string | null;
}

/**
 * What the teams every workspace starts with look like. Keyed by team key, so a
 * seeded Engineering reads the same in a fresh workspace as in the demo data;
 * anything else falls back to the hashed tile.
 */
export const DEFAULT_TEAM_LOOKS: Record<string, TeamLook> = {
	ENG: { icon: "code", color: "#6e79d6" },
	PRD: { icon: "compass", color: "#5e9be0" },
};

export function defaultTeamLook(key: string): TeamLook {
	return DEFAULT_TEAM_LOOKS[key.toUpperCase()] ?? { icon: null, color: null };
}
