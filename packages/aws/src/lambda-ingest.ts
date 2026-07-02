import {
	type AgentPondConfig,
	type AuthConfig,
	sinkForConfig,
} from "@agentpond/core";
import {
	createIngestRequest,
	handleIngestRequest,
	type IngestionLogger,
	type IngestionSink,
} from "@agentpond/ingest";
import { S3ObjectStore } from "./s3.js";

export type AwsIngestHandlerOptions = {
	auth?: AuthConfig | false;
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
	const sink = options.sink ?? S3ObjectStore.fromRuntimeEnv().toSink();

	return async (event) => {
		const response = await handleIngestRequest(requestForLambda(event), {
			...options,
			sink,
		});
		return {
			statusCode: response.status,
			headers: responseHeaders(response),
			body: await response.text(),
			isBase64Encoded: false,
		};
	};
}

export function awsSinkForConfig(config: AgentPondConfig): IngestionSink {
	return sinkForConfig(config, {
		s3: S3ObjectStore.fromEnvironment,
	});
}

function requestForLambda(event: LambdaHttpApiV2Event): Request {
	const method = event.requestContext?.http?.method ?? "GET";
	const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
	const body = event.body
		? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
		: undefined;

	return createIngestRequest({
		method,
		path,
		query: event.rawQueryString,
		headers: event.headers,
		body,
	});
}

function responseHeaders(response: Response): Record<string, string> {
	return Object.fromEntries(response.headers.entries());
}

export const lambdaIngestHandler = createLambdaIngestHandler();
