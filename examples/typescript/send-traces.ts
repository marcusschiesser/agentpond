import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
	getActiveTraceId,
	propagateAttributes,
	startActiveObservation,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

const SCORE_NAME = "human-quality";
const SCORE_VALUE = 1;
const SCORE_COMMENT = "Human review: answer is accurate and actionable.";
const COST_DETAILS = { input: 0.038, output: 0.044, total: 0.082 };

function requireLangfuseEnv() {
	const missing = [
		"LANGFUSE_BASE_URL",
		"LANGFUSE_PUBLIC_KEY",
		"LANGFUSE_SECRET_KEY",
	].filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new Error(
			`Missing required Langfuse environment variables: ${missing.join(", ")}. ` +
				"Set LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY before running this example.",
		);
	}
}

async function answerCheckoutQuestion() {
	let traceId: string | undefined;
	await startActiveObservation("checkout support trace", async (trace) => {
		traceId = getActiveTraceId();
		trace.update({
			input: {
				question: "Why was my card declined?",
				locale: "en-US",
				cart_total: 128.45,
			},
			metadata: {
				example: "agentpond-typescript",
				route: "/support/checkout",
				tenant: "acme-retail",
			},
		});

		await propagateAttributes(
			{
				userId: "user_42",
				sessionId: "sdk-example-session",
				traceName: "checkout support trace",
				metadata: {
					example: "agentpond-typescript",
					feature: "checkout-support",
					release: "2026-06-15",
				},
			},
			async () => {
				await startActiveObservation(
					"load customer order context",
					async (span) => {
						span.update({
							input: { user_id: "user_42", order_id: "ord_2026_001" },
							output: {
								payment_status: "declined",
								decline_code: "insufficient_funds",
								attempts: 1,
							},
						});
					},
				);

				await startActiveObservation(
					"draft support response",
					async (generation) => {
						generation.update({
							model: "gpt-5.5-mini",
							input: [
								{
									role: "system",
									content:
										"Answer checkout support questions with concise next steps.",
								},
								{
									role: "user",
									content: "Why was my card declined?",
								},
							],
							output: {
								answer:
									"The bank declined the authorization. Try another card or contact your bank.",
								confidence: 0.92,
							},
							metadata: { provider: "example-fixture", temperature: 0.2 },
							usageDetails: { input: 38, output: 22, total: 60 },
							costDetails: COST_DETAILS,
						});
					},
					{ asType: "generation" },
				);
			},
		);

		trace.update({
			output: {
				answer:
					"The bank declined the authorization. Try another card or contact your bank.",
				next_action: "retry_payment",
			},
		});
	});
	return traceId;
}

function createAnnotationScore(langfuse: LangfuseClient, traceId: string) {
	langfuse.score.create({
		traceId,
		name: SCORE_NAME,
		value: SCORE_VALUE,
		dataType: "NUMERIC",
		comment: SCORE_COMMENT,
		metadata: {
			source: "ANNOTATION",
			annotator: "human-reviewer",
		},
	});
}

function requireTraceId(
	traceId: string | undefined,
	traceName: string,
): string {
	if (!traceId)
		throw new Error(`Langfuse SDK did not provide a trace id for ${traceName}`);
	return traceId;
}

function printSummary(checkoutTraceId: string) {
	console.log("Sent 1 TypeScript Langfuse SDK trace and 1 annotation score:");
	console.log(`- checkout support trace (${checkoutTraceId})`);
	console.log(`- ${SCORE_NAME}=${SCORE_VALUE} on checkout support trace`);
	console.log(`- generation costDetails total: ${COST_DETAILS.total}`);
	console.log("");
	console.log("Inspect checkout trace cost, observations, and scores:");
	console.log("agentpond sync");
	console.log(`agentpond traces get ${checkoutTraceId}`);
	console.log(`agentpond observations list --traceId ${checkoutTraceId}`);
	console.log(`agentpond scores list --traceId ${checkoutTraceId}`);
}

async function main() {
	requireLangfuseEnv();

	const sdk = new NodeSDK({
		spanProcessors: [new LangfuseSpanProcessor()],
	});
	const langfuse = new LangfuseClient();

	sdk.start();
	try {
		const checkoutTraceId = requireTraceId(
			await answerCheckoutQuestion(),
			"checkout support trace",
		);
		createAnnotationScore(langfuse, checkoutTraceId);
		await langfuse.flush();
		printSummary(checkoutTraceId);
	} finally {
		await sdk.shutdown();
		await langfuse.shutdown();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
