/**
 * Syntax highlighting for fenced code blocks, as DOM nodes.
 *
 * Hand-rolled for the same reason markdown.ts is: every highlighter worth its
 * download renders to an HTML string, and this codebase does not have an
 * `innerHTML` to hand one to. Tokens become `Span` nodes whose text goes
 * through `document.createTextNode` (or the server renderer's escaper), so a
 * code block can say `<img onerror=…>` and it stays characters.
 *
 * It is a lexer, not a parser: strings, comments, numbers, keywords, and a few
 * per-language shapes (tags, attributes, `$variables`). That covers what makes
 * a pasted snippet readable — nobody misses semantic tokens in a comment box —
 * and keeps every pattern simple enough to see it cannot backtrack.
 *
 * Colors are the six `--syntax-*` theme variables in app.css, so blocks follow
 * the light/dark switch like everything else.
 */
import { Span, type Child } from "@implementjs/core";

type Kind = "comment" | "string" | "keyword" | "constant" | "function" | "tag";

const KIND_CLASS: Record<Kind, string> = {
	comment: "text-syntax-comment",
	string: "text-syntax-string",
	keyword: "text-syntax-keyword",
	constant: "text-syntax-constant",
	function: "text-syntax-function",
	tag: "text-syntax-tag",
};

interface Rule {
	/** Sticky, so a rule can only match at the scanner's position. */
	pattern: RegExp;
	/** A fixed kind, or a classifier — null means "matched, but plain". */
	kind: Kind | null | ((match: RegExpExecArray, source: string) => Kind | null);
}

interface Token {
	kind: Kind | null;
	text: string;
}

/**
 * Past this, the block renders plain. A pathological paste should cost the
 * page a scrollbar, not a regex pass per character over a megabyte.
 */
const MAX_HIGHLIGHT_LENGTH = 20_000;

/** The nodes for one fenced block: colored spans, or the text as it came. */
export function highlightCode(language: string, text: string): Child[] {
	const rules = LANGUAGES[ALIASES[language.toLowerCase()] ?? ""];
	if (rules === undefined || text.length > MAX_HIGHLIGHT_LENGTH) return [text];

	return tokenize(text, rules).map((token) =>
		token.kind === null ? token.text : Span({ class: KIND_CLASS[token.kind] }, token.text),
	);
}

function tokenize(source: string, rules: Rule[]): Token[] {
	const tokens: Token[] = [];
	let plain = "";
	let index = 0;

	const flush = () => {
		if (plain !== "") {
			tokens.push({ kind: null, text: plain });
			plain = "";
		}
	};

	scan: while (index < source.length) {
		for (const rule of rules) {
			rule.pattern.lastIndex = index;
			const match = rule.pattern.exec(source);
			if (match === null || match[0] === "") continue;

			const kind = typeof rule.kind === "function" ? rule.kind(match, source) : rule.kind;
			if (kind === null) {
				// Matched but unclassified — an identifier that is not a keyword.
				// Consumed whole so `iffy` is never re-scanned as `if` + `fy`.
				plain += match[0];
			} else {
				flush();
				tokens.push({ kind, text: match[0] });
			}
			index += match[0].length;
			continue scan;
		}
		plain += source[index]!;
		index++;
	}

	flush();
	return tokens;
}

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A word rule: keywords color as keywords, literals as constants, a name
 * followed by `(` as a call. Everything else is plain — via the null kind, so
 * the scanner still steps over the whole identifier.
 */
function words(keywords: Set<string>, literals: Set<string>): Rule {
	return {
		pattern: /[A-Za-z_$][\w$]*/gy,
		kind: (match, source) => {
			if (keywords.has(match[0])) return "keyword";
			if (literals.has(match[0])) return "constant";
			return /^\s*\(/.test(source.slice(match.index + match[0].length)) ? "function" : null;
		},
	};
}

const NUMBER: Rule = {
	// Hex/binary/octal, decimals, exponents, and JS bigint's trailing `n`.
	pattern: /\b(?:0[xXbBoO][\dA-Fa-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/gy,
	kind: "constant",
};

const DOUBLE_QUOTED: Rule = { pattern: /"(?:\\.|[^"\\\n])*"?/gy, kind: "string" };
const SINGLE_QUOTED: Rule = { pattern: /'(?:\\.|[^'\\\n])*'?/gy, kind: "string" };

/* -------------------------------------------------------------------------- */
/* Languages                                                                  */
/* -------------------------------------------------------------------------- */

const JS_KEYWORDS = new Set(
	(
		"abstract as async await break case catch class const continue debugger declare default " +
		"delete do else enum export extends finally for from function get if implements import in " +
		"infer instanceof interface is keyof let namespace new of override private protected public " +
		"readonly return satisfies set static super switch this throw try type typeof var void " +
		"while with yield any boolean never number object string symbol unknown"
	).split(" "),
);

const JS_LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const JS: Rule[] = [
	{ pattern: /\/\/[^\n]*/gy, kind: "comment" },
	{ pattern: /\/\*[^]*?(?:\*\/|$)/gy, kind: "comment" },
	// Template literals are one string, interpolations included: tracking
	// `${}` nesting is a parser's job, and a green `${name}` still reads.
	{ pattern: /`(?:\\.|[^`\\])*`?/gy, kind: "string" },
	DOUBLE_QUOTED,
	SINGLE_QUOTED,
	{ pattern: /@[A-Za-z_$][\w$]*/gy, kind: "function" },
	NUMBER,
	words(JS_KEYWORDS, JS_LITERALS),
];

const JSON_RULES: Rule[] = [
	// Keys and values are the same production in JSON; the colon after is the
	// only thing that tells them apart, so the classifier looks for it.
	{
		pattern: /"(?:\\.|[^"\\\n])*"?/gy,
		kind: (match, source) =>
			/^\s*:/.test(source.slice(match.index + match[0].length)) ? "constant" : "string",
	},
	{ pattern: /\/\/[^\n]*/gy, kind: "comment" },
	NUMBER,
	{ pattern: /\b(?:true|false|null)\b/gy, kind: "keyword" },
];

const CSS: Rule[] = [
	{ pattern: /\/\*[^]*?(?:\*\/|$)/gy, kind: "comment" },
	DOUBLE_QUOTED,
	SINGLE_QUOTED,
	{ pattern: /@[\w-]+/gy, kind: "keyword" },
	{ pattern: /!important\b/gy, kind: "keyword" },
	{ pattern: /#[\dA-Fa-f]{3,8}\b/gy, kind: "constant" },
	// A property is a word before a colon — but so is `a` in `a:hover`, so it
	// also has to sit where a declaration can: at the start of a line, or
	// after a `{` or `;`.
	{
		pattern: /[\w-]+(?=\s*:)/gy,
		kind: (match, source) =>
			/(?:^|[{;\n])[ \t]*$/.test(source.slice(0, match.index)) ? "constant" : null,
	},
	{ pattern: /\d[\d.]*(?:px|r?em|%|vh|vw|s|ms|fr|deg|ch|ex)?/gy, kind: "constant" },
	{ pattern: /[.#][\w-]+/gy, kind: "tag" },
];

const HTML: Rule[] = [
	{ pattern: /<!--[^]*?(?:-->|$)/gy, kind: "comment" },
	{ pattern: /<!\[CDATA\[[^]*?(?:\]\]>|$)/gy, kind: "comment" },
	// The tag token carries its angle bracket, which is what makes `<div`
	// read as markup rather than a less-than.
	{ pattern: /<\/?[A-Za-z][\w.-]*|\/?>/gy, kind: "tag" },
	{ pattern: /[A-Za-z-]+(?==)/gy, kind: "constant" },
	DOUBLE_QUOTED,
	SINGLE_QUOTED,
	{ pattern: /&[a-zA-Z]+;|&#\d+;/gy, kind: "constant" },
];

const SHELL_KEYWORDS = new Set(
	(
		"if then else elif fi for while until do done case esac function in select time local " +
		"export return set unset trap shift exit source alias eval readonly declare"
	).split(" "),
);

const SHELL: Rule[] = [
	{ pattern: /#[^\n]*/gy, kind: "comment" },
	DOUBLE_QUOTED,
	{ pattern: /'[^']*'?/gy, kind: "string" },
	{ pattern: /\$\{[^}\n]*\}?|\$[\w@#?*$!-]+/gy, kind: "constant" },
	{
		pattern: /[A-Za-z_][\w-]*/gy,
		kind: (match) => (SHELL_KEYWORDS.has(match[0]) ? "keyword" : null),
	},
];

const PYTHON_KEYWORDS = new Set(
	(
		"and as assert async await break class continue def del elif else except finally for from " +
		"global if import in is lambda match nonlocal not or pass raise return try while with yield " +
		"self"
	).split(" "),
);

const PYTHON_LITERALS = new Set(["True", "False", "None"]);

const PYTHON: Rule[] = [
	{ pattern: /#[^\n]*/gy, kind: "comment" },
	// Triple-quoted first, or the single-line rules would eat their edges.
	{ pattern: /[rbfu]{0,2}"""[^]*?(?:"""|$)/giy, kind: "string" },
	{ pattern: /[rbfu]{0,2}'''[^]*?(?:'''|$)/giy, kind: "string" },
	{ pattern: /[rbfu]{0,2}"(?:\\.|[^"\\\n])*"?/giy, kind: "string" },
	{ pattern: /[rbfu]{0,2}'(?:\\.|[^'\\\n])*'?/giy, kind: "string" },
	{ pattern: /@[\w.]+/gy, kind: "function" },
	NUMBER,
	words(PYTHON_KEYWORDS, PYTHON_LITERALS),
];

const LANGUAGES: Record<string, Rule[]> = {
	js: JS,
	json: JSON_RULES,
	css: CSS,
	html: HTML,
	shell: SHELL,
	python: PYTHON,
};

/**
 * What people actually type after the fence. Unlisted languages render plain,
 * which is what they rendered before there was a highlighter.
 */
const ALIASES: Record<string, string> = {
	js: "js",
	jsx: "js",
	ts: "js",
	tsx: "js",
	javascript: "js",
	typescript: "js",
	mjs: "js",
	cjs: "js",
	json: "json",
	jsonc: "json",
	css: "css",
	scss: "css",
	html: "html",
	xml: "html",
	svg: "html",
	sh: "shell",
	bash: "shell",
	shell: "shell",
	zsh: "shell",
	console: "shell",
	py: "python",
	python: "python",
};
