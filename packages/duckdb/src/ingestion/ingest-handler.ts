import { type BatchResult, parseIngestionEvents } from "@agentpond/core";
import type { DuckDbDirectIngestion } from "./direct-ingestion.js";

export class DuckDbIngestionWriter {
	constructor(
		private readonly ingestion: DuckDbDirectIngestion,
		private readonly afterWrite?: () => Promise<void>,
	) {}

	async processBatch(params: {
		projectId: string;
		prefix: string;
		batch: unknown[];
	}): Promise<BatchResult> {
		const { events, errors } = parseIngestionEvents(params.batch);
		if (events.length > 0) {
			try {
				await this.ingestion.writeEvents({
					projectId: params.projectId,
					events,
					source: "dev-ingestion",
				});
			} finally {
				await this.afterWrite?.();
			}
		}
		return {
			successes: events.map((event) => ({ id: event.id, status: 201 })),
			errors,
		};
	}

	async writeOtelResourceSpans(params: {
		projectId: string;
		prefix: string;
		resourceSpans: unknown[];
	}): Promise<void> {
		try {
			await this.ingestion.writeOtelResourceSpans({
				projectId: params.projectId,
				resourceSpans: params.resourceSpans,
				source: "dev-otel",
			});
		} finally {
			await this.afterWrite?.();
		}
	}
}
