import {
	type IngestionSink,
	normalizePrefix,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
} from "@agentpond/core";
import { type GcsBucket, GcsObjectStore } from "@agentpond/google";
import {
	type FirebaseStorage,
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

type FirebaseBucket = ReturnType<FirebaseStorage["bucket"]>;

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
			firebaseStorageForInitializedApp().bucket(config.bucket),
		);
	}

	static fromCliProject(
		project: FirebaseCliProjectConfig,
	): FirebaseStorageObjectStore {
		const storage = firebaseStorageForAppOptions(
			{
				projectId: project.projectId,
				storageBucket: project.bucket,
			},
			"Firebase Admin is required for FirebaseStorageObjectStore.fromCliProject(); install firebase-admin in the Firebase project and authenticate with credentials supported by Firebase Admin",
		);
		return new FirebaseStorageObjectStore(
			{ prefix: defaultFirebaseStoragePrefix },
			storage.bucket(),
		);
	}

	private constructor(
		readonly config: FirebaseStorageConfig,
		bucket: FirebaseBucket,
	) {
		this.store = GcsObjectStore.fromBucket(bucket as GcsBucket);
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
