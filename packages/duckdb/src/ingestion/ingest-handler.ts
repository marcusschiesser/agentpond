import { type BatchResult, parseIngestionEvents } from "@agentpond/core";
import type { DuckDbDirectIngestion } from "./direct-ingestion.js";

export class DuckDbIngestionWriter {
	constructor(private readonly ingestion: DuckDbDirectIngestion) {}

	async processBatch(params: {
		projectId: string;
		prefix: string;
		batch: unknown[];
	}): Promise<BatchResult> {
		const { events, errors } = parseIngestionEvents(params.batch);
		if (events.length > 0) {
			await this.ingestion.writeEvents({
				projectId: params.projectId,
				events,
				source: "dev-ingestion",
			});
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
		await this.ingestion.writeOtelResourceSpans({
			projectId: params.projectId,
			resourceSpans: params.resourceSpans,
			source: "dev-otel",
		});
	}
}
