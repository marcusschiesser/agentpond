import {
	AcceptedEventWriter,
	type AgentPondConfig,
	type AgentPondStorageContext,
	type BatchManifest,
	type IngestionEvent,
	type OtelStorageObject,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";

export async function writeOtelAndSyncCache(
	config: AgentPondConfig,
	storage: AgentPondStorageContext,
	resourceSpans: unknown[],
): Promise<OtelStorageObject | undefined> {
	return writeAndSyncCache(config, storage, (writer) =>
		writer.writeOtelResourceSpans(resourceSpans),
	);
}

export async function writeEventsAndSyncCache(
	config: AgentPondConfig,
	storage: AgentPondStorageContext,
	events: IngestionEvent[],
): Promise<BatchManifest> {
	return writeAndSyncCache(config, storage, (writer) =>
		writer.writeAcceptedEvents(events),
	);
}

async function writeAndSyncCache<T>(
	config: AgentPondConfig,
	storage: AgentPondStorageContext,
	write: (writer: AcceptedEventWriter) => Promise<T>,
): Promise<T> {
	const writer = new AcceptedEventWriter(storage);
	const result = await write(writer);
	const db = new AgentPondCache(config.dbPath);
	try {
		await db.syncFromStore(storage);
	} finally {
		await db.close();
	}
	return result;
}
