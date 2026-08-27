/**
 * A workspace's picture, or one generated from its slug.
 *
 * Nothing is stored: the avatar is a DiceBear "slice" SVG derived from a stable
 * string, so the same workspace is the same tile on every render, in every tab,
 * on the server and in the browser — without a round trip or a cache warm-up.
 * Rendering happens in-process rather than against the DiceBear HTTP API, so a
 * tile never depends on a third party being up and never leaks a slug to one.
 *
 * The result goes in as a `data:` URI rather than inline SVG markup: an `<img>`
 * is the same element the uploaded-picture branch uses, so both branches take
 * the same classes and neither needs raw HTML injection.
 */
import { Avatar, Style } from "@dicebear/core";
import definition from "@dicebear/styles/slice.json" with { type: "json" };
import { Div, Img, Span } from "@implementjs/core";
import { cn } from "@/lib/utils";

// One instance, reused for every avatar: the definition is parsed and indexed
// on construction, and DiceBear deprecates passing the raw definition per call.
const style = new Style(definition);

/**
 * Rendering a slice is a few hundred microseconds and the same handful of seeds
 * come back on every render — the switcher, the picker, the breadcrumb — so the
 * markup is memoized. Bounded, because the server process is long-lived and
 * sees whatever slugs get requested; oldest-first eviction is enough when the
 * working set is one person's workspaces.
 */
const CACHE_LIMIT = 256;
const cache = new Map<string, string>();

/** The `data:` URI for a seed. Exported for anything that paints its own tile. */
export function workspaceAvatarUri(seed: string): string {
	const cached = cache.get(seed);
	if (cached !== undefined) return cached;

	const uri = new Avatar(style, { seed }).toDataUri();
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(seed, uri);
	return uri;
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
	/** Seeds the avatar. Immutable, unlike the name. */
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
export function GeneratedWorkspaceAvatar(options: { seed: string; class?: string }) {
	return Img({
		src: workspaceAvatarUri(options.seed),
		alt: "",
		class: cn(SHAPE, "object-cover", options.class),
	});
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
		class: className,
	});
}
