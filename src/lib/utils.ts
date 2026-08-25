import { isReadable, type ClassReadable, type ClassValue, type Readable } from "@implementjs/core";
import { twMerge } from "tailwind-merge";

/**
 * Merge tailwind classes so the last one wins.
 *
 * `class` on an element is already clsx-shaped — strings, objects, arrays, signals — but the
 * resolved list is handed to the browser as-is, and two utilities from the same group both survive.
 * Which one paints is then stylesheet order, not the order they were written, so a caller passing
 * `class: "p-2"` to a component whose base is `p-6` gets `p-6`. `cn` runs the resolved list through
 * [tailwind-merge](https://github.com/dcastil/tailwind-merge), which drops the earlier class of any
 * conflicting pair — which is what makes every component on this page overridable.
 *
 * @example
 * Div({ class: cn("rounded-xl border p-6", className) });
 */
export function cn(...inputs: ClassValue[]): ClassValue {
	const found = new Set<Readable<unknown>>();
	const merged = merge(inputs, found);

	// A plain string covers almost every call. Only hand back something reactive when a signal
	// was actually passed in, so the merge re-runs on change rather than freezing at this value.
	return found.size === 0 ? merged : reactive(inputs);
}

/**
 * The merged list as a readable, for when a signal is somewhere in it.
 *
 * `class` normally re-walks the value it was given on every change, which is what keeps a signal
 * that appears (or disappears) mid-life subscribed. Merging eagerly would collapse that structure
 * into one string and freeze the dependencies at whatever was present the first time, so this does
 * the same bookkeeping `class` does: re-walk, then subscribe to exactly what the walk just read.
 */
function reactive(inputs: ClassValue[]): ClassReadable {
	return {
		get: () => merge(inputs, new Set()),

		subscribe(callback) {
			const subscriptions = new Map<Readable<unknown>, () => void>();
			// undefined until the first walk, which establishes the baseline without reporting it —
			// `subscribe` is for later updates, and the current value comes from `get`
			let current: string | undefined;

			const apply = () => {
				const found = new Set<Readable<unknown>>();
				const next = merge(inputs, found);

				// Only the signals that came or went are touched. One still in the list keeps the
				// subscription it already had, so the signal currently notifying is never re-added
				// to its own in-flight notify loop.
				for (const [readable, unsubscribe] of subscriptions) {
					if (!found.has(readable)) {
						unsubscribe();
						subscriptions.delete(readable);
					}
				}
				for (const readable of found) {
					if (!subscriptions.has(readable)) {
						subscriptions.set(readable, readable.subscribe(apply));
					}
				}

				const changed = current !== undefined && next !== current;
				current = next;
				if (changed) callback(next);
			};

			apply();

			return () => {
				for (const unsubscribe of subscriptions.values()) unsubscribe();
				subscriptions.clear();
			};
		},
	};
}

/** The class list as one merged string, recording the signals it had to read along the way. */
function merge(inputs: ClassValue[], found: Set<Readable<unknown>>): string {
	const parts: string[] = [];
	resolve(inputs, found, parts);
	return twMerge(parts.join(" "));
}

/** The same walk `class` itself does: flatten a clsx-shaped value into the names it stands for. */
function resolve(value: unknown, found: Set<Readable<unknown>>, out: string[]): void {
	if (value == null || typeof value === "boolean" || value === "") return;

	if (typeof value === "string") {
		out.push(value);
		return;
	}

	if (typeof value === "number" || typeof value === "bigint") {
		out.push(`${value}`);
		return;
	}

	if (isReadable(value)) {
		found.add(value);
		resolve(value.get(), found, out);
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			resolve(item, found, out);
		}
		return;
	}

	if (typeof value === "object") {
		// `{ active: condition }` — the key is the class, the value says whether it applies
		for (const [name, condition] of Object.entries(value)) {
			let applies = condition;
			if (isReadable(condition)) {
				found.add(condition);
				applies = condition.get();
			}
			if (applies) out.push(name);
		}
	}
}
