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
	Pen,
	Square,
	Trash2,
	Type,
	Undo2,
	X,
	type IconComponent,
} from "@implementjs/lucide";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import type { Attachment } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

type AnnotationTool = "pen" | "highlighter" | "arrow" | "rect" | "ellipse" | "text";

interface Point {
	x: number;
	y: number;
}

type Shape =
	| { kind: "stroke"; highlight: boolean; color: string; width: number; points: Point[] }
	| { kind: "arrow" | "rect" | "ellipse"; color: string; width: number; from: Point; to: Point }
	| { kind: "text"; color: string; size: number; at: Point; text: string };

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

const TOOLS: Array<{ value: AnnotationTool; label: string; icon: IconComponent }> = [
	{ value: "pen", label: "Pen", icon: Pen },
	{ value: "highlighter", label: "Highlighter", icon: Highlighter },
	{ value: "arrow", label: "Arrow", icon: ArrowUpRight },
	{ value: "rect", label: "Rectangle", icon: Square },
	{ value: "ellipse", label: "Ellipse", icon: Circle },
	{ value: "text", label: "Text", icon: Type },
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
	const undone = signal<Shape[]>([]);
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

	const redraw = () => {
		const canvas = canvasRef.get();
		const context = canvas?.getContext("2d") ?? null;
		if (canvas === null || context === null || source === null) return;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(source, 0, 0, canvas.width, canvas.height);
		for (const shape of shapes.get()) paint(context, shape);
		if (drawing !== null) paint(context, drawing);
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

	const commit = (shape: Shape) => {
		shapes.push(shape);
		// A new mark is the end of the line the redo stack was holding.
		undone.set([]);
	};

	const undo = () => {
		const list = shapes.get();
		const last = list[list.length - 1];
		if (last === undefined) return;
		shapes.set(list.slice(0, -1));
		undone.push(last);
	};

	const redo = () => {
		const list = undone.get();
		const last = list[list.length - 1];
		if (last === undefined) return;
		undone.set(list.slice(0, -1));
		shapes.push(last);
	};

	const clear = () => {
		if (shapes.get().length === 0) return;
		undone.set([]);
		shapes.set([]);
	};

	const commitText = () => {
		const pending = draft.get();
		const text = draftText.get().trim();
		draft.set(null);
		draftText.set("");
		if (pending === null || text === "") return;
		commit({ kind: "text", color: color.get(), size: pending.size, at: pending.at, text });
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

		canvas.setPointerCapture(event.pointerId);
		drawing =
			which === "pen" || which === "highlighter"
				? {
						kind: "stroke",
						highlight: which === "highlighter",
						color: color.get(),
						width: strokeWidth(),
						points: [at],
					}
				: { kind: which, color: color.get(), width: strokeWidth(), from: at, to: at };
		redraw();
	};

	const extend = (canvas: HTMLCanvasElement, event: PointerEvent) => {
		if (drawing === null) return;
		const at = toImage(canvas, event.clientX, event.clientY);
		if (drawing.kind === "stroke") drawing.points.push(at);
		else if (drawing.kind !== "text") drawing.to = at;
		redraw();
	};

	const finish = () => {
		const shape = drawing;
		drawing = null;
		if (shape === null) return;
		// A click that never moved is a stray click for everything but the pen,
		// which draws its dot.
		if (shape.kind !== "stroke" && shape.kind !== "text") {
			const moved = Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y);
			if (moved < unit * 4) {
				redraw();
				return;
			}
		}
		commit(shape);
	};

	const save = () => {
		const canvas = canvasRef.get();
		const original = image.get();
		if (canvas === null || original === null || !ready.get()) return;
		commitText();
		saving.set(true);
		// The text just committed is drawn by the effect on `shapes`, which has
		// already run by the time this frame is over — but `toBlob` reads the
		// bitmap now, so paint it here rather than trusting the ordering.
		redraw();
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
				return;
			}
			shapes.set([]);
			undone.set([]);
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
					if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
					event.preventDefault();
					if (event.shiftKey) redo();
					else undo();
				},
			}),
		),

		DialogContent(
			{
				// Nested inside the composer, which scales its children down; a
				// drawing surface wants the room instead.
				class:
					"flex w-[min(96vw,72rem)] max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)] data-[state=open]:flex data-[state=open]:scale-100",
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
					...TOOLS.map((entry) =>
						Button(
							{
								variant: "ghost",
								size: "icon-sm",
								class: tool.bind((current) =>
									cn("size-7", current === entry.value && "bg-accent text-accent-foreground"),
								),
								title: entry.label,
								"aria-label": entry.label,
								"aria-pressed": tool.bind((current) => current === entry.value),
								onClick: () => {
									commitText();
									tool.set(entry.value);
								},
							},
							entry.icon({ class: "size-3.5" }),
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
						disabled: shapes.bind((list) => list.length === 0),
						onClick: undo,
					},
					Undo2({ class: "size-3.5" }),
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
					class:
						"flex h-[min(70dvh,calc(100dvh-14rem))] items-center justify-center overflow-auto bg-black p-2",
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
									tool.bind((current) => (current === "text" ? "cursor-text" : "cursor-crosshair")),
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
												fontSize: `${Math.max(11, pending.size * pending.scale)}px`,
												lineHeight: "1.2",
											},
											onKeydown: (event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													commitText();
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
					{ class: "mr-auto text-[11px] text-muted-foreground" },
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
