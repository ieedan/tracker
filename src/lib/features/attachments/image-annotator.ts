/**
 * Marking up an image attachment: a pen, a highlighter, arrows, boxes, ellipses
 * and text, drawn over the picture before it is filed.
 *
 * Everything is kept as shapes in image coordinates rather than as pixels, so
 * the drawing is resolution independent — a mark made on a screenshot shown at
 * 40% comes out crisp at full size, and undo is popping the last shape rather
 * than replaying a bitmap. The canvas is the image's natural size; only CSS
 * scales it down to fit, and pointer positions are mapped back through that
 * scale on the way in.
 *
 * Saving rasterises once, at the end, into a PNG. The caller decides what to do
 * with the file — the create dialog uploads it and drops the original, so the
 * marked-up copy takes the place of the picture it came from.
 *
 * The image is served from this app's own origin (see `attachmentUrl`), which
 * is what keeps the canvas untainted and `toBlob` legal.
 */
import {
	Canvas,
	Div,
	Dynamic,
	If,
	ImplementDocument,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import {
	ArrowUpRight,
	Circle,
	Highlighter,
	MousePointer2,
	Pen,
	Redo2,
	Square,
	Trash2,
	Type,
	Undo2,
	X,
	type IconComponent,
} from "@implementjs/lucide";
import { isTyping } from "@/lib/client/is-typing";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import type { Attachment } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

type AnnotationTool = "select" | "pen" | "highlighter" | "arrow" | "rect" | "ellipse" | "text";

interface Point {
	x: number;
	y: number;
}

type ShapeBody =
	| { kind: "stroke"; highlight: boolean; color: string; width: number; points: Point[] }
	| { kind: "arrow" | "rect" | "ellipse"; color: string; width: number; from: Point; to: Point }
	| { kind: "text"; color: string; size: number; at: Point; text: string };

/** A mark, with an identity of its own so the pointer can hold on to one. */
type Shape = ShapeBody & { id: number };

/** A box in image coordinates. */
interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

let nextShapeId = 0;

/** Where a text mark is being typed, in both spaces at once. */
interface TextDraft {
	at: Point;
	/** Offset inside the canvas box, so the input sits under the cursor. */
	left: number;
	top: number;
	/** Displayed size of one image pixel — the input has to match what it becomes. */
	scale: number;
	/** Font size in image pixels, fixed when the box was placed. */
	size: number;
}

/**
 * The tools, in the order their number keys run — Excalidraw's arrangement,
 * where the digit a tool answers to is its place on the bar and the letter is
 * the first letter of its name. Both are live; the bar shows the digit.
 */
const TOOLS: Array<{
	value: AnnotationTool;
	label: string;
	icon: IconComponent;
	/** Second way in, beside the digit. */
	key: string;
}> = [
	{ value: "select", label: "Select", icon: MousePointer2, key: "v" },
	{ value: "pen", label: "Pen", icon: Pen, key: "p" },
	{ value: "highlighter", label: "Highlighter", icon: Highlighter, key: "h" },
	{ value: "arrow", label: "Arrow", icon: ArrowUpRight, key: "a" },
	{ value: "rect", label: "Rectangle", icon: Square, key: "r" },
	{ value: "ellipse", label: "Ellipse", icon: Circle, key: "o" },
	{ value: "text", label: "Text", icon: Type, key: "t" },
];

/**
 * Marks have to stay legible on top of whatever is underneath them, which rules
 * out the theme's own colors — those are chosen to sit quietly next to text.
 */
const COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#3b82f6",
	"#a855f7",
	"#ffffff",
	"#111111",
] as const;

/** Stroke weight and text size, in multiples of the image's own scale unit. */
const WEIGHTS = [
	{ label: "Small", stroke: 2, font: 16, dot: "size-1.5" },
	{ label: "Medium", stroke: 4, font: 24, dot: "size-2.5" },
	{ label: "Large", stroke: 7, font: 36, dot: "size-3.5" },
] as const;

/** So a mark on a 4000px screenshot is not a hairline, nor a slab on a thumbnail. */
function scaleUnit(width: number, height: number): number {
	return Math.max(1, Math.min(width, height) / 640);
}

/** Image coordinates for a pointer, through whatever scale CSS is showing. */
function toImage(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
	const rect = canvas.getBoundingClientRect();
	return {
		x: ((clientX - rect.left) / rect.width) * canvas.width,
		y: ((clientY - rect.top) / rect.height) * canvas.height,
	};
}

/** How wide a mark's own ink is, which is also how near counts as on it. */
function inkWidth(shape: Shape): number {
	if (shape.kind === "text") return shape.size;
	return shape.kind === "stroke" && shape.highlight ? shape.width * 3 : shape.width;
}

/** Distance from a point to a segment — the whole of hit-testing a line. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const lengthSquared = dx * dx + dy * dy;
	// A segment of no length is a point, and the distance to it is direct.
	if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
	const along = Math.max(
		0,
		Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
	);
	return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy));
}

/**
 * What a mark occupies, ink included — the box the selection is drawn around.
 *
 * Text is the one kind whose extent the shape does not carry, so it is measured
 * against the context that will draw it.
 */
function boundsOf(context: CanvasRenderingContext2D, shape: Shape): Box {
	const pad = inkWidth(shape) / 2;

	if (shape.kind === "text") {
		context.save();
		context.font = `600 ${shape.size}px ui-sans-serif, system-ui, sans-serif`;
		const width = context.measureText(shape.text).width;
		context.restore();
		return {
			left: shape.at.x,
			top: shape.at.y,
			right: shape.at.x + width,
			// What `textBaseline: "top"` plus the font's own descent comes to.
			bottom: shape.at.y + shape.size * 1.2,
		};
	}

	const points = shape.kind === "stroke" ? shape.points : [shape.from, shape.to];
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	return {
		left: Math.min(...xs) - pad,
		top: Math.min(...ys) - pad,
		right: Math.max(...xs) + pad,
		bottom: Math.max(...ys) + pad,
	};
}

/**
 * Whether a point lands on a mark.
 *
 * On the ink itself rather than inside the box it occupies: these shapes are
 * outlines, so the middle of a rectangle belongs to whatever is under it — the
 * same rule Excalidraw uses for a shape with no fill. Text is the exception,
 * being solid where it is drawn.
 */
function hits(context: CanvasRenderingContext2D, shape: Shape, at: Point, slack: number): boolean {
	const reach = slack + inkWidth(shape) / 2;

	if (shape.kind === "text") {
		const box = boundsOf(context, shape);
		return (
			at.x >= box.left - slack &&
			at.x <= box.right + slack &&
			at.y >= box.top - slack &&
			at.y <= box.bottom + slack
		);
	}

	if (shape.kind === "stroke") {
		const { points } = shape;
		const first = points[0];
		if (first === undefined) return false;
		if (points.length === 1) return Math.hypot(at.x - first.x, at.y - first.y) <= reach;
		for (let i = 1; i < points.length; i += 1) {
			if (distanceToSegment(at, points[i - 1]!, points[i]!) <= reach) return true;
		}
		return false;
	}

	if (shape.kind === "arrow") return distanceToSegment(at, shape.from, shape.to) <= reach;

	const left = Math.min(shape.from.x, shape.to.x);
	const right = Math.max(shape.from.x, shape.to.x);
	const top = Math.min(shape.from.y, shape.to.y);
	const bottom = Math.max(shape.from.y, shape.to.y);

	if (shape.kind === "rect") {
		const outside =
			at.x < left - reach || at.x > right + reach || at.y < top - reach || at.y > bottom + reach;
		if (outside) return false;
		// Inside the border by more than its reach is the hollow middle.
		return !(
			at.x > left + reach &&
			at.x < right - reach &&
			at.y > top + reach &&
			at.y < bottom - reach
		);
	}

	const radiusX = (right - left) / 2;
	const radiusY = (bottom - top) / 2;
	if (radiusX === 0 || radiusY === 0) return false;
	const normalX = (at.x - (left + radiusX)) / radiusX;
	const normalY = (at.y - (top + radiusY)) / radiusY;
	// How far off the curve, scaled back into pixels by the tighter radius.
	return Math.abs(Math.hypot(normalX, normalY) - 1) * Math.min(radiusX, radiusY) <= reach;
}

/** The same mark, moved. Shapes are replaced rather than mutated, for undo. */
function moved(shape: Shape, dx: number, dy: number): Shape {
	if (shape.kind === "text") return { ...shape, at: { x: shape.at.x + dx, y: shape.at.y + dy } };
	if (shape.kind === "stroke") {
		return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
	}
	return {
		...shape,
		from: { x: shape.from.x + dx, y: shape.from.y + dy },
		to: { x: shape.to.x + dx, y: shape.to.y + dy },
	};
}

function boxesOverlap(a: Box, b: Box): boolean {
	return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/** A box from two corners, in any order. */
function boxBetween(a: Point, b: Point): Box {
	return {
		left: Math.min(a.x, b.x),
		top: Math.min(a.y, b.y),
		right: Math.max(a.x, b.x),
		bottom: Math.max(a.y, b.y),
	};
}

/** The four corners a box is resized by, clockwise from the top left. */
const CORNERS = ["nw", "ne", "se", "sw"] as const;
type Corner = (typeof CORNERS)[number];
/** An arrow is resized by its ends instead — that is what an arrow is. */
type Endpoint = "from" | "to";
type Handle = Corner | Endpoint;

function cornerOf(box: Box, corner: Corner): Point {
	const left = corner === "nw" || corner === "sw";
	const top = corner === "nw" || corner === "ne";
	return { x: left ? box.left : box.right, y: top ? box.top : box.bottom };
}

/** Where the handles of a selected mark sit, and what each one is called. */
function handlesOf(context: CanvasRenderingContext2D, shape: Shape): Array<[Handle, Point]> {
	if (shape.kind === "arrow") {
		return [
			["from", shape.from],
			["to", shape.to],
		];
	}
	const box = boundsOf(context, shape);
	return CORNERS.map((corner) => [corner, cornerOf(box, corner)]);
}

/**
 * The same mark, mapped from one box onto another.
 *
 * Every kind resizes by having its geometry carried across: the ends of a
 * rectangle, every point of a stroke. Text is the exception — scaling the box
 * scales the type, since a text mark is its font size and nothing else.
 */
function resized(shape: Shape, from: Box, to: Box): Shape {
	const spanX = from.right - from.left;
	const spanY = from.bottom - from.top;
	// A box with no extent has no scale to speak of; the mark is only moved.
	const scaleX = spanX === 0 ? 1 : (to.right - to.left) / spanX;
	const scaleY = spanY === 0 ? 1 : (to.bottom - to.top) / spanY;
	const map = (point: Point): Point => ({
		x: to.left + (point.x - from.left) * scaleX,
		y: to.top + (point.y - from.top) * scaleY,
	});

	if (shape.kind === "text") {
		return {
			...shape,
			at: map(shape.at),
			// Type scales by its height; a font has no separate width to set.
			size: Math.max(6, shape.size * Math.abs(scaleY)),
		};
	}
	if (shape.kind === "stroke") return { ...shape, points: shape.points.map(map) };
	return { ...shape, from: map(shape.from), to: map(shape.to) };
}

/** `shot.png` → `shot-annotated.png`, and marking up twice does not say it twice. */
function annotatedFilename(filename: string): string {
	const dot = filename.lastIndexOf(".");
	const base = dot > 0 ? filename.slice(0, dot) : filename;
	return `${base.endsWith("-annotated") ? base : `${base}-annotated`}.png`;
}

/**
 * How many editors are open, anywhere.
 *
 * The composer around this one keeps single-letter shortcuts on the document —
 * `s` for status, `l` for labels — and they would fire under a drawing tool.
 * A count rather than a boolean because every attachment grid mounts its own.
 */
const openEditors = signal(0);

/** True while an image is being marked up, for callers that must stand down. */
export const annotatingImage: Readable<boolean> = openEditors.bind((count) => count > 0);

export function ImageAnnotator(options: {
	open: Signal<boolean>;
	/** The image being marked up. */
	image: Signal<Attachment | null>;
	/** The marked-up copy, as a PNG, beside the attachment it was made from. */
	onSave: (original: Attachment, file: File) => void;
}) {
	const { open, image } = options;

	const tool = signal<AnnotationTool>("pen");
	const color = signal<string>(COLORS[0]);
	const weight = signal(1);
	const shapes = signal<Shape[]>([]);
	/**
	 * History as whole lists rather than as added marks.
	 *
	 * A stack of what was added can only undo an addition, and a mark can now be
	 * moved and deleted as well; a snapshot per edit undoes all three the same
	 * way. A drawing holds a few dozen small objects, so the copies are cheap.
	 */
	const past = signal<Shape[][]>([]);
	const future = signal<Shape[][]>([]);
	/** The marks the pointer is holding, by id — several, after a marquee. */
	const selected = signal<number[]>([]);
	/** What the pointer would do here, as a Tailwind cursor class. */
	const cursor = signal("cursor-crosshair");
	const ready = signal(false);
	const failed = signal(false);
	const saving = signal(false);
	const canvasRef = signal<HTMLCanvasElement | null>(null);
	const draft = signal<TextDraft | null>(null);
	const draftText = signal("");
	const draftInput = signal<HTMLInputElement | null>(null);

	// Drawing state proper: read and written many times per frame, and nothing
	// renders from it but the canvas, so it stays out of the signal graph.
	let source: HTMLImageElement | null = null;
	let unit = 1;
	let drawing: Shape | null = null;
	let ticket = 0;
	/** Whether this instance is the one currently counted as open. */
	let counted = false;
	/** The marks being dragged: where the pointer was, and the list to undo to. */
	let dragging: { ids: number[]; at: Point; before: Shape[]; moved: boolean } | null = null;
	/**
	 * The handle being pulled. The shape is resized from the one it was when the
	 * pull started rather than from the last frame, so a long drag cannot
	 * accumulate rounding, and back to where it began is exactly where it began.
	 */
	let resizing: {
		id: number;
		handle: Handle;
		origin: Shape;
		originBox: Box;
		before: Shape[];
		moved: boolean;
	} | null = null;
	/** The rubber band, while one is being pulled out. */
	let marquee: { from: Point; to: Point } | null = null;

	const strokeWidth = () => WEIGHTS[weight.get()]!.stroke * unit;
	const fontSize = () => WEIGHTS[weight.get()]!.font * unit;

	const paint = (context: CanvasRenderingContext2D, shape: Shape) => {
		context.save();
		context.lineCap = "round";
		context.lineJoin = "round";
		context.strokeStyle = shape.color;
		context.fillStyle = shape.color;

		if (shape.kind === "text") {
			context.font = `600 ${shape.size}px ui-sans-serif, system-ui, sans-serif`;
			context.textBaseline = "top";
			// A light halo, so a mark on a busy screenshot is readable whatever it
			// happens to land on.
			context.lineWidth = Math.max(2, shape.size / 8);
			context.strokeStyle = shape.color === "#111111" ? "#ffffff" : "#111111";
			context.globalAlpha = 0.55;
			context.strokeText(shape.text, shape.at.x, shape.at.y);
			context.globalAlpha = 1;
			context.fillText(shape.text, shape.at.x, shape.at.y);
			context.restore();
			return;
		}

		context.lineWidth = shape.width;

		if (shape.kind === "stroke") {
			if (shape.highlight) {
				context.globalAlpha = 0.35;
				context.lineWidth = shape.width * 3;
			}
			const [first, ...rest] = shape.points;
			if (first === undefined) {
				context.restore();
				return;
			}
			context.beginPath();
			context.moveTo(first.x, first.y);
			// A single tap still leaves a dot rather than nothing at all.
			if (rest.length === 0) context.lineTo(first.x, first.y);
			for (const point of rest) context.lineTo(point.x, point.y);
			context.stroke();
			context.restore();
			return;
		}

		const { from, to } = shape;

		if (shape.kind === "rect") {
			context.strokeRect(
				Math.min(from.x, to.x),
				Math.min(from.y, to.y),
				Math.abs(to.x - from.x),
				Math.abs(to.y - from.y),
			);
			context.restore();
			return;
		}

		if (shape.kind === "ellipse") {
			context.beginPath();
			context.ellipse(
				(from.x + to.x) / 2,
				(from.y + to.y) / 2,
				Math.abs(to.x - from.x) / 2,
				Math.abs(to.y - from.y) / 2,
				0,
				0,
				Math.PI * 2,
			);
			context.stroke();
			context.restore();
			return;
		}

		const length = Math.hypot(to.x - from.x, to.y - from.y);
		context.beginPath();
		context.moveTo(from.x, from.y);
		context.lineTo(to.x, to.y);
		context.stroke();
		if (length > 0) {
			// Never longer than the arrow itself: a short drag should read as a
			// small arrow, not as a head with a stub behind it.
			const head = Math.min(length / 2, Math.max(shape.width * 4, 12 * unit));
			const angle = Math.atan2(to.y - from.y, to.x - from.x);
			context.beginPath();
			context.moveTo(to.x, to.y);
			context.lineTo(to.x - head * Math.cos(angle - 0.4), to.y - head * Math.sin(angle - 0.4));
			context.moveTo(to.x, to.y);
			context.lineTo(to.x - head * Math.cos(angle + 0.4), to.y - head * Math.sin(angle + 0.4));
			context.stroke();
		}
		context.restore();
	};

	const SELECTION_COLOR = "#60a5fa";

	const dashedBox = (context: CanvasRenderingContext2D, box: Box, pad = 4 * unit) => {
		context.save();
		context.setLineDash([6 * unit, 4 * unit]);
		context.lineWidth = Math.max(1, 1.5 * unit);
		context.strokeStyle = SELECTION_COLOR;
		context.strokeRect(
			box.left - pad,
			box.top - pad,
			box.right - box.left + pad * 2,
			box.bottom - box.top + pad * 2,
		);
		context.restore();
	};

	/** How wide a handle is drawn, and how near counts as grabbing it. */
	const handleSize = () => 9 * unit;

	/**
	 * The dashed boxes, and the handles of a lone selection.
	 *
	 * Handles are only offered when one mark is selected: with several, the box
	 * says what would move, and resizing a heap of marks at once is a different
	 * gesture than this editor has room for.
	 */
	const paintSelection = (context: CanvasRenderingContext2D, list: Shape[]) => {
		const ids = new Set(selected.get());
		const held = list.filter((shape) => ids.has(shape.id));
		if (held.length === 0) return;

		for (const shape of held) dashedBox(context, boundsOf(context, shape));

		const only = held.length === 1 ? held[0] : undefined;
		if (only === undefined) return;

		const size = handleSize();
		context.save();
		context.lineWidth = Math.max(1, 1.5 * unit);
		context.strokeStyle = SELECTION_COLOR;
		context.fillStyle = "#ffffff";
		for (const [, point] of handlesOf(context, only)) {
			// Round for an arrow's ends, square for a corner — the shape of the
			// handle says which gesture it is.
			context.beginPath();
			if (only.kind === "arrow") {
				context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
			} else {
				context.rect(point.x - size / 2, point.y - size / 2, size, size);
			}
			context.fill();
			context.stroke();
		}
		context.restore();
	};

	/**
	 * `withSelection` is false for the one draw that becomes the PNG: the dashed
	 * box is a handle on this screen, not part of the picture.
	 */
	const redraw = (withSelection = true) => {
		const canvas = canvasRef.get();
		const context = canvas?.getContext("2d") ?? null;
		if (canvas === null || context === null || source === null) return;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(source, 0, 0, canvas.width, canvas.height);
		const list = shapes.get();
		for (const shape of list) paint(context, shape);
		if (drawing !== null) paint(context, drawing);
		if (!withSelection) return;
		paintSelection(context, list);
		if (marquee !== null) dashedBox(context, boxBetween(marquee.from, marquee.to), 0);
	};

	/** The topmost mark under a point, which is the one a click means. */
	const markAt = (at: Point): Shape | null => {
		const context = canvasRef.get()?.getContext("2d") ?? null;
		if (context === null) return null;
		const slack = 6 * unit;
		const list = shapes.get();
		for (let i = list.length - 1; i >= 0; i -= 1) {
			const shape = list[i]!;
			if (hits(context, shape, at, slack)) return shape;
		}
		return null;
	};

	/** The lone selected mark, when there is exactly one — what handles belong to. */
	const lone = (): Shape | null => {
		const ids = selected.get();
		if (ids.length !== 1) return null;
		return shapes.get().find((shape) => shape.id === ids[0]) ?? null;
	};

	/** The handle under a point, if the pointer is on one. */
	const handleAt = (at: Point): { shape: Shape; handle: Handle } | null => {
		const context = canvasRef.get()?.getContext("2d") ?? null;
		const shape = lone();
		if (context === null || shape === null) return null;
		const reach = handleSize();
		for (const [handle, point] of handlesOf(context, shape)) {
			if (Math.abs(at.x - point.x) <= reach && Math.abs(at.y - point.y) <= reach) {
				return { shape, handle };
			}
		}
		return null;
	};

	/** What each handle does, said in the shape of the pointer. */
	const HANDLE_CURSOR: Record<Handle, string> = {
		nw: "cursor-nwse-resize",
		se: "cursor-nwse-resize",
		ne: "cursor-nesw-resize",
		sw: "cursor-nesw-resize",
		from: "cursor-move",
		to: "cursor-move",
	};

	const updateCursor = (at: Point | null) => {
		const which = tool.get();
		if (which === "text") {
			cursor.set("cursor-text");
			return;
		}
		if (which !== "select") {
			cursor.set("cursor-crosshair");
			return;
		}
		if (at === null) {
			cursor.set("cursor-default");
			return;
		}
		const handle = handleAt(at);
		if (handle !== null) {
			cursor.set(HANDLE_CURSOR[handle.handle]);
			return;
		}
		cursor.set(markAt(at) === null ? "cursor-default" : "cursor-move");
	};

	/** The box a pull of `handle` makes, with the opposite corner staying put. */
	const boxFromHandle = (origin: Box, handle: Corner, at: Point): Box => {
		const opposite = cornerOf(origin, CORNERS[(CORNERS.indexOf(handle) + 2) % 4]!);
		const floor = 4 * unit;
		// Kept from collapsing to nothing, which a mark could not come back from.
		const x =
			Math.abs(at.x - opposite.x) < floor
				? opposite.x + Math.sign(at.x - opposite.x || 1) * floor
				: at.x;
		const y =
			Math.abs(at.y - opposite.y) < floor
				? opposite.y + Math.sign(at.y - opposite.y || 1) * floor
				: at.y;
		return boxBetween(opposite, { x, y });
	};

	const load = (attachment: Attachment) => {
		const mine = ++ticket;
		source = null;
		ready.set(false);
		failed.set(false);
		const element = new Image();
		element.addEventListener("load", () => {
			// A slow load for a picture the editor has since left must not land.
			if (mine !== ticket) return;
			source = element;
			unit = scaleUnit(element.naturalWidth, element.naturalHeight);
			const canvas = canvasRef.get();
			if (canvas !== null) {
				canvas.width = element.naturalWidth;
				canvas.height = element.naturalHeight;
			}
			ready.set(true);
			redraw();
		});
		element.addEventListener("error", () => {
			if (mine !== ticket) return;
			failed.set(true);
		});
		element.src = attachment.url;
	};

	/** Drops from the selection any mark the list no longer holds. */
	const reconcileSelection = (list: Shape[]) => {
		const ids = selected.get();
		if (ids.length === 0) return;
		const present = new Set(list.map((shape) => shape.id));
		const kept = ids.filter((id) => present.has(id));
		if (kept.length !== ids.length) selected.set(kept);
	};

	/** One edit: the list before it goes on the stack, and redo starts over. */
	const apply = (next: Shape[]) => {
		past.update((stack) => [...stack, shapes.get()]);
		// An edit is the end of the line the redo stack was holding.
		future.set([]);
		shapes.set(next);
		reconcileSelection(next);
	};

	const commit = (shape: Shape) => apply([...shapes.get(), shape]);

	const undo = () => {
		const stack = past.get();
		const previous = stack[stack.length - 1];
		if (previous === undefined) return;
		past.set(stack.slice(0, -1));
		future.update((stack) => [...stack, shapes.get()]);
		shapes.set(previous);
		reconcileSelection(previous);
	};

	const redo = () => {
		const stack = future.get();
		const next = stack[stack.length - 1];
		if (next === undefined) return;
		future.set(stack.slice(0, -1));
		past.update((stack) => [...stack, shapes.get()]);
		shapes.set(next);
		reconcileSelection(next);
	};

	const clear = () => {
		if (shapes.get().length === 0) return;
		apply([]);
	};

	const deleteSelected = () => {
		const ids = new Set(selected.get());
		if (ids.size === 0) return;
		apply(shapes.get().filter((shape) => !ids.has(shape.id)));
	};

	/** Places the text being typed, and says which mark it became. */
	const commitText = (): number | null => {
		const pending = draft.get();
		const text = draftText.get().trim();
		draft.set(null);
		draftText.set("");
		if (pending === null || text === "") return null;
		const id = (nextShapeId += 1);
		commit({
			kind: "text",
			id,
			color: color.get(),
			size: pending.size,
			at: pending.at,
			text,
		});
		return id;
	};

	const startText = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
		// A second click while typing places the first mark rather than losing it.
		commitText();
		const rect = canvas.getBoundingClientRect();
		const size = fontSize();
		const at = toImage(canvas, clientX, clientY);
		// Text hangs down and to the right of where it is placed, so a click along
		// the bottom edge would write off the picture. Lifted back onto it instead,
		// which is what clicking there meant.
		const top = Math.min(at.y, Math.max(0, canvas.height - size * 1.3));
		const scale = rect.width / canvas.width;
		draft.set({
			at: { x: at.x, y: top },
			left: clientX - rect.left,
			top: (top / canvas.height) * rect.height,
			scale,
			size,
		});
		draftText.set("");
		requestAnimationFrame(() => draftInput.get()?.focus());
	};

	const begin = (canvas: HTMLCanvasElement, event: PointerEvent) => {
		if (!ready.get()) return;
		// Right and middle buttons are not drawing gestures.
		if (event.button !== 0) return;
		const at = toImage(canvas, event.clientX, event.clientY);
		const which = tool.get();

		if (which === "text") {
			startText(canvas, event.clientX, event.clientY);
			return;
		}
		// A stroke started elsewhere on the picture ends the text being typed.
		commitText();

		if (which === "select") {
			// A handle first: it sits on top of the mark it belongs to, and
			// pulling it is a different gesture from moving the mark.
			const grabbed = handleAt(at);
			if (grabbed !== null) {
				canvas.setPointerCapture(event.pointerId);
				const context = canvas.getContext("2d");
				resizing = {
					id: grabbed.shape.id,
					handle: grabbed.handle,
					origin: grabbed.shape,
					originBox: context === null ? boxBetween(at, at) : boundsOf(context, grabbed.shape),
					before: shapes.get(),
					moved: false,
				};
				redraw();
				return;
			}

			const held = markAt(at);

			if (held === null) {
				// Empty picture: pull a rubber band out and take whatever it covers.
				canvas.setPointerCapture(event.pointerId);
				marquee = { from: at, to: at };
				if (!event.shiftKey) selected.set([]);
				redraw();
				return;
			}

			const ids = selected.get();
			// Shift adds to the selection rather than replacing it; a plain click
			// on something already held keeps the group, so a drag moves it whole.
			const next = event.shiftKey
				? ids.includes(held.id)
					? ids.filter((id) => id !== held.id)
					: [...ids, held.id]
				: ids.includes(held.id)
					? ids
					: [held.id];
			selected.set(next);

			if (next.includes(held.id)) {
				canvas.setPointerCapture(event.pointerId);
				// The list as it stands is what an undo of this drag goes back to,
				// kept aside until the drag turns out to have moved anything.
				dragging = { ids: next, at, before: shapes.get(), moved: false };
			}
			redraw();
			return;
		}

		canvas.setPointerCapture(event.pointerId);
		drawing =
			which === "pen" || which === "highlighter"
				? {
						kind: "stroke",
						id: (nextShapeId += 1),
						highlight: which === "highlighter",
						color: color.get(),
						width: strokeWidth(),
						points: [at],
					}
				: {
						kind: which,
						id: (nextShapeId += 1),
						color: color.get(),
						width: strokeWidth(),
						from: at,
						to: at,
					};
		redraw();
	};

	const extend = (canvas: HTMLCanvasElement, event: PointerEvent) => {
		const at = toImage(canvas, event.clientX, event.clientY);

		if (resizing !== null) {
			const pull = resizing;
			pull.moved = true;
			const next =
				pull.handle === "from" || pull.handle === "to"
					? // An arrow is pulled by an end, which is simply put where the
						// pointer is: no box, no scaling, just that end.
						pull.origin.kind === "arrow"
						? { ...pull.origin, [pull.handle]: at }
						: pull.origin
					: resized(pull.origin, pull.originBox, boxFromHandle(pull.originBox, pull.handle, at));
			shapes.set(shapes.get().map((shape) => (shape.id === pull.id ? next : shape)));
			redraw();
			return;
		}

		if (marquee !== null) {
			marquee.to = at;
			redraw();
			return;
		}

		if (dragging !== null) {
			const drag = dragging;
			const dx = at.x - drag.at.x;
			const dy = at.y - drag.at.y;
			if (dx === 0 && dy === 0) return;
			drag.at = at;
			drag.moved = true;
			const ids = new Set(drag.ids);
			// Moved live, without touching history: the whole drag is one edit,
			// pushed when it ends.
			shapes.set(shapes.get().map((shape) => (ids.has(shape.id) ? moved(shape, dx, dy) : shape)));
			redraw();
			return;
		}

		if (drawing === null) {
			// Nothing in hand: the cursor still has to say what a press would do.
			updateCursor(at);
			return;
		}

		if (drawing.kind === "stroke") drawing.points.push(at);
		else if (drawing.kind !== "text") drawing.to = at;
		redraw();
	};

	/** One edit, from a list kept aside before the gesture started. */
	const commitGesture = (before: Shape[]) => {
		past.update((stack) => [...stack, before]);
		future.set([]);
	};

	const finish = () => {
		if (resizing !== null) {
			const pull = resizing;
			resizing = null;
			if (pull.moved) commitGesture(pull.before);
			return;
		}

		if (marquee !== null) {
			const band = boxBetween(marquee.from, marquee.to);
			const context = canvasRef.get()?.getContext("2d") ?? null;
			marquee = null;
			// A band of no size is a click on the picture, which selects nothing.
			if (context !== null && band.right - band.left > unit && band.bottom - band.top > unit) {
				const caught = shapes
					.get()
					.filter((shape) => boxesOverlap(boundsOf(context, shape), band))
					.map((shape) => shape.id);
				selected.update((ids) => [...new Set([...ids, ...caught])]);
			}
			redraw();
			return;
		}

		if (dragging !== null) {
			const drag = dragging;
			dragging = null;
			// A press that picked a mark up and put it back down is a selection,
			// not an edit, so it leaves nothing to undo.
			if (drag.moved) commitGesture(drag.before);
			return;
		}

		const shape = drawing;
		drawing = null;
		if (shape === null) return;
		// A click that never moved is a stray click for everything but the pen,
		// which draws its dot.
		if (shape.kind !== "stroke" && shape.kind !== "text") {
			const travelled = Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y);
			if (travelled < unit * 4) {
				redraw();
				return;
			}
		}
		commit(shape);
		// A shape you just drew is the one you are most likely to want to nudge,
		// so the pointer takes over holding it — Excalidraw's habit. The pen and
		// the highlighter stay put: those are used in strokes, not one at a time.
		if (shape.kind !== "stroke") handOver(shape.id);
	};

	/** Back to the pointer, holding the mark that was just made. */
	const handOver = (id: number) => {
		tool.set("select");
		selected.set([id]);
		cursor.set("cursor-move");
		redraw();
	};

	/** Switching tools puts down whatever the last one was holding. */
	const pickTool = (value: AnnotationTool) => {
		commitText();
		tool.set(value);
		// The dashed box belongs to the pointer; another tool has no use for it.
		if (value !== "select") selected.set([]);
		updateCursor(null);
		redraw();
	};

	const save = () => {
		const canvas = canvasRef.get();
		const original = image.get();
		if (canvas === null || original === null || !ready.get()) return;
		commitText();
		saving.set(true);
		// The text just committed is drawn by the effect on `shapes`, which has
		// already run by the time this frame is over — but `toBlob` reads the
		// bitmap now, so paint it here rather than trusting the ordering. Without
		// the selection box: it is a handle, not part of the picture.
		redraw(false);
		canvas.toBlob((blob) => {
			saving.set(false);
			if (blob === null) {
				toastError("Could not save the markup");
				return;
			}
			options.onSave(
				original,
				new File([blob], annotatedFilename(original.filename), { type: "image/png" }),
			);
			open.set(false);
		}, "image/png");
	};

	const dirty = shapes.bind((list) => list.length > 0);

	return Dialog(
		{ open },

		ImplementEffect([open, image], (isOpen, attachment) => {
			if (!isOpen || attachment === null) {
				ticket += 1;
				source = null;
				drawing = null;
				dragging = null;
				return;
			}
			shapes.set([]);
			past.set([]);
			future.set([]);
			selected.set([]);
			resizing = null;
			marquee = null;
			updateCursor(null);
			draft.set(null);
			draftText.set("");
			load(attachment);
		}),

		// Held while the editor is up so the composer behind it leaves the
		// keyboard alone; released on close, and on unmount with it. Counted
		// against what this instance last reported rather than against the
		// signal, so a grid mounting closed cannot cancel another one's claim.
		ImplementEffect([open], (isOpen) => {
			if (isOpen === counted) return;
			counted = isOpen;
			openEditors.update((count) => Math.max(0, count + (isOpen ? 1 : -1)));
		}),
		ImplementLifecycle({
			onMount: () => () => {
				if (!counted) return;
				counted = false;
				openEditors.update((count) => Math.max(0, count - 1));
			},
		}),

		// The canvas can mount after the image has loaded, and a shape can be
		// added or taken back at any time; either way what is on screen is the
		// image plus the current list.
		ImplementEffect([canvasRef, ready, shapes], (canvas, isReady) => {
			if (canvas === null || !isReady || source === null) return;
			canvas.width = source.naturalWidth;
			canvas.height = source.naturalHeight;
			redraw();
		}),

		If(
			open,
			ImplementDocument({
				onKeydown: (event) => {
					// A mark being typed owns the keyboard, ⌘Z included — that undo
					// belongs to the text box.
					if (isTyping(event)) return;

					if (event.metaKey || event.ctrlKey) {
						if (event.key.toLowerCase() !== "z") return;
						event.preventDefault();
						if (event.shiftKey) redo();
						else undo();
						return;
					}
					if (event.altKey) return;

					if (event.key === "Delete" || event.key === "Backspace") {
						if (selected.get().length === 0) return;
						event.preventDefault();
						deleteSelected();
						return;
					}

					// A tool by its place on the bar, or by its own letter.
					const key = event.key.toLowerCase();
					const digit = Number.parseInt(key, 10);
					const picked =
						TOOLS[digit - 1] ?? TOOLS.find((entry) => entry.key === key && key.length === 1);
					if (picked === undefined) return;
					event.preventDefault();
					pickTool(picked.value);
				},
			}),
		),

		DialogContent(
			{
				// Nested inside the composer, which scales its children down; a
				// drawing surface wants the room instead.
				//
				// On a phone it takes the whole screen rather than a panel sized to
				// its own content: the toolbar wraps to three rows there, and a
				// content-sized panel came out taller than the viewport — with the
				// title clipped off the top and Save off the bottom. Full-screen, the
				// chrome always fits and the picture takes whatever is left.
				class: cn(
					"flex flex-col gap-0 overflow-hidden p-0 data-[state=open]:flex data-[state=open]:scale-100",
					"max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0",
					"md:w-[min(96vw,72rem)] md:max-w-[min(96vw,72rem)]",
				),
				showCloseButton: false,
				overlay: { class: "bg-black/80 data-[nested]:bg-black/80" },
			},

			Div(
				{ class: "flex items-center gap-2 border-b border-border px-3 py-2" },
				DialogTitle({ class: "text-[13px] leading-none font-medium" }, "Markup"),
				Span(
					{ class: "min-w-0 flex-1 truncate text-[12px] text-muted-foreground" },
					image.bind((attachment) => attachment?.filename ?? ""),
				),
				Button(
					{
						variant: "ghost",
						size: "icon-sm",
						class: "size-7 shrink-0",
						"aria-label": "Close",
						title: "Close",
						onClick: () => open.set(false),
					},
					X({ class: "size-4", "aria-hidden": true }),
				),
			),

			Div(
				{ class: "flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2" },

				Div(
					{ class: "flex items-center gap-0.5 rounded-md border border-border p-0.5" },
					...TOOLS.map((entry, index) =>
						Button(
							{
								variant: "ghost",
								size: "icon-sm",
								class: tool.bind((current) =>
									cn(
										"relative size-7",
										current === entry.value && "bg-accent text-accent-foreground",
									),
								),
								title: `${entry.label} — ${index + 1} or ${entry.key.toUpperCase()}`,
								"aria-label": entry.label,
								"aria-keyshortcuts": `${index + 1} ${entry.key}`,
								"aria-pressed": tool.bind((current) => current === entry.value),
								onClick: () => pickTool(entry.value),
							},
							entry.icon({ class: "size-3.5" }),
							// The number that presses this button, the way Excalidraw
							// wears it. Only where there is a keyboard to press it with.
							Span(
								{
									class:
										"pointer-events-none absolute right-0.5 bottom-0 hidden text-[8px] leading-none opacity-60 md:block",
								},
								`${index + 1}`,
							),
						),
					),
				),

				Div(
					{ class: "flex items-center gap-1 rounded-md border border-border px-1.5 py-1" },
					...COLORS.map((swatch) =>
						Button(
							{
								variant: "ghost",
								size: "icon-xs",
								class: "size-5 hover:bg-transparent",
								title: `Draw in ${swatch}`,
								"aria-label": `Draw in ${swatch}`,
								"aria-pressed": color.bind((current) => current === swatch),
								onClick: () => color.set(swatch),
							},
							Div({
								class: color.bind((current) =>
									cn(
										"size-4 rounded-full border border-black/10",
										current === swatch && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
									),
								),
								style: { backgroundColor: swatch },
							}),
						),
					),
				),

				Div(
					{ class: "flex items-center gap-0.5 rounded-md border border-border p-0.5" },
					...WEIGHTS.map((entry, index) =>
						Button(
							{
								variant: "ghost",
								size: "icon-sm",
								class: weight.bind((current) =>
									cn("size-7", current === index && "bg-accent text-accent-foreground"),
								),
								title: `${entry.label} stroke`,
								"aria-label": `${entry.label} stroke`,
								"aria-pressed": weight.bind((current) => current === index),
								onClick: () => weight.set(index),
							},
							Div({ class: cn("rounded-full bg-current", entry.dot) }),
						),
					),
				),

				Div({ class: "flex-1" }),

				Button(
					{
						variant: "ghost",
						size: "icon-sm",
						class: "size-7",
						title: "Undo (⌘Z)",
						"aria-label": "Undo",
						"aria-keyshortcuts": "Meta+Z",
						disabled: past.bind((stack) => stack.length === 0),
						onClick: undo,
					},
					Undo2({ class: "size-3.5" }),
				),
				Button(
					{
						variant: "ghost",
						size: "icon-sm",
						class: "size-7",
						title: "Redo (⇧⌘Z)",
						"aria-label": "Redo",
						"aria-keyshortcuts": "Shift+Meta+Z",
						disabled: future.bind((stack) => stack.length === 0),
						onClick: redo,
					},
					Redo2({ class: "size-3.5" }),
				),
				Button(
					{
						variant: "ghost",
						size: "sm",
						class: "h-7 gap-1.5 px-2 text-muted-foreground",
						title: "Remove every mark",
						disabled: shapes.bind((list) => list.length === 0),
						onClick: clear,
					},
					Trash2({ class: "size-3.5" }),
					Span({ class: "text-[12px]" }, "Clear"),
				),
			),

			Div(
				{
					// Full-screen (below `md`) the panel owns the height, so the picture
					// takes whatever the chrome does not; wider than that it asks for a
					// slice of the viewport and the panel sizes itself to it.
					class: cn(
						"flex items-center justify-center overflow-auto bg-black p-2",
						"max-md:min-h-0 max-md:flex-1",
						"md:h-[min(70dvh,calc(100dvh-14rem))]",
					),
				},

				If(failed)
					.Then(
						Span(
							{ class: "text-[13px] text-muted-foreground" },
							"That image could not be loaded for markup.",
						),
					)
					.Else(
						// Shrink-wraps the canvas, so the text box can be placed against
						// the picture's own box rather than the room around it.
						Div(
							{ class: "relative flex max-h-full max-w-full" },
							Canvas({
								this: canvasRef,
								// `touch-none` so a drag draws instead of panning the page.
								class: cn(
									"max-h-full max-w-full touch-none object-contain",
									// The pointer says what a press would do here: draw, pick a
									// mark up, or pull the handle it is over.
									cursor,
								),
								onPointerdown: (event) => begin(event.currentTarget, event),
								onPointermove: (event) => extend(event.currentTarget, event),
								onPointerup: finish,
								onPointercancel: finish,
								onPointerleave: (event) => {
									// Capture keeps the events coming, so leaving the canvas
									// mid-stroke is only the end of one without it.
									if (!event.currentTarget.hasPointerCapture(event.pointerId)) finish();
								},
							}),
							// Rebuilt per placement: where the box sits and how big its text
							// is are decided when it is placed, not bound afterwards.
							Dynamic([draft, color], (pending, tint) =>
								pending === null
									? null
									: Input({
											this: draftInput,
											value: draftText,
											placeholder: "Type…",
											class:
												"absolute z-10 min-w-40 rounded-sm border border-dashed border-white/60 bg-black/40 px-1 py-0 font-semibold outline-none placeholder:text-white/50",
											style: {
												left: `${pending.left}px`,
												top: `${pending.top}px`,
												color: tint,
												// The box shows the size the mark will be, but never below
												// 16px: under that, tapping into a field zooms the whole
												// page on iOS and the picture goes with it (ENG-67).
												fontSize: `${Math.max(16, pending.size * pending.scale)}px`,
												lineHeight: "1.2",
											},
											onKeydown: (event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													// Finished deliberately, so the pointer takes it — the
													// same hand-over a drawn shape gets. A commit that
													// happens as a side effect of something else (picking
													// another tool, saving) leaves the tool alone.
													const id = commitText();
													if (id !== null) handOver(id);
													return;
												}
												if (event.key === "Escape") {
													// The editor stays up; only the mark being typed goes.
													event.preventDefault();
													event.stopPropagation();
													draft.set(null);
													draftText.set("");
												}
											},
											onBlur: () => commitText(),
										}),
							),
						),
					),
			),

			DialogDescription(
				{ class: "sr-only" },
				"Draw on the image with a pen, shapes, arrows, or text, then save it back to the issue.",
			),

			Div(
				{
					class: "flex items-center justify-end gap-2 border-t border-border px-3 py-2.5",
				},
				Span(
					// Hidden on a phone, where it wraps to two lines and takes them
					// off the picture — the buttons beside it say the same thing.
					{ class: "mr-auto hidden text-[11px] text-muted-foreground md:block" },
					"Saving replaces the picture with the marked-up copy.",
				),
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						loading: saving,
						disabled: derived([ready, dirty], (isReady, hasMarks) => !isReady || !hasMarks),
						onClick: save,
					},
					"Save",
				),
			),
		),
	);
}
