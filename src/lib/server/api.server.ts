import { error } from "@implementjs/kit/server";
import type { z } from "zod";

/**
 * Shared plumbing for `/api/v1`. Everything here exists so a handler reads as
 * "check, do, return" instead of repeating parse-and-respond boilerplate.
 */

export function json(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, init);
}

export function noContent(): Response {
	return new Response(null, { status: 204 });
}

/**
 * Parses and validates a JSON request body, answering 400 with the field
 * errors rather than a stack trace when it doesn't match.
 */
export async function parseBody<T extends z.ZodType>(
	request: Request,
	schema: T,
): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, "Body must be JSON");
	}

	const result = schema.safeParse(raw);
	if (!result.success) {
		error(
			400,
			result.error.issues
				.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
				.join("; "),
		);
	}

	return result.data;
}

/** Same, for query strings. */
export function parseQuery<T extends z.ZodType>(url: URL, schema: T): z.infer<T> {
	const raw: Record<string, string | string[]> = {};
	for (const key of new Set(url.searchParams.keys())) {
		const values = url.searchParams.getAll(key);
		raw[key] = values.length > 1 ? values : values[0]!;
	}

	const result = schema.safeParse(raw);
	if (!result.success) {
		error(
			400,
			result.error.issues
				.map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`)
				.join("; "),
		);
	}

	return result.data;
}

/** `?status=a&status=b` and `?status=a,b` both mean the same thing. */
export function csv(value: string | string[] | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	const list = (Array.isArray(value) ? value : value.split(",")).map((v) => v.trim()).filter(Boolean);
	return list.length > 0 ? list : undefined;
}
