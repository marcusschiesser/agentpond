import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import OpenAI from "openai";

const MODEL = "gpt-5.4-mini";

function requireEnv() {
	const missing = [
		"OPENAI_API_KEY",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_PROTOCOL",
	].filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(", ")}. ` +
				'Set OPENAI_API_KEY and run eval "$(npx agentpond env get dev --otel)" before running this example.',
		);
	}
}

async function askOpenAI() {
	const client = new OpenAI();
	const completion = await client.chat.completions.create({
		model: MODEL,
		messages: [
			{
				role: "system",
				content: "Answer in one concise sentence.",
			},
			{
				role: "user",
				content: "What is one benefit of tracing LLM calls?",
			},
		],
	});
	return completion.choices[0]?.message.content;
}

function printSummary(answer: string | null | undefined) {
	console.log("OpenAI response:");
	console.log(answer ?? "(empty response)");
	console.log("");
	console.log("Inspect the latest OpenInference trace:");
	console.log("npx agentpond traces list --limit 1");
	console.log("Use that trace id to inspect observations:");
	console.log("npx agentpond observations list --traceId <trace-id>");
}

async function main() {
	requireEnv();

	new OpenAIInstrumentation().manuallyInstrument(OpenAI);

	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: "agentpond-openinference-typescript",
		}),
		traceExporter: new OTLPTraceExporter(),
	});

	sdk.start();
	try {
		printSummary(await askOpenAI());
	} finally {
		await sdk.shutdown();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
