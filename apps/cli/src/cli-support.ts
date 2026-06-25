export type ParsedArgs = {
	flags: Record<string, string | boolean>;
	positionals: string[];
};

export class CliError extends Error {}

export function parseArgs(args: string[]): ParsedArgs {
	const flags: ParsedArgs["flags"] = {};
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		const key = arg.slice(2);
		if (["json", "help", "h"].includes(key)) {
			flags[key] = true;
			continue;
		}
		const value = args[i + 1];
		if (!value || value.startsWith("--"))
			throw new CliError(`Missing value for --${key}`);
		flags[key] = value;
		i += 1;
	}
	return { flags, positionals };
}

export function stringFlag(
	parsed: ParsedArgs,
	name: string,
): string | undefined {
	const value = parsed.flags[name];
	return typeof value === "string" ? value : undefined;
}

export function requiredFlag(parsed: ParsedArgs, name: string): string {
	const value = stringFlag(parsed, name);
	if (!value) throw new CliError(`Missing --${name}`);
	return value;
}

export function limit(parsed: ParsedArgs): number {
	const raw = stringFlag(parsed, "limit");
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
