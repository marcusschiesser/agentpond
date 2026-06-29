import {
	AcceptedEventWriter,
	type AgentPondConfig,
	type BatchManifest,
	type IngestionEvent,
	type OtelStorageObject,
	type ObjectStore,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";

export async function writeOtelAndSyncCache(
	config: AgentPondConfig,
	store: ObjectStore,
	resourceSpans: unknown[],
): Promise<OtelStorageObject | undefined> {
	return writeAndSyncCache(config, store, (writer) =>
		writer.writeOtelResourceSpans(resourceSpans),
	);
}

export async function writeEventsAndSyncCache(
	config: AgentPondConfig,
	store: ObjectStore,
	events: IngestionEvent[],
): Promise<BatchManifest> {
	return writeAndSyncCache(config, store, (writer) =>
		writer.writeAcceptedEvents(events),
	);
}

async function writeAndSyncCache<T>(
	config: AgentPondConfig,
	store: ObjectStore,
	write: (writer: AcceptedEventWriter) => Promise<T>,
): Promise<T> {
	const writer = new AcceptedEventWriter({
		store,
		projectId: config.projectId,
		prefix: config.prefix,
	});
	const result = await write(writer);
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
	return result;
}
