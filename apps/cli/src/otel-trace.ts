import { randomBytes } from "node:crypto";

type TraceFlags = Record<string, string | boolean | undefined>;

export function manualTraceResourceSpans(
	flags: TraceFlags,
	traceId: string,
	timestamp: string,
): unknown[] {
	const name = stringFlag(flags, "name") ?? "manual trace";
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
							attributes: traceCreateAttributes(flags, name),
						},
					],
				},
			],
		},
	];
}

function traceCreateAttributes(
	flags: TraceFlags,
	name: string,
): Array<Record<string, unknown>> {
	const attributes: Array<Record<string, unknown>> = [
		otelAttr("langfuse.observation.type", "span"),
		otelAttr("langfuse.trace.name", name),
		otelAttr("langfuse.environment", "default"),
	];
	const userId = stringFlag(flags, "userId");
	if (userId) attributes.push(otelAttr("user.id", userId));
	const sessionId = stringFlag(flags, "sessionId");
	if (sessionId) attributes.push(otelAttr("session.id", sessionId));
	const input = jsonOrStringFlag(flags, "input");
	if (input !== undefined) {
		attributes.push(otelAttr("langfuse.trace.input", input));
		attributes.push(otelAttr("langfuse.observation.input", input));
	}
	const output = jsonOrStringFlag(flags, "output");
	if (output !== undefined) {
		attributes.push(otelAttr("langfuse.trace.output", output));
		attributes.push(otelAttr("langfuse.observation.output", output));
	}
	const metadata = jsonFlag(flags, "metadata");
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

function stringFlag(flags: TraceFlags, name: string): string | undefined {
	const value = flags[name];
	return typeof value === "string" ? value : undefined;
}

function jsonFlag(
	flags: TraceFlags,
	name: string,
): Record<string, unknown> | undefined {
	const raw = stringFlag(flags, name);
	if (!raw) return undefined;
	const value = JSON.parse(raw) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`--${name} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function jsonOrStringFlag(flags: TraceFlags, name: string): unknown {
	const raw = stringFlag(flags, name);
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
