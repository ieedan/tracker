/**
 * A workspace's picture, or one generated from its slug.
 *
 * Nothing is stored: the avatar is a DiceBear SVG derived from a stable string,
 * so the same workspace is the same tile on every render, in every tab, on the
 * server and in the browser — without a round trip or a cache warm-up.
 * Rendering happens in-process rather than against the DiceBear HTTP API, so a
 * tile never depends on a third party being up and never leaks a slug to one.
 *
 * The result goes in as a `data:` URI rather than inline SVG markup: an `<img>`
 * is the same element the uploaded-picture branch uses, so both branches take
 * the same classes and neither needs raw HTML injection.
 */
import { Avatar, Style } from "@dicebear/core";
import blobs from "@dicebear/styles/blobs.json" with { type: "json" };
import loops from "@dicebear/styles/loops.json" with { type: "json" };
import patchwork from "@dicebear/styles/patchwork.json" with { type: "json" };
import rings from "@dicebear/styles/rings.json" with { type: "json" };
import shapeGrid from "@dicebear/styles/shape-grid.json" with { type: "json" };
import shapes from "@dicebear/styles/shapes.json" with { type: "json" };
import slice from "@dicebear/styles/slice.json" with { type: "json" };
import squircles from "@dicebear/styles/squircles.json" with { type: "json" };
import stack from "@dicebear/styles/stack.json" with { type: "json" };
import { Div, Img, Span } from "@implementjs/core";
import { cn } from "@/lib/utils";

interface Placeholder {
	/**
	 * The imported JSON, untyped: the definitions widen to `string` where
	 * DiceBear's `StyleDefinition` wants literal unions, and `Style` takes the
	 * definition's own shape as a parameter rather than that interface.
	 */
	definition: unknown;
	/**
	 * How much of the tile the drawing fills. DiceBear's styles are not framed
	 * alike — some are edge to edge, others sit in a wide margin that reads as
	 * an off-centre speck at the 20px the sidebar draws them at — so the ones
	 * that need it are scaled up until they sit in the tile like the rest. Past
	 * these values the drawing starts to clip against the edge.
	 */
	scale?: number;
	/** Built on first use; see `styleOf`. */
	style?: Style<unknown>;
}

/**
 * The styles a placeholder can be drawn in.
 *
 * Abstract ones only, and no faces: a workspace is a thing, not a person, and
 * the tile sits inches from the member avatars that _are_ people. Every entry
 * has to stay legible at 20px, which rules out the styles whose detail turns to
 * mud that small, and has to be distinguishable from the others at a glance —
 * two styles that both read as "textured square" are one style with extra
 * download.
 *
 * Order is load-bearing. `styleFor` indexes into this list, so inserting or
 * removing an entry redraws the workspaces whose hash lands past it. That is
 * survivable — these are placeholders, and any workspace that minds can upload
 * a picture — but it is not free, so prefer appending.
 */
const PLACEHOLDERS: Placeholder[] = [
	{ definition: blobs },
	{ definition: loops },
	{ definition: patchwork },
	{ definition: rings, scale: 1.2 },
	{ definition: shapeGrid },
	{ definition: shapes },
	{ definition: slice, scale: 1.3 },
	{ definition: squircles },
	{ definition: stack, scale: 1.5 },
];

/**
 * Which style a seed is drawn in. The same hash `avatarColor` spreads people
 * over their palette with — a style is one more thing a stable string picks out
 * of a list, and it spreads slugs evenly over these nine, down to the
 * two-character ones. DiceBear's own PRNG is no help here: the style has to be
 * chosen before there is an avatar to ask.
 */
function styleFor(seed: string): Placeholder {
	let hash = 0;
	for (let index = 0; index < seed.length; index++) {
		hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
	}
	return PLACEHOLDERS[hash % PLACEHOLDERS.length] ?? PLACEHOLDERS[0]!;
}

/**
 * Constructing a `Style` validates the definition against a JSON schema and
 * indexes it, which is worth doing once per style — but only for the styles
 * that actually get drawn, so a page showing two workspaces does not pay to
 * validate nine definitions. DiceBear deprecates passing the raw definition per
 * call, so this cannot be skipped, only deferred.
 */
function styleOf(placeholder: Placeholder): Style<unknown> {
	placeholder.style ??= new Style(placeholder.definition);
	return placeholder.style;
}

/**
 * Rendering a tile is a few hundred microseconds and the same handful of seeds
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

	const placeholder = styleFor(seed);
	const uri = new Avatar(styleOf(placeholder), {
		seed,
		scale: placeholder.scale,
	}).toDataUri();
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
