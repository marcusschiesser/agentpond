import os

from openai import OpenAI
from openinference.instrumentation.openai import OpenAIInstrumentor
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

MODEL = "gpt-5.4-mini"


def require_env():
    missing = [
        key
        for key in (
            "OPENAI_API_KEY",
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            "OTEL_EXPORTER_OTLP_PROTOCOL",
        )
        if not os.getenv(key)
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}. "
            'Set OPENAI_API_KEY and run eval "$(npx agentpond env get dev --otel)" before running this example.'
        )


def configure_tracing():
    provider = TracerProvider(
        resource=Resource.create({"service.name": "agentpond-openinference-python"})
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    OpenAIInstrumentor().instrument()
    return provider


def ask_openai():
    client = OpenAI()
    completion = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": "Answer in one concise sentence.",
            },
            {
                "role": "user",
                "content": "What is one benefit of tracing LLM calls?",
            },
        ],
    )
    return completion.choices[0].message.content


def print_summary(answer):
    print("OpenAI response:")
    print(answer)
    print("")
    print("Inspect the latest OpenInference trace:")
    print("npx agentpond traces list --limit 1")
    print("Use that trace id to inspect observations:")
    print("npx agentpond observations list --traceId <trace-id>")


def main():
    require_env()
    provider = configure_tracing()
    try:
        print_summary(ask_openai())
    finally:
        provider.force_flush()
        provider.shutdown()


if __name__ == "__main__":
    main()
