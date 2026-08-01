import { configFromRuntimeEnv, normalizePrefix } from "@agentpond/core";
import { AgentPondSpanExporter } from "@agentpond/otel";
import { type FilesClient, FilesObjectStore } from "./files-object-store.js";

type FilesSpanExporterDestinationOptions = {
	projectId?: string;
	prefix?: string;
};

export type FilesSpanExporterOptions = FilesSpanExporterDestinationOptions & {
	files: FilesClient | PromiseLike<FilesClient>;
};

export type FilesSpanExporterFromRuntimeEnvOptions = {
	env?: NodeJS.ProcessEnv;
} & FilesSpanExporterDestinationOptions;

export function createFilesSpanExporter(
	options: FilesSpanExporterOptions,
): AgentPondSpanExporter {
	const destination = spanExporterDestination(options);
	return new AgentPondSpanExporter({
		store: FilesObjectStore.fromFiles(options.files),
		...destination,
	});
}

export function createFilesSpanExporterFromRuntimeEnv(
	options: FilesSpanExporterFromRuntimeEnvOptions = {},
): AgentPondSpanExporter {
	const env = options.env ?? process.env;
	return new AgentPondSpanExporter({
		store: FilesObjectStore.fromRuntimeEnv(env),
		...spanExporterDestination(options, env),
	});
}

function spanExporterDestination(
	options: FilesSpanExporterDestinationOptions,
	env: NodeJS.ProcessEnv = process.env,
): { projectId: string; prefix: string } {
	if (options.projectId === undefined) {
		const runtimeConfig = configFromRuntimeEnv(env);
		return {
			projectId: runtimeConfig.projectId,
			prefix: options.prefix ?? runtimeConfig.prefix,
		};
	}
	return {
		projectId: options.projectId,
		prefix: options.prefix ?? normalizePrefix(env.AGENTPOND_PREFIX ?? ""),
	};
}
