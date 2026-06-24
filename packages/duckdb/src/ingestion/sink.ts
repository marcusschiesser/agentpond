import type { IngestionEvent } from "@agentpond/core";
import { AgentPondCache } from "../cache/index.js";
import type { DuckDbDirectIngestion } from "./direct-ingestion.js";
import type { DirectWriteResult } from "./direct-ingestion.js";

export class DuckDbIngestionSink {
	constructor(private readonly dbPath: string) {}

	async writeEvents(params: {
		projectId: string;
		prefix: string;
		events: IngestionEvent[];
		source?: string;
	}): Promise<DirectWriteResult> {
		return withDirectIngestion(this.dbPath, (sink) =>
			sink.writeEvents({
				projectId: params.projectId,
				events: params.events,
				source: params.source ?? "dev-ingestion",
			}),
		);
	}

	async writeOtelResourceSpans(params: {
		projectId: string;
		prefix: string;
		resourceSpans: unknown[];
		source?: string;
	}): Promise<DirectWriteResult> {
		return withDirectIngestion(this.dbPath, (sink) =>
			sink.writeOtelResourceSpans({
				projectId: params.projectId,
				resourceSpans: params.resourceSpans,
				source: params.source ?? "dev-otel",
			}),
		);
	}
}

async function withDirectIngestion<T>(
	dbPath: string,
	write: (ingestion: DuckDbDirectIngestion) => Promise<T>,
): Promise<T> {
	const db = new AgentPondCache(dbPath);
	try {
		return await write(db.directIngestion());
	} finally {
		await db.close();
	}
}
