import { A, Code, Div, H1, Li, P, Span, Ul, signal } from "@implementjs/core";
import { MinusIcon, PlusIcon } from "@implementjs/lucide";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@implementjs/primitives";
import { Button } from "@/lib/components/ui/button";
import { ModeToggle } from "@/lib/mode";
import { SignUpForm } from "@/lib/sign-up-form";

const styles = {
	page: "flex min-h-dvh flex-col items-center justify-center gap-6 p-8",
	title: "text-3xl font-semibold tracking-tight",
	subtitle: "text-sm text-muted-foreground",
	code: "rounded px-1.5 py-0.5 font-mono text-xs bg-muted text-muted-foreground",
	counter: "flex items-center gap-4",
	count: "min-w-10 text-center font-mono text-2xl tabular-nums",
	links: "flex flex-col items-center gap-1 text-sm",
	link: "underline underline-offset-4 text-muted-foreground hover:text-foreground",
	trigger: "cursor-pointer text-sm text-muted-foreground hover:text-foreground",
	panel: "pt-3",
};

const links = [
	{ label: "Documentation", href: "https://github.com/ieedan/implement" },
	{ label: "Routing", href: "https://github.com/ieedan/implement/tree/main/packages/kit" },
	{ label: "Primitives", href: "https://github.com/ieedan/implement/tree/main/packages/primitives" },
	{ label: "Forms", href: "https://github.com/ieedan/implement/tree/main/packages/formish" },
	{ label: "Dark mode", href: "https://github.com/ieedan/implement/tree/main/packages/mode-watcher" },
	{ label: "Components", href: "https://github.com/ieedan/implement/tree/main/apps/docs/src/content/ui" },
];

export function Counter() {
	const count = signal(0);

	return Div(
		{ class: styles.page },
		H1({ class: styles.title }, "implement"),
		P(
			{ class: styles.subtitle },
			"Edit ",
			Code({ class: styles.code }, "src/lib/counter.ts"),
			" and save to see it update.",
		),
		Div(
			{ class: styles.counter },
			Button(
				{ variant: "outline", size: "icon", "aria-label": "Decrement", onClick: () => count.decrement() },
				MinusIcon({ class: "size-4" }),
			),
			Span({ class: styles.count }, count),
			Button(
				{ variant: "outline", size: "icon", "aria-label": "Increment", onClick: () => count.increment() },
				PlusIcon({ class: "size-4" }),
			),
		),
		ModeToggle(),
		SignUpForm(),
		Links(),
	);
}

/** The links, tucked into a headless collapsible from @implementjs/primitives. */
function Links() {
	return Collapsible(
		{},
		CollapsibleTrigger({ class: styles.trigger }, "What's next?"),
		CollapsibleContent(
			{ class: styles.panel },
			Ul(
				{ class: styles.links },
				...links.map((link) => Li(A({ class: styles.link, href: link.href }, link.label))),
			),
		),
	);
}
