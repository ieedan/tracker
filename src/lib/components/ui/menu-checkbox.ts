/**
 * Linear-style checkbox inside a menu or command row.
 *
 * The row is the real control (`menuitemcheckbox`, or a command item). This box
 * is decorative: it looks like a checkbox, toggles the same array, and swallows
 * its own click so the row never sees it. Checking from here leaves the menu
 * open; clicking the rest of the row goes through the item and closes.
 */
import { type ClassValue, type Signal } from "@implementjs/core";
import { Checkbox, type CheckboxProps } from "@/lib/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** A two-way view of one id's place in a selected array. */
function membership(selected: Signal<string[]>, value: string): Signal<boolean> {
	return selected.bind(
		(ids) => ids.includes(value),
		(ids, checked) => (checked ? [...ids, value] : ids.filter((id) => id !== value)),
	);
}

export function applyIdDiff(
	before: Iterable<string>,
	after: Iterable<string | number>,
	onToggle: (id: string) => void,
): void {
	const prev = new Set(before);
	const next = new Set([...after].map(String));
	for (const id of next) {
		if (!prev.has(id)) onToggle(id);
	}
	for (const id of prev) {
		if (!next.has(id)) onToggle(id);
	}
}

/**
 * @param className Overrides for the shapes that do not have a highlighted row
 * to reveal the box — a drawer, where every box is drawn from the start.
 */
export function MenuCheckbox(selected: Signal<string[]>, value: string, className?: ClassValue) {
	return Checkbox({
		decorative: true,
		"aria-hidden": true,
		checked: membership(selected, value),
		onClick: (event: MouseEvent) => event.stopPropagation(),
		class: cn(
			"transition-opacity opacity-0 data-[state=checked]:opacity-100",
			"group-data-highlighted/menu-item:opacity-100",
			"group-data-selected/command-item:opacity-100",
			className,
		),
	} as CheckboxProps);
}
