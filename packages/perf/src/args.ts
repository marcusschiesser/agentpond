import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentPondConfig, S3ObjectStore } from "@agentpond/core";

export type PerfArgs = {
	traces: number;
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	projectId: string;
	publicKey: string;
	secretKey: string;
	prefix: string;
	dbPath: string;
};

const DEFAULT_TRACES = 100_000;

export function parseArgs(argv: string[]): PerfArgs {
	const values = parseFlags(argv.filter((arg) => arg !== "--"));
	const runId = values["run-id"] ?? randomUUID();
	const dbPath =
		values.db ??
		join(mkdtempSync(join(tmpdir(), "agentpond-perf-")), "cache.duckdb");

	const traces = integerFlag(values, "traces", DEFAULT_TRACES);
	if (traces < 1) throw new Error("--traces must be at least 1");

	return {
		traces,
		endpoint: values.endpoint ?? "http://localhost:9000",
		bucket: values.bucket ?? "agentpond",
		accessKeyId: values["access-key-id"] ?? "minio",
		secretAccessKey: values["secret-access-key"] ?? "minio123",
		region: values.region ?? "us-east-1",
		projectId: values["project-id"] ?? "default-project",
		publicKey: values["public-key"] ?? "pk-agentpond",
		secretKey: values["secret-key"] ?? "sk-agentpond",
		prefix: normalizePrefix(values.prefix ?? `perf/${runId}`),
		dbPath,
	};
}

export function buildConfig(args: PerfArgs): AgentPondConfig {
	return {
		projectId: args.projectId,
		dbPath: args.dbPath,
		s3: {
			bucket: args.bucket,
			prefix: args.prefix,
			endpoint: args.endpoint,
			region: args.region,
			accessKeyId: args.accessKeyId,
			secretAccessKey: args.secretAccessKey,
			forcePathStyle: true,
		},
		auth: {
			projectId: args.projectId,
			publicKey: args.publicKey,
			secretKey: args.secretKey,
		},
	};
}

export function configureLangfuseEnv(address: string, args: PerfArgs): void {
	process.env.LANGFUSE_BASE_URL = address;
	process.env.LANGFUSE_PUBLIC_KEY = args.publicKey;
	process.env.LANGFUSE_SECRET_KEY = args.secretKey;
	process.env.LANGFUSE_RELEASE = "agentpond-perf";
	process.env.LANGFUSE_ENVIRONMENT = "performance";
}

export async function assertEmptyPrefix(
	store: S3ObjectStore,
	prefix: string,
): Promise<void> {
	try {
		const keys = await store.listKeys(prefix);
		if (keys.length > 0) {
			throw new Error(
				`S3 prefix ${prefix} is not empty (${keys.length} existing objects)`,
			);
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes("is not empty")) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not access local S3 storage. Start MinIO and create the bucket first: docker compose up -d minio create-bucket. Cause: ${message}`,
		);
	}
}

export function runIdFromPrefix(prefix: string): string {
	const trimmed = prefix.replace(/\/$/, "");
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function parseFlags(argv: string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
		const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
		const value = inlineValue ?? argv[i + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for --${rawKey}`);
		}
		flags[rawKey] = value;
		if (inlineValue === undefined) i += 1;
	}
	return flags;
}

function integerFlag(
	flags: Record<string, string>,
	name: string,
	defaultValue: number,
): number {
	const raw = flags[name];
	if (!raw) return defaultValue;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value) || String(value) !== raw) {
		throw new Error(`--${name} must be an integer`);
	}
	return value;
}

function normalizePrefix(prefix: string): string {
	return prefix.endsWith("/") ? prefix : `${prefix}/`;
}
