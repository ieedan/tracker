import {
	derived,
	If,
	isReadable,
	signal,
	Button as ButtonPrimitive,
	type Bindable,
	type Child,
	type ElementProps,
	type Mountable,
	type Readable,
} from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { Spinner } from "./spinner";
import { cn } from "@/lib/utils";

export const buttonVariants = tv({
	base: "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground hover:bg-primary/90",
			destructive:
				"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
			outline:
				"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
			secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
			ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
			link: "text-primary underline-offset-4 hover:underline",
		},
		size: {
			default: "h-9 px-4 py-2 has-[>svg]:px-3",
			xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
			sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
			lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
			icon: "size-9",
			"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
			"icon-sm": "size-8",
			"icon-lg": "size-10",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

/** The click handler an element takes, with `this` and the event typed for a button. */
type ButtonClickHandler = Extract<
	NonNullable<ElementProps<"button">["onClick"]>,
	(...args: never[]) => unknown
>;

/**
 * A click handler whose returned promise drives the button's loading state.
 * Return anything else and the button never enters it.
 */
export type ButtonClickPromiseHandler = (
	this: ThisParameterType<ButtonClickHandler>,
	event: Parameters<ButtonClickHandler>[0],
) => unknown;

export type ButtonProps = ElementProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		/**
		 * Show a spinner and stop accepting clicks. Pass a signal to drive it
		 * from outside, or leave it to `onClickPromise`.
		 */
		loading?: Bindable<boolean>;
		/**
		 * Click handler that is awaited: the button loads until the promise it
		 * returns settles. `onClick` still runs first when both are passed.
		 */
		onClickPromise?: ButtonClickPromiseHandler;
	};

/** True while any of its inputs is — a plain boolean when none of them is reactive. */
function anyTrue(...values: Array<Bindable<boolean | undefined>>): boolean | Readable<boolean> {
	const readables: Array<Readable<unknown>> = [];
	for (const value of values) {
		// A fixed `true` settles it, whatever the others do later.
		if (!isReadable(value)) {
			if (value) return true;
			continue;
		}
		readables.push(value);
	}
	// Nothing reactive left, so the answer is a plain boolean the element
	// writes once instead of subscribing to.
	if (readables.length === 0) return false;
	return derived(readables, (...resolved) => resolved.some(Boolean));
}

/** `true` while the value holds and `undefined` otherwise, so the attribute is absent when it does not. */
function flag(value: boolean | Readable<boolean>): Bindable<true | undefined> {
	if (!isReadable(value)) return value || undefined;
	return derived([value], (current) => current || undefined);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}

export const Button = createComponent(function Button(
	{
		variant = "default",
		size = "default",
		class: className,
		type = "button",
		loading = false,
		disabled = false,
		onClick,
		onClickPromise,
		...props
	}: ButtonProps,
	...children: Child[]
): Mountable {
	// Only the promise handler can flip a state of its own; without one the
	// `loading` prop is the whole story and there is nothing to allocate.
	const pending = onClickPromise ? signal(false) : undefined;
	const isLoading = pending ? anyTrue(loading, pending) : anyTrue(loading);

	const handleClick: Bindable<ButtonClickHandler> | undefined = onClickPromise
		? function (this: ThisParameterType<ButtonClickHandler>, event) {
				// `onClick` is a plain function almost always; a bound one is read
				// at click time so the latest value is the one that runs.
				const click = isReadable<ButtonClickHandler | undefined>(onClick) ? onClick.get() : onClick;
				if (typeof click === "function") click.call(this, event);

				// A click that lands while one is already in flight — the button is
				// disabled by then, but a programmatic `.click()` still gets here.
				if (pending?.get()) return;

				const result: unknown = onClickPromise.call(this, event);
				if (!isThenable(result)) return;

				pending?.set(true);
				// `finally` leaves a rejection to reach the caller's own handling,
				// or the console, exactly as an unawaited promise would.
				void Promise.resolve(result).finally(() => pending?.set(false));
			}
		: onClick;

	// An icon button is one square with no room beside its icon, so the spinner
	// takes the icon's place rather than crowding in next to it.
	const iconOnly = size?.startsWith("icon") ?? false;

	return ButtonPrimitive(
		{
			type,
			...props,
			onClick: handleClick,
			disabled: anyTrue(disabled, isLoading),
			"data-slot": "button",
			"data-variant": variant,
			"data-size": size,
			"data-loading": flag(isLoading),
			"aria-busy": flag(isLoading),
			class: cn(buttonVariants({ variant, size }), className),
		},
		...(iconOnly
			? [If(isLoading, Spinner()).Else(...children)]
			: [If(isLoading, Spinner()), ...children]),
	);
});
