import { createFilesSpanExporter } from "@agentpond/files-sdk/otel";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";
import { Files } from "files-sdk";
import { fs } from "files-sdk/fs";

export default defineInstrumentation({
	setup: ({ agentName }) => {
		const root = process.env.FILES_SDK_ROOT;
		if (!root) {
			throw new Error(
				"FILES_SDK_ROOT is required. Load an AgentPond filesystem environment before starting Eve.",
			);
		}

		const files = new Files({ adapter: fs({ root }) });
		registerOTel({
			serviceName: agentName,
			instrumentations: [],
			spanProcessors: [
				new SimpleSpanProcessor(createFilesSpanExporter({ files })),
			],
		});
	},
});
