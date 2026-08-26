/**
 * Prompting, with the app's own env schemas doing the validating.
 *
 * Answers are checked against `src/lib/env.schema.ts` — the very schemas
 * `defineEnv` enforces at build time — so setup cannot write a file the app
 * would then refuse to start with.
 */
import { cancel, confirm, isCancel, log, note, select, text, type Option } from "@clack/prompts";
import color from "picocolors";
import * as v from "valibot";
import { mask } from "./env-file.ts";

export { intro, log, note, outro, spinner } from "@clack/prompts";
export { default as color } from "picocolors";

export function exitIfCancelled<T>(value: T | symbol): asserts value is T {
	if (isCancel(value)) {
		cancel("Setup cancelled. Run it again to pick up where you left off.");
		process.exit(0);
	}
}

/** Prompts, exiting the run on Ctrl-C rather than returning clack's symbol. */
export async function ask(options: Parameters<typeof text>[0]): Promise<string> {
	const answer = await text(options);
	exitIfCancelled(answer);
	return (answer ?? "").trim();
}

export async function askConfirm(message: string, initialValue = true): Promise<boolean> {
	const answer = await confirm({ message, initialValue });
	exitIfCancelled(answer);
	return answer;
}

export async function askSelect<T extends string>(
	message: string,
	options: Array<Option<T>>,
	initialValue?: NoInfer<T>,
): Promise<T> {
	const answer = await select<T>({ message, options, initialValue });
	exitIfCancelled(answer);
	return answer;
}

type EnvValueOptions = {
	/** The variable being answered — shown as the prompt's label. */
	key: string;
	/** One line on what it is, or where to find it. */
	hint: string;
	/** The schema the answer has to satisfy. */
	schema: v.GenericSchema;
	/** Offered as the answer when the prompt is submitted empty. */
	initial?: string;
	/** Show the default masked rather than in full. */
	secret?: boolean;
};

/** Asks for one environment variable, re-asking until the schema is happy. */
export async function askEnv(options: EnvValueOptions): Promise<string> {
	const { key, hint, schema, initial = "", secret = false } = options;

	const answer = await text({
		message: `${key}  ${color.dim(hint)}`,
		placeholder: initial === "" ? undefined : secret ? mask(initial) : initial,
		defaultValue: initial,
		validate: (input) => {
			const value = (input ?? "").trim() === "" ? initial : (input ?? "").trim();
			const result = v.safeParse(schema, value);
			if (result.success) return undefined;
			return result.issues[0]?.message ?? "invalid value";
		},
	});
	exitIfCancelled(answer);

	const value = (answer ?? "").trim();
	return value === "" ? initial : value;
}

/** A schema that simply insists on an answer. */
export function required(message: string): v.GenericSchema {
	return v.pipe(v.string(), v.minLength(1, message));
}

/**
 * Prints lines with no border, no prefix and no trailing padding.
 *
 * A block meant to be pasted whole — a policy document, a key — cannot go
 * inside one of clack's boxes: dragging a selection across the lines picks up
 * the padding and the right-hand border with it. A single value can, since
 * double-clicking it selects the word and nothing else.
 */
function plain(lines: string[]): void {
	process.stdout.write(`${lines.join("\n")}\n`);
}

/** The gap between a field and its value, wide enough to read as a column. */
const GAP = "    ";

/**
 * `field    value` on one line, or the value on its own line when that would
 * not fit.
 *
 * `note` wraps its contents to the terminal, and a wrapped value spills onto a
 * second line — the same broken selection this file avoids everywhere else,
 * only produced by the box rather than by the caller.
 */
function row(field: string, value: string, width: number, available: number): string[] {
	if (`${field.padEnd(width)}${GAP}${value}`.length <= available) {
		return [`${field.padEnd(width)}${GAP}${color.bold(value)}`];
	}
	return [field, `${GAP}${color.bold(value)}`];
}

/**
 * A set of instructions for another site, printed as one block.
 *
 * `rows` are `[field, value]` pairs of exactly what to put where — the part
 * that is tedious to work out and easy to get subtly wrong. `payload` is a
 * block to be copied in one piece, so it is printed after the box rather than
 * inside it.
 */
export function instructions(options: {
	title: string;
	url: string;
	rows?: Array<[string, string]>;
	steps?: string[];
	after?: string[];
	payload?: string;
}): void {
	const { title, url, rows = [], steps = [], after = [], payload } = options;

	// A field far longer than the rest would pad every other row off the screen,
	// so it overflows into its own gap instead of setting the column.
	const width = Math.max(0, ...rows.map(([field]) => field.length).filter((n) => n <= 32));
	// What `note` wraps at.
	const available = (process.stdout.columns ?? 80) - 6;

	note(
		[
			color.cyan(url),
			...(steps.length > 0 || rows.length > 0 ? [""] : []),
			...steps.map((step, index) => `${index + 1}  ${step}`),
			...rows.flatMap(([field, value]) => row(field, value, width, available)),
			...(after.length > 0 ? ["", ...after] : []),
		].join("\n"),
		title,
	);

	if (payload !== undefined) plain(["", payload, ""]);
}

/** The finished environment, secrets masked, as one block. */
export function summary(title: string, entries: Array<[string, string]>): void {
	const width = Math.max(0, ...entries.map(([key]) => key.length));
	note(
		entries
			.map(
				([key, shown]) => `${key.padEnd(width)}  ${shown === "(empty)" ? color.dim(shown) : shown}`,
			)
			.join("\n"),
		title,
	);
}

export function ok(message: string): void {
	log.success(message);
}

export function warn(message: string): void {
	log.warn(message);
}

export function fail(message: string): void {
	log.error(message);
}
