import { nonEmpty } from "@agentpond/core";
import { AgentPondSpanExporter } from "@agentpond/otel";
import {
	VercelBlobObjectStore,
	vercelBlobConfigFromRuntimeEnv,
} from "./blob.js";

export const defaultVercelBlobPrefix = "agentpond";

export type VercelSpanExporterOptions = {
	projectId?: string;
	environment?: string;
};

export function createVercelSpanExporter(
	options: VercelSpanExporterOptions = {},
): AgentPondSpanExporter {
	const projectId = nonEmpty(
		options.projectId ?? process.env.VERCEL_PROJECT_ID,
	);
	if (!projectId) {
		throw new Error(
			"createVercelSpanExporter() requires VERCEL_PROJECT_ID or an explicit projectId",
		);
	}
	const environment = nonEmpty(
		options.environment ??
			process.env.VERCEL_TARGET_ENV ??
			process.env.VERCEL_ENV,
	);
	if (!environment) {
		throw new Error(
			"createVercelSpanExporter() requires VERCEL_TARGET_ENV, VERCEL_ENV, or an explicit environment",
		);
	}

	const blobConfig = vercelBlobConfigFromRuntimeEnv();
	if (blobConfig.access !== "private") {
		throw new Error(
			"createVercelSpanExporter() requires a private Vercel Blob store",
		);
	}

	return new AgentPondSpanExporter({
		store: VercelBlobObjectStore.fromConfig(blobConfig),
		projectId: vercelAgentPondProjectId(projectId, environment),
		prefix: defaultVercelBlobPrefix,
	});
}

export function vercelAgentPondProjectId(
	projectId: string,
	environment: string,
): string {
	return `${vercelIdentifier("project id", projectId)}-${vercelIdentifier("environment", environment)}`;
}

function vercelIdentifier(label: string, value: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(value)) {
		throw new Error(`Invalid Vercel ${label}: ${value}`);
	}
	return value;
}
