import {
	AcceptedEventWriter,
	type AgentPondConfig,
	type BatchManifest,
	type IngestionEvent,
	type OtelStorageObject,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import type { ObjectStorageContext } from "./object-store.js";

export async function writeOtelAndSyncCache(
	config: AgentPondConfig,
	storage: ObjectStorageContext,
	resourceSpans: unknown[],
): Promise<OtelStorageObject | undefined> {
	return writeAndSyncCache(config, storage, (writer) =>
		writer.writeOtelResourceSpans(resourceSpans),
	);
}

export async function writeEventsAndSyncCache(
	config: AgentPondConfig,
	storage: ObjectStorageContext,
	events: IngestionEvent[],
): Promise<BatchManifest> {
	return writeAndSyncCache(config, storage, (writer) =>
		writer.writeAcceptedEvents(events),
	);
}

async function writeAndSyncCache<T>(
	config: AgentPondConfig,
	storage: ObjectStorageContext,
	write: (writer: AcceptedEventWriter) => Promise<T>,
): Promise<T> {
	const writer = new AcceptedEventWriter({
		store: storage.store,
		projectId: storage.projectId,
		prefix: storage.prefix,
	});
	const result = await write(writer);
	const db = new AgentPondCache(config.dbPath);
	try {
		await db.syncFromStore({
			store: storage.store,
			projectId: storage.projectId,
			prefix: storage.prefix,
		});
	} finally {
		await db.close();
	}
	return result;
}
