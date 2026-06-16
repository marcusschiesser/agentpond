import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { getActiveTraceId, propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

const SCORE_NAME = "human-quality";
const SCORE_VALUE = 1;
const SCORE_COMMENT = "Human review: answer is accurate and actionable.";

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});
const langfuse = new LangfuseClient();

sdk.start();

async function answerCheckoutQuestion(exampleLanguage: string) {
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
        exampleLanguage,
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
          exampleLanguage,
          feature: "checkout-support",
          release: "2026-06-15",
        },
      },
      async () => {
        await startActiveObservation("load customer order context", async (span) => {
          span.update({
            input: { user_id: "user_42", order_id: "ord_2026_001" },
            output: {
              payment_status: "declined",
              decline_code: "insufficient_funds",
              attempts: 1,
            },
          });
        });

        await startActiveObservation(
          "draft support response",
          async (generation) => {
            generation.update({
              model: "gpt-5.5-mini",
              input: [
                {
                  role: "system",
                  content: "Answer checkout support questions with concise next steps.",
                },
                {
                  role: "user",
                  content: "Why was my card declined?",
                },
              ],
              output: {
                answer: "The bank declined the authorization. Try another card or contact your bank.",
                confidence: 0.92,
              },
              metadata: { provider: "example-fixture", temperature: 0.2 },
              usageDetails: { input: 38, output: 22, total: 60 },
            });
          },
          { asType: "generation" },
        );
      },
    );

    trace.update({
      output: {
        answer: "The bank declined the authorization. Try another card or contact your bank.",
        next_action: "retry_payment",
      },
    });
  });
  return traceId;
}

async function summarizeRefundPolicy(exampleLanguage: string) {
  let traceId: string | undefined;
  await startActiveObservation("refund policy trace", async (trace) => {
    traceId = getActiveTraceId();
    trace.update({
      input: {
        question: "Can I get a refund after the package ships?",
        order_status: "shipped",
      },
    });

    await propagateAttributes(
      {
        userId: "user_77",
        sessionId: "sdk-example-session",
        traceName: "refund policy trace",
        metadata: {
          example: "agentpond-typescript",
          exampleLanguage,
          feature: "policy-answer",
        },
      },
      async () => {
        await startActiveObservation(
          "summarize refund policy",
          async (generation) => {
            generation.update({
              model: "gpt-5.5-mini",
              input: "Summarize refund policy for a shipped package.",
              output: "Refunds are available after delivery if the item is returned within 30 days.",
              usageDetails: { input: 18, output: 16, total: 34 },
            });
          },
          { asType: "generation" },
        );
      },
    );

    trace.update({ output: { policy: "return_after_delivery", return_window_days: 30 } });
  });
  return traceId;
}

function createAnnotationScore(traceId: string, exampleLanguage: string) {
  langfuse.score.create({
    traceId,
    name: SCORE_NAME,
    value: SCORE_VALUE,
    dataType: "NUMERIC",
    comment: SCORE_COMMENT,
    metadata: {
      source: "ANNOTATION",
      annotator: "human-reviewer",
      exampleLanguage,
    },
  });
}

function requireTraceId(traceId: string | undefined, traceName: string): string {
  if (!traceId) throw new Error(`Langfuse SDK did not provide a trace id for ${traceName}`);
  return traceId;
}

function printSummary(traceIds: [string, string]) {
  const [checkoutTraceId, refundTraceId] = traceIds;
  console.log("Sent 2 TypeScript Langfuse SDK traces and 1 annotation score:");
  console.log(`- checkout support trace (${checkoutTraceId})`);
  console.log(`- refund policy trace (${refundTraceId})`);
  console.log(`- ${SCORE_NAME}=${SCORE_VALUE} on checkout support trace`);
  console.log("");
  console.log("Inspect checkout observations and scores:");
  console.log("pnpm cli sync");
  console.log(`pnpm cli observations list --traceId ${checkoutTraceId}`);
  console.log(`pnpm cli scores list --traceId ${checkoutTraceId}`);
}

async function main() {
  const exampleLanguage = "typescript";
  const traceIds: [string, string] = [
    requireTraceId(await answerCheckoutQuestion(exampleLanguage), "checkout support trace"),
    requireTraceId(await summarizeRefundPolicy(exampleLanguage), "refund policy trace"),
  ];
  createAnnotationScore(traceIds[0], exampleLanguage);
  await langfuse.flush();
  printSummary(traceIds);
}

main()
  .then(async () => {
    await sdk.shutdown();
    await langfuse.shutdown();
  })
  .catch(async (error) => {
    console.error(error);
    await sdk.shutdown();
    await langfuse.shutdown();
    process.exitCode = 1;
  });
