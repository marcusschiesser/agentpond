export type CliFlags = Record<string, string | boolean | undefined>;

export class CliError extends Error {}

export function stringFlag(flags: CliFlags, name: string): string | undefined {
	const value = flags[name];
	return typeof value === "string" ? value : undefined;
}

export function limit(flags: CliFlags): number {
	const raw = stringFlag(flags, "limit");
	if (!raw) return 100;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value) || value < 1 || value > 10000)
		throw new CliError("--limit must be between 1 and 10000");
	return value;
}

export function parsePort(raw: string): number {
	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new CliError("--port must be between 1 and 65535");
	}
	return value;
}

export function print(value: unknown, json: boolean): void {
	if (json) {
		console.log(
			JSON.stringify(
				value,
				(_key, item) => (typeof item === "bigint" ? item.toString() : item),
				2,
			),
		);
		return;
	}
	if (Array.isArray(value)) {
		console.table(value);
		return;
	}
	console.log(JSON.stringify(value, null, 2));
}
