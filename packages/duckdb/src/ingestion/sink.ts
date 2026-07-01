import {
	type IngestionEvent,
	type IngestionSink,
	resolveAgentPondEnvironment,
} from "@agentpond/core";
import { AgentPondCache } from "../cache/index.js";
import { withDuckDbWriteLock } from "../cache/write-lock.js";
import type {
	DirectWriteResult,
	DuckDbDirectIngestion,
} from "./direct-ingestion.js";

export class DuckDbIngestionSink implements IngestionSink {
	static fromAgentPondEnv(name: string): DuckDbIngestionSink {
		return new DuckDbIngestionSink(
			resolveAgentPondEnvironment({ name }).dbPath,
		);
	}

	constructor(private readonly dbPath: string) {}

	async writeEvents(params: {
		projectId: string;
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
	return withDuckDbWriteLock(dbPath, async () => {
		const db = new AgentPondCache(dbPath);
		try {
			await db.ensureSchema();
			return await write(db.directIngestion());
		} finally {
			await db.close();
		}
	});
}
