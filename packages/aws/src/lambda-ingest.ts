import {
	type AgentPondConfig,
	configFromEnv,
	sinkForConfig,
} from "@agentpond/core";
import {
	type AuthMode,
	handleIngestRequest,
	type IngestionLogger,
	type IngestionSink,
} from "@agentpond/ingest";
import { S3ObjectStore } from "./s3.js";

export type AwsIngestHandlerOptions = {
	config?: AgentPondConfig;
	authMode?: AuthMode;
	sink?: IngestionSink;
	logger?: IngestionLogger;
};

export type LambdaHttpApiV2Event = {
	version?: string;
	rawPath?: string;
	rawQueryString?: string;
	requestContext?: {
		http?: {
			method?: string;
			path?: string;
		};
	};
	headers?: Record<string, string | undefined>;
	body?: string;
	isBase64Encoded?: boolean;
};

export type LambdaHttpResponse = {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	isBase64Encoded: false;
};

export type LambdaIngestHandler = (
	event: LambdaHttpApiV2Event,
) => Promise<LambdaHttpResponse>;

export function createLambdaIngestHandler(
	options: AwsIngestHandlerOptions = {},
): LambdaIngestHandler {
	const config = options.config ?? configFromEnv({ storeType: "s3" });
	const sink = options.sink ?? awsSinkForConfig(config);

	return async (event) => {
		const body = event.body
			? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
			: undefined;
		const response = await handleIngestRequest(
			{
				method: event.requestContext?.http?.method ?? "GET",
				path: event.rawPath ?? event.requestContext?.http?.path ?? "/",
				query: event.rawQueryString,
				headers: event.headers,
				body,
			},
			{
				...options,
				config,
				sink,
			},
		);
		return {
			statusCode: response.status,
			headers: response.headers,
			body: response.body,
			isBase64Encoded: false,
		};
	};
}

export function awsSinkForConfig(config: AgentPondConfig): IngestionSink {
	return sinkForConfig(config, {
		s3: S3ObjectStore.fromEnvironment,
	});
}

export const lambdaIngestHandler = createLambdaIngestHandler();
