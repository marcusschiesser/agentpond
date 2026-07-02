export type IngestRequest = {
	method?: string;
	path: string;
	query?: string;
	headers?: Headers | Record<string, string | string[] | undefined>;
	body?: Buffer | Uint8Array | string;
	baseUrl?: string;
};

// Fetch Request requires an absolute URL, while provider adapters usually expose
// only a path. Ingest routing only reads the path and query.
const defaultBaseUrl = "http://agentpond.invalid";

export function createIngestRequest(init: IngestRequest): Request {
	const method = init.method ?? "GET";
	return new Request(requestUrl(init), {
		method,
		headers: ingestRequestHeaders(init.headers),
		body: methodAllowsBody(method) ? ingestRequestBody(init.body) : undefined,
	});
}

function requestUrl(init: IngestRequest): string {
	const path = init.path.startsWith("/") ? init.path : `/${init.path}`;
	const query = init.query?.startsWith("?") ? init.query.slice(1) : init.query;
	const separator = query ? (path.includes("?") ? "&" : "?") : "";
	return new URL(
		`${path}${separator}${query ?? ""}`,
		init.baseUrl ?? defaultBaseUrl,
	).toString();
}

function ingestRequestHeaders(
	headers: IngestRequest["headers"],
): HeadersInit | undefined {
	if (!headers || headers instanceof Headers) return headers;

	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value === "string") result[name] = value;
		else if (Array.isArray(value) && typeof value[0] === "string") {
			result[name] = value[0];
		}
	}
	return result;
}

function ingestRequestBody(body: IngestRequest["body"]): BodyInit | undefined {
	if (body === undefined || typeof body === "string") return body;
	return new Uint8Array(body) as BodyInit;
}

function methodAllowsBody(method: string): boolean {
	const normalizedMethod = method.toUpperCase();
	return normalizedMethod !== "GET" && normalizedMethod !== "HEAD";
}
