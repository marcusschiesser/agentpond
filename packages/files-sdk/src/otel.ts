import { configFromRuntimeEnv } from "@agentpond/core";
import {
	type AgentPondContentPolicy,
	AgentPondSpanExporter,
} from "@agentpond/otel";
import { type FilesClient, FilesObjectStore } from "./files-object-store.js";

export type FilesSpanExporterOptions = {
	contentPolicy?: AgentPondContentPolicy;
	files: FilesClient;
	projectId?: string;
	prefix?: string;
};

export type FilesSpanExporterFromRuntimeEnvOptions = {
	contentPolicy?: AgentPondContentPolicy;
	env?: NodeJS.ProcessEnv;
	projectId?: string;
	prefix?: string;
};

export function createFilesSpanExporter(
	options: FilesSpanExporterOptions,
): AgentPondSpanExporter {
	const config = configFromRuntimeEnv();
	return new AgentPondSpanExporter({
		contentPolicy: options.contentPolicy,
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
		contentPolicy: options.contentPolicy,
		store: FilesObjectStore.fromRuntimeEnv(env),
		projectId: options.projectId ?? config.projectId,
		prefix: options.prefix ?? config.prefix,
	});
}
