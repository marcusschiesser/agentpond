import {
	type IngestionSink,
	normalizePrefix,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
} from "@agentpond/core";
import { type GcsBucket, GcsObjectStore } from "@agentpond/google";
import {
	firebaseStorageForAppOptions,
	firebaseStorageForInitializedApp,
} from "./firebase-admin.js";
import type { FirebaseCliProjectConfig } from "./firebase-env.js";

export const defaultFirebaseStoragePrefix = "agentpond";

export type FirebaseStorageConfig = {
	bucket?: string;
	prefix: string;
};

export type FirebaseStorageObjectStoreConfig = {
	bucket?: string;
	prefix?: string;
};

export class FirebaseStorageObjectStore implements ObjectStore {
	private readonly store: GcsObjectStore;

	static fromConfig(
		options: FirebaseStorageObjectStoreConfig = {},
	): FirebaseStorageObjectStore {
		const config = {
			...(options.bucket ? { bucket: options.bucket } : {}),
			prefix: options.prefix ?? defaultFirebaseStoragePrefix,
		};
		return new FirebaseStorageObjectStore(
			config,
			GcsObjectStore.fromBucket(
				firebaseStorageForInitializedApp().bucket(config.bucket) as GcsBucket,
			),
		);
	}

	static async fromCliProject(
		project: FirebaseCliProjectConfig,
	): Promise<FirebaseStorageObjectStore> {
		const storage = firebaseStorageForAppOptions(
			{
				projectId: project.projectId,
				...(project.bucket ? { storageBucket: project.bucket } : {}),
			},
			"Firebase Admin is required for FirebaseStorageObjectStore.fromCliProject(); install firebase-admin in the Firebase project and authenticate with credentials supported by Firebase Admin",
		);
		const stores = firebaseCliBucketCandidates(project).map((bucketName) =>
			GcsObjectStore.fromBucket(storage.bucket(bucketName) as GcsBucket),
		);
		const store = await selectFirebaseCliStore(
			stores,
			normalizePrefix(defaultFirebaseStoragePrefix),
		);
		return new FirebaseStorageObjectStore(
			{ prefix: defaultFirebaseStoragePrefix },
			store,
		);
	}

	private constructor(
		readonly config: FirebaseStorageConfig,
		store: GcsObjectStore,
	) {
		this.store = store;
	}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return this.store.toSink({
			...options,
			prefix: normalizePrefix(this.config.prefix),
		});
	}

	async putJson(key: string, value: unknown): Promise<void> {
		await this.store.putJson(key, value);
	}

	async getJson<T>(key: string): Promise<T> {
		return this.store.getJson<T>(key);
	}

	async listKeys(prefix: string): Promise<string[]> {
		return this.store.listKeys(prefix);
	}
}

function firebaseCliBucketCandidates(
	project: FirebaseCliProjectConfig,
): string[] {
	if (project.bucket) return [project.bucket];
	return [
		`${project.projectId}.appspot.com`,
		`${project.projectId}.firebasestorage.app`,
	];
}

async function selectFirebaseCliStore(
	stores: GcsObjectStore[],
	prefix: string,
): Promise<GcsObjectStore> {
	let firstExistingStore: GcsObjectStore | undefined;
	let lastMissingBucketError: unknown;
	for (const store of stores) {
		try {
			const keys = await store.listKeys(prefix);
			if (keys.length > 0) return store;
			firstExistingStore ??= store;
		} catch (error) {
			if (!isMissingBucketError(error)) throw error;
			lastMissingBucketError = error;
		}
	}
	if (firstExistingStore) return firstExistingStore;
	if (lastMissingBucketError) throw lastMissingBucketError;
	throw new Error("Firebase storage object store has no buckets");
}

function isMissingBucketError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const maybeCode = (error as { code?: unknown }).code;
	return maybeCode === 404 || maybeCode === "404";
}
