/**
 * A team's icon — Linear-style: the glyph itself, tinted with the team's
 * color, no tile behind it.
 *
 * Nothing here requires a team to have chosen anything: every team renders a
 * real glyph. With nothing stored, a known key gets its curated default look
 * (`ENG` is code, `PRD` is compass), and any other team hashes its name into a
 * stable pick from the icon set and a stable oklch hue — the same trick as the
 * workspace avatar. Picking is an upgrade, not a requirement.
 *
 * Takes plain values rather than signals — call sites sit inside `ForEach` or
 * `Dynamic` rows already (same reasoning as `WorkspaceAvatar`), so wrap in
 * `Dynamic` when the team can change under the icon.
 */
import {
	BookOpen,
	Box,
	Briefcase,
	Bug,
	ChartLine,
	Cloud,
	Code,
	Compass,
	Cpu,
	Database,
	FlaskConical,
	Gauge,
	Globe,
	Headphones,
	Layers,
	Megaphone,
	Package,
	Palette,
	PenTool,
	Puzzle,
	Rocket,
	Server,
	Shield,
	Smartphone,
	Sparkles,
	Target,
	Terminal,
	Users,
	Wrench,
	Zap,
} from "@implementjs/lucide";
import {
	defaultTeamLook,
	TEAM_COLORS,
	TEAM_ICON_NAMES,
	type TeamIconName,
} from "@/lib/domain/team-icons";
import { cn } from "@/lib/utils";

type IconComponent = typeof Code;

export { TEAM_COLORS };
export type { TeamIconName };

/**
 * The set a team can pick from — one glyph per name in `TEAM_ICON_NAMES`, which
 * is where the server validates against. Typing it as a full record of those
 * names is what keeps the two in step: add a name there and this stops
 * compiling until the glyph lands here.
 */
export const TEAM_ICONS = {
	code: Code,
	terminal: Terminal,
	server: Server,
	database: Database,
	cpu: Cpu,
	cloud: Cloud,
	package: Package,
	layers: Layers,
	bug: Bug,
	wrench: Wrench,
	flask: FlaskConical,
	shield: Shield,
	gauge: Gauge,
	zap: Zap,
	palette: Palette,
	"pen-tool": PenTool,
	sparkles: Sparkles,
	compass: Compass,
	box: Box,
	puzzle: Puzzle,
	rocket: Rocket,
	target: Target,
	megaphone: Megaphone,
	chart: ChartLine,
	briefcase: Briefcase,
	globe: Globe,
	users: Users,
	headphones: Headphones,
	book: BookOpen,
	smartphone: Smartphone,
} as const satisfies Record<TeamIconName, IconComponent>;

/** FNV-1a, 32-bit — same spread-first hash as the workspace avatar. */
function hash32(seed: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index++) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export interface TeamIconSource {
	name: string;
	/** Lets a well-known team (`ENG`, `PRD`) resolve its curated default look. */
	key?: string;
	icon: string | null;
	color: string | null;
}

/** The tint for a team's glyph: chosen, curated default, or a stable hashed hue. */
export function teamColor(team: Pick<TeamIconSource, "name" | "key" | "color">): string {
	if (team.color !== null && team.color !== "") return team.color;
	const preset = defaultTeamLook(team.key ?? "").color;
	if (preset !== null) return preset;
	// Brighter than a background tile would be: this is the glyph itself, which
	// needs to read as a line drawing against either theme.
	return `oklch(0.68 0.13 ${hash32(team.name) % 360})`;
}

/** The glyph for a team: chosen, curated default, or a stable hashed pick. */
function teamGlyph(
	team: Pick<TeamIconSource, "name" | "key" | "icon">,
): (typeof TEAM_ICONS)[TeamIconName] {
	if (team.icon !== null && team.icon in TEAM_ICONS) return TEAM_ICONS[team.icon as TeamIconName];
	const preset = defaultTeamLook(team.key ?? "").icon;
	if (preset !== null) return TEAM_ICONS[preset];
	return TEAM_ICONS[TEAM_ICON_NAMES[hash32(team.name) % TEAM_ICON_NAMES.length]!];
}

/**
 * The glyph itself, colored. `class` merges through `cn`, so a caller's
 * `size-*` wins over the `size-4` default.
 */
export function TeamIcon(team: TeamIconSource, className?: string) {
	const Icon = teamGlyph(team);
	return Icon({ class: cn("size-4 shrink-0", className), style: { color: teamColor(team) } });
}
