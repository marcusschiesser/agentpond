import {
	AcceptedEventWriter,
	type AgentPondConfig,
	type BatchManifest,
	type IngestionEvent,
	type ObjectStore,
} from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";

export async function writeOtelAndSyncCache(
	config: Pick<AgentPondConfig, "dbPath" | "projectId" | "s3">,
	store: ObjectStore,
	resourceSpans: unknown[],
) {
	const writer = new AcceptedEventWriter({
		store,
		projectId: config.projectId,
		prefix: config.s3.prefix,
	});
	const object = await writer.writeOtelResourceSpans(resourceSpans);
	const db = new AgentPondDuckDb(config.dbPath);
	try {
		await db.syncFromStore({
			store,
			projectId: config.projectId,
			prefix: config.s3.prefix,
		});
	} finally {
		await db.close();
	}
	return object;
}

export async function writeEventsAndSyncCache(
	config: Pick<AgentPondConfig, "dbPath" | "projectId" | "s3">,
	store: ObjectStore,
	events: IngestionEvent[],
): Promise<BatchManifest> {
	const writer = new AcceptedEventWriter({
		store,
		projectId: config.projectId,
		prefix: config.s3.prefix,
	});
	const manifest = await writer.writeAcceptedEvents(events);
	const db = new AgentPondDuckDb(config.dbPath);
	try {
		await db.syncFromStore({
			store,
			projectId: config.projectId,
			prefix: config.s3.prefix,
		});
	} finally {
		await db.close();
	}
	return manifest;
}
