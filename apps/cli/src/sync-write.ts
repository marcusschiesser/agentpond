import {
	AcceptedEventWriter,
	type AgentPondConfig,
	type BatchManifest,
	type IngestionEvent,
	type ObjectStore,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";

export async function writeOtelAndSyncCache(
	config: AgentPondConfig,
	store: ObjectStore,
	resourceSpans: unknown[],
) {
	const writer = new AcceptedEventWriter({
		store,
		projectId: config.projectId,
		prefix: config.prefix,
	});
	const object = await writer.writeOtelResourceSpans(resourceSpans);
	const db = new AgentPondCache(config.dbPath);
	try {
		await db.syncFromStore({
			store,
			projectId: config.projectId,
			prefix: config.prefix,
		});
	} finally {
		await db.close();
	}
	return object;
}

export async function writeEventsAndSyncCache(
	config: AgentPondConfig,
	store: ObjectStore,
	events: IngestionEvent[],
): Promise<BatchManifest> {
	const writer = new AcceptedEventWriter({
		store,
		projectId: config.projectId,
		prefix: config.prefix,
	});
	const manifest = await writer.writeAcceptedEvents(events);
	const db = new AgentPondCache(config.dbPath);
	try {
		await db.syncFromStore({
			store,
			projectId: config.projectId,
			prefix: config.prefix,
		});
	} finally {
		await db.close();
	}
	return manifest;
}
