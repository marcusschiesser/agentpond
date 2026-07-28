import { configFromRuntimeEnv } from "@agentpond/core";
import { AgentPondSpanExporter } from "@agentpond/otel";
import { type FilesClient, FilesObjectStore } from "./files-object-store.js";

export type FilesSpanExporterOptions = {
	files: FilesClient;
	projectId?: string;
	prefix?: string;
};

export type FilesSpanExporterFromRuntimeEnvOptions = {
	env?: NodeJS.ProcessEnv;
	projectId?: string;
	prefix?: string;
};

export function createFilesSpanExporter(
	options: FilesSpanExporterOptions,
): AgentPondSpanExporter {
	const config = configFromRuntimeEnv();
	return new AgentPondSpanExporter({
		store: new FilesObjectStore(options.files),
		projectId: options.projectId ?? config.projectId,
		prefix: options.prefix ?? config.prefix,
	});
}

export function createFilesSpanExporterFromRuntimeEnv(
	options: FilesSpanExporterFromRuntimeEnvOptions = {},
): AgentPondSpanExporter {
	const env = options.env ?? process.env;
	const config = configFromRuntimeEnv(env);
	return new AgentPondSpanExporter({
		store: FilesObjectStore.fromRuntimeEnv(env),
		projectId: options.projectId ?? config.projectId,
		prefix: options.prefix ?? config.prefix,
	});
}
