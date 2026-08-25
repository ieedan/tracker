/**
 * A workspace's picture, or one generated from its slug.
 *
 * Nothing is stored: the avatar is a gradient computed from a 32-bit hash of a
 * stable string, so the same workspace is the same tile on every render, in
 * every tab, on the server and in the browser — without a round trip, a cache,
 * or a dependency. The whole thing is a few integer ops and a template string,
 * which is cheaper than reaching for an identicon library and cheaper than the
 * `<img>` it replaces.
 *
 * The colors are `oklch()` rather than `hsl()` on purpose. Perceived lightness
 * is fixed in oklch, so every hue on the wheel lands at the same brightness and
 * the white initial keeps its contrast — in hsl the yellows and greens come out
 * washed and the letter disappears.
 */
import { Div, Img, Span } from "@implementjs/core";
import { cn } from "@/lib/utils";

/**
 * FNV-1a, 32-bit. Chosen for spread rather than for cryptography: neighbouring
 * slugs ("acme", "acme-2") have to land on visibly different hues, and a plain
 * `hash * 31 + char` walks them into the same corner of the wheel.
 */
function hash32(seed: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index++) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** The CSS gradient for a seed. Exported for anything that paints its own tile. */
export function workspaceGradient(seed: string): string {
	const hash = hash32(seed);
	// Three independent slices of the hash: which hue, how far the second stop
	// travels from it, and which way the gradient runs. One hue alone reads as
	// eight flat circles once a few workspaces sit in a list together.
	const hue = hash % 360;
	const spread = 24 + ((hash >>> 9) % 40);
	const angle = 110 + ((hash >>> 17) % 70);
	const end = (hue + spread) % 360;
	return `linear-gradient(${angle}deg, oklch(0.58 0.13 ${hue}), oklch(0.45 0.15 ${end}))`;
}

/** The letter on the tile: the first letter or digit of the name. */
export function workspaceInitial(name: string): string {
	const match = /[\p{L}\p{N}]/u.exec(name);
	return match === null ? "?" : match[0].toUpperCase();
}

/**
 * The size and radius live here rather than at the call sites so the tile is
 * the same shape everywhere; `cn` runs the caller's classes through
 * tailwind-merge, so a bigger `size-*` or `text-*` still wins.
 */
const SHAPE = "size-5 shrink-0 rounded-[5px]";
const TILE = `flex ${SHAPE} items-center justify-center text-[10px]`;

export interface WorkspaceAvatarSource {
	name: string;
	/** Seeds the gradient. Immutable, unlike the name. */
	slug: string;
	id?: string;
	image?: string | null;
}

/**
 * The generated tile on its own, for a workspace that does not exist yet.
 *
 * Decorative — no `title` and no alt text. Every place a workspace avatar
 * appears, its name is already sitting next to it.
 */
export function GeneratedWorkspaceAvatar(options: { seed: string; name: string; class?: string }) {
	return Div(
		{
			class: cn(TILE, "font-bold text-white select-none", options.class),
			style: { backgroundImage: workspaceGradient(options.seed) },
		},
		Span({ class: "leading-none" }, workspaceInitial(options.name)),
	);
}

/**
 * A workspace's avatar: the uploaded picture when there is one, the generated
 * tile when there is not.
 *
 * Takes a plain value rather than a signal — every call site already sits
 * inside a `Dynamic` or a `ForEach` row, and the two branches are different
 * elements, so there is nothing here for a binding to update in place.
 */
export function WorkspaceAvatar(workspace: WorkspaceAvatarSource | undefined, className?: string) {
	if (workspace === undefined) {
		return Div(
			{ class: cn(TILE, "bg-muted font-medium text-muted-foreground", className) },
			Span({ class: "leading-none" }, "?"),
		);
	}

	if (workspace.image != null && workspace.image !== "") {
		return Img({
			src: workspace.image,
			alt: "",
			class: cn(SHAPE, "object-cover", className),
		});
	}

	return GeneratedWorkspaceAvatar({
		seed: workspace.slug === "" ? (workspace.id ?? workspace.name) : workspace.slug,
		name: workspace.name,
		class: className,
	});
}
