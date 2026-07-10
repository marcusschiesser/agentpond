import type { IngestionSink, ObjectStore } from "@agentpond/core";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

export type AgentPondSpanExporterOptions = {
	store: ObjectStore;
	projectId: string;
	prefix?: string;
};

type ExportTraceServiceRequest = {
	resourceSpans?: unknown[];
};

export class AgentPondSpanExporter implements SpanExporter {
	private readonly sink: IngestionSink;
	private readonly pendingWrites = new Set<Promise<void>>();
	private stopped = false;
	private shutdownPromise?: Promise<void>;

	constructor(private readonly options: AgentPondSpanExporterOptions) {
		this.sink = options.store.toSink({ prefix: options.prefix });
	}

	export(
		spans: ReadableSpan[],
		resultCallback: (result: ExportResult) => void,
	): void {
		if (this.stopped) {
			resultCallback({
				code: ExportResultCode.FAILED,
				error: new Error("AgentPond span exporter is shut down"),
			});
			return;
		}

		const pendingWrite = this.writeSpans(spans).then(
			() => resultCallback({ code: ExportResultCode.SUCCESS }),
			(error: unknown) =>
				resultCallback({
					code: ExportResultCode.FAILED,
					error: errorForExportResult(error),
				}),
		);
		this.pendingWrites.add(pendingWrite);
		void pendingWrite.then(() => this.pendingWrites.delete(pendingWrite));
	}

	async forceFlush(): Promise<void> {
		while (this.pendingWrites.size > 0) {
			await Promise.all([...this.pendingWrites]);
		}
	}

	shutdown(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.stopped = true;
		this.shutdownPromise = this.forceFlush();
		return this.shutdownPromise;
	}

	private async writeSpans(spans: ReadableSpan[]): Promise<void> {
		if (spans.length === 0) return;

		const serialized = JsonTraceSerializer.serializeRequest(spans);
		if (!serialized) {
			throw new Error("Failed to serialize OpenTelemetry spans");
		}

		const request = JSON.parse(
			new TextDecoder().decode(serialized),
		) as ExportTraceServiceRequest;
		const resourceSpans = request.resourceSpans;
		if (!Array.isArray(resourceSpans)) {
			throw new Error("Serialized OpenTelemetry request has no resourceSpans");
		}
		if (resourceSpans.length === 0) return;

		await this.sink.writeOtelResourceSpans({
			projectId: this.options.projectId,
			resourceSpans,
		});
	}
}

function errorForExportResult(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
