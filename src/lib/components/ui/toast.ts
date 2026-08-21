import {
	Div,
	ForEach,
	If,
	Span,
	type Child,
	type ComponentProps,
	type Readable,
} from "@implementjs/core";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	InfoIcon,
	LoaderCircleIcon,
	XIcon,
} from "@implementjs/lucide";
import {
	createToastManager,
	Toast as ToastPrimitive,
	ToastAction as ToastActionPrimitive,
	ToastClose as ToastClosePrimitive,
	ToastDescription as ToastDescriptionPrimitive,
	ToastPortal as ToastPortalPrimitive,
	ToastProvider as ToastProviderPrimitive,
	ToastTitle as ToastTitlePrimitive,
	ToastViewport as ToastViewportPrimitive,
	type ToastData,
	type ToastManager,
} from "@implementjs/primitives";
import { buttonVariants } from "./button";
import { cn } from "../../utils";
import { createComponent } from "@implementjs/primitives";

export { createToastManager, type ToastData, type ToastManager };

export type ToastProviderProps = ComponentProps<typeof ToastProviderPrimitive>;
export type ToastViewportProps = ComponentProps<typeof ToastViewportPrimitive>;
export type ToastRootProps = ComponentProps<typeof ToastPrimitive>;
export type ToastTitleProps = ComponentProps<typeof ToastTitlePrimitive>;
export type ToastDescriptionProps = ComponentProps<typeof ToastDescriptionPrimitive>;
export type ToastActionProps = ComponentProps<typeof ToastActionPrimitive>;
export type ToastCloseProps = ComponentProps<typeof ToastClosePrimitive>;

export const ToastProvider = ToastProviderPrimitive;
export const ToastPortal = ToastPortalPrimitive;

export const ToastViewport = createComponent(function ToastViewport(
	{ class: className, ...props }: ToastViewportProps,
	...children: Child[]
) {
	return ToastViewportPrimitive(
		{
			...props,
			"data-slot": "toast-viewport",
			class: cn(
				"fixed right-6 bottom-6 z-50 w-[360px] max-w-[calc(100vw-3rem)] outline-none",
				className,
			),
		},
		...children,
	);
});

export const Toast = createComponent(function Toast(
	{ class: className, ...props }: ToastRootProps,
	...children: Child[]
) {
	return ToastPrimitive(
		{
			...props,
			"data-slot": "toast",
			class: cn(
				"absolute right-0 bottom-0 w-full touch-none rounded-lg border bg-background p-4 text-foreground shadow-lg outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"z-[calc(100-var(--toast-index))]",
				// One transform for every state — the states only swap the variables it
				// reads, so the transitions never fight over the property itself.
				"[transform:translate3d(calc(var(--toast-swipe-movement-x)+var(--toast-exit-x)),calc(var(--toast-swipe-movement-y)+var(--toast-shift)+var(--toast-exit-y)),0)_scale(var(--toast-scale))]",
				"[--toast-exit-x:0px] [--toast-exit-y:0px]",
				// collapsed stack: peek out behind the front toast, slightly scaled down
				"[--toast-shift:calc(var(--toast-index)*-1rem)] [--toast-scale:calc(1-var(--toast-index)*0.06)]",
				// expanded stack: fan out by real heights
				"data-expanded:[--toast-scale:1] data-expanded:[--toast-shift:calc(var(--toast-offset-y)*-1)]",
				"transition-[transform,opacity] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
				// enter: rise in from below the stack
				"starting:data-[state=open]:opacity-0 starting:data-[state=open]:[--toast-exit-y:calc(100%+1.5rem)]",
				// exit: fade while sinking, or keep travelling in the swiped direction
				"data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in",
				"data-[state=closed]:[--toast-exit-y:1rem]",
				"data-[state=closed]:data-[swipe-direction=right]:[--toast-exit-x:calc(100%+1.5rem)] data-[state=closed]:data-[swipe-direction=right]:[--toast-exit-y:0px]",
				"data-[state=closed]:data-[swipe-direction=left]:[--toast-exit-x:calc(-100%-1.5rem)] data-[state=closed]:data-[swipe-direction=left]:[--toast-exit-y:0px]",
				"data-[state=closed]:data-[swipe-direction=down]:[--toast-exit-y:calc(100%+1.5rem)]",
				"data-[state=closed]:data-[swipe-direction=up]:[--toast-exit-y:calc(-100%-1.5rem)]",
				// the drag itself is 1:1, not eased
				"data-swiping:transition-none",
				// toasts past the limit wait invisibly for a slot
				"data-limited:pointer-events-none data-limited:opacity-0",
				className,
			),
		},
		...children,
	);
});

export const ToastTitle = createComponent(function ToastTitle(
	{ class: className, ...props }: ToastTitleProps,
	...children: Child[]
) {
	return ToastTitlePrimitive(
		{
			...props,
			"data-slot": "toast-title",
			class: cn("text-sm leading-tight font-medium", className),
		},
		...children,
	);
});

export const ToastDescription = createComponent(function ToastDescription(
	{ class: className, ...props }: ToastDescriptionProps,
	...children: Child[]
) {
	return ToastDescriptionPrimitive(
		{
			...props,
			"data-slot": "toast-description",
			class: cn("text-sm leading-snug text-muted-foreground", className),
		},
		...children,
	);
});

export const ToastAction = createComponent(function ToastAction(
	{ class: className, ...props }: ToastActionProps,
	...children: Child[]
) {
	return ToastActionPrimitive(
		{
			...props,
			"data-slot": "toast-action",
			class: cn(buttonVariants({ variant: "outline", size: "xs" }), "ml-auto shrink-0", className),
		},
		...children,
	);
});

export const ToastClose = createComponent(function ToastClose(
	{ class: className, ...props }: ToastCloseProps,
	...children: Child[]
) {
	return ToastClosePrimitive(
		{
			...props,
			"data-slot": "toast-close",
			class: cn(
				buttonVariants({ variant: "ghost", size: "icon-xs" }),
				"absolute top-2 right-2 text-muted-foreground hover:text-foreground",
				className,
			),
		},
		...children,
		XIcon({ class: "size-3.5", "aria-hidden": true }),
		Span({ class: "sr-only" }, "Close"),
	);
});

/** The `data` shape the ready-made `Toaster` understands. */
export type ToasterToastData = {
	action?: { label: string; onClick: () => void };
};

/**
 * A ready-made stack: provider, portal, viewport, and a styled toast for every
 * entry in the manager. Mount it once and call `manager.add(...)` from anywhere.
 */
export function Toaster({ manager, ...props }: ToastProviderProps & { manager: ToastManager }) {
	return ToastProvider(
		{ manager, ...props },
		ToastPortal(
			ToastViewport(
				{},
				ForEach(
					manager.toasts,
					(t) => t.id,
					(toast) =>
						Toast(
							{ toast },
							Div(
								{ class: "flex items-start gap-3 pr-6" },
								ToastIcon(toast),
								Div(
									{ class: "grid flex-1 gap-1" },
									ToastTitle(
										{},
										toast.bind((t) => t.title ?? ""),
									),
									If(toast.bind((t) => t.description !== undefined)).Then(
										ToastDescription(
											{},
											toast.bind((t) => t.description ?? ""),
										),
									),
								),
								If(toast.bind((t) => actionOf(t) !== undefined)).Then(
									ToastAction(
										{ onClick: () => actionOf(toast.get())?.onClick() },
										toast.bind((t) => actionOf(t)?.label ?? ""),
									),
								),
							),
							ToastClose({}),
						),
				),
			),
		),
	);
}

function actionOf(toast: ToastData): ToasterToastData["action"] {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Toast action lives on optional extended toast data.
	const data = toast.data as ToasterToastData | undefined;
	return data?.action;
}

function ToastIcon(toast: Readable<ToastData>) {
	return Span(
		{ class: "mt-0.5 shrink-0 empty:hidden", "aria-hidden": true },
		If(toast.bind((t) => t.type === "success")).Then(
			CircleCheckIcon({ class: "size-4 text-green-600 dark:text-green-400" }),
		),
		If(toast.bind((t) => t.type === "error")).Then(
			CircleAlertIcon({ class: "size-4 text-destructive" }),
		),
		If(toast.bind((t) => t.type === "info")).Then(
			InfoIcon({ class: "size-4 text-blue-600 dark:text-blue-400" }),
		),
		If(toast.bind((t) => t.type === "loading")).Then(
			LoaderCircleIcon({ class: "size-4 animate-spin text-muted-foreground" }),
		),
	);
}
