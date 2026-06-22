import { randomBytes } from "node:crypto";

type ParsedArgs = {
	flags: Record<string, string | boolean>;
	positionals: string[];
};

export function manualTraceResourceSpans(
	parsed: ParsedArgs,
	traceId: string,
	timestamp: string,
): unknown[] {
	const name = stringFlag(parsed, "name") ?? "manual trace";
	return [
		{
			scopeSpans: [
				{
					spans: [
						{
							traceId,
							spanId: randomBytes(8).toString("hex"),
							name,
							startTimeUnixNano: isoToUnixNanos(timestamp),
							endTimeUnixNano: isoToUnixNanos(timestamp),
							attributes: traceCreateAttributes(parsed, name),
						},
					],
				},
			],
		},
	];
}

function traceCreateAttributes(
	parsed: ParsedArgs,
	name: string,
): Array<Record<string, unknown>> {
	const attributes: Array<Record<string, unknown>> = [
		otelAttr("langfuse.observation.type", "span"),
		otelAttr("langfuse.trace.name", name),
		otelAttr("langfuse.environment", "default"),
	];
	const userId = stringFlag(parsed, "userId");
	if (userId) attributes.push(otelAttr("user.id", userId));
	const sessionId = stringFlag(parsed, "sessionId");
	if (sessionId) attributes.push(otelAttr("session.id", sessionId));
	const input = jsonOrStringFlag(parsed, "input");
	if (input !== undefined) {
		attributes.push(otelAttr("langfuse.trace.input", input));
		attributes.push(otelAttr("langfuse.observation.input", input));
	}
	const output = jsonOrStringFlag(parsed, "output");
	if (output !== undefined) {
		attributes.push(otelAttr("langfuse.trace.output", output));
		attributes.push(otelAttr("langfuse.observation.output", output));
	}
	const metadata = jsonFlag(parsed, "metadata");
	if (metadata) {
		for (const [key, value] of Object.entries(metadata)) {
			attributes.push(otelAttr(`langfuse.trace.metadata.${key}`, value));
		}
	}
	return attributes;
}

function otelAttr(key: string, value: unknown): Record<string, unknown> {
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	if (typeof value === "number") return { key, value: { doubleValue: value } };
	if (Array.isArray(value)) {
		return {
			key,
			value: {
				arrayValue: {
					values: value.map((item) => ({ stringValue: String(item) })),
				},
			},
		};
	}
	return {
		key,
		value: {
			stringValue: typeof value === "string" ? value : JSON.stringify(value),
		},
	};
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
	const value = parsed.flags[name];
	return typeof value === "string" ? value : undefined;
}

function jsonFlag(
	parsed: ParsedArgs,
	name: string,
): Record<string, unknown> | undefined {
	const raw = stringFlag(parsed, name);
	if (!raw) return undefined;
	const value = JSON.parse(raw) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`--${name} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function jsonOrStringFlag(parsed: ParsedArgs, name: string): unknown {
	const raw = stringFlag(parsed, name);
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

function isoToUnixNanos(value: string): string {
	return `${BigInt(Date.parse(value)) * 1_000_000n}`;
}
