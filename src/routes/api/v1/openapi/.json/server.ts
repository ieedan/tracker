import { openapiDocument } from "@/lib/server/openapi.server";

/** The machine-readable description of this API, at `/api/v1/openapi.json`. */
export function GET(): Response {
	return Response.json(openapiDocument(), {
		headers: { "cache-control": "public, max-age=60" },
	});
}
