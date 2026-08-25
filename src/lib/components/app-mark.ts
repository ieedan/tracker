import { Div, Span, Svg, type Mountable } from "@implementjs/core";
import { APP_NAME } from "@/lib/head";
import { cn } from "@/lib/utils";

/**
 * The product mark, drawn rather than linked.
 *
 * The same artwork as `static/favicon.svg` — including its own rounded square,
 * so the mark in the app and the one in the tab strip are one shape rather than
 * two that drift. Inlining it costs a copy of the path data (change both
 * together) and buys the thing that matters on a sign-in screen: no request and
 * no flash of an empty box above the fold.
 *
 * The colours are fixed for the same reason they are fixed in the favicon. The
 * blue holds its contrast on a light and a dark background alike, so the mark
 * stays the one people recognise instead of inverting under them.
 */
const MARKUP = `<svg viewBox="0 0 475 475" width="100%" height="100%" fill="none" aria-hidden="true"><rect width="475" height="475" rx="71" fill="#5e6ad2"/><path d="M274.948 198.001C273.928 201.812 276.799 205.554 280.743 205.554H353.585C358.664 205.554 361.446 211.471 358.205 215.382L167.641 445.366C166.431 446.826 164.907 447.499 163.394 447.573C163.226 447.581 163.058 447.581 162.891 447.574C159.206 447.433 155.794 443.829 157.385 439.478L215.442 280.705C216.814 276.953 214.21 273.018 210.37 272.669C210.114 272.646 209.852 272.639 209.586 272.649L121.636 275.873C121.475 275.879 121.317 275.879 121.16 275.873C116.309 275.692 113.614 269.98 116.753 266.102L148.023 227.477L284.044 164.049L274.948 198.001ZM312.972 27.426C316.475 27.5675 319.743 30.8005 318.616 35.0051L299.319 107.035L212.908 147.329L308.157 29.677C309.368 28.1821 310.929 27.4925 312.483 27.426C312.646 27.4191 312.809 27.4195 312.972 27.426Z" fill="#ffffff"/></svg>`;

/** The mark on its own. Size it with a `size-*` class. */
export function AppMark(props: { class?: string } = {}): Mountable {
	return Span(
		{ class: cn("inline-flex size-7 shrink-0 items-center justify-center", props.class) },
		Svg(MARKUP),
	);
}

/**
 * The mark beside the product name, for the screens that open with a brand
 * rather than with a heading.
 */
export function AppWordmark(props: { class?: string } = {}): Mountable {
	return Div(
		{ class: cn("flex items-center gap-2", props.class) },
		AppMark(),
		Span({ class: "text-[15px] font-semibold tracking-tight" }, APP_NAME),
	);
}
