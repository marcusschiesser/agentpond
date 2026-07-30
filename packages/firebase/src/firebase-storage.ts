import { normalizePrefix, type ObjectStore } from "@agentpond/core";
import { FilesObjectStore } from "@agentpond/files-sdk";
import {
	type FirebaseStorageAdapterOptions,
	firebaseStorage,
} from "files-sdk/firebase-storage";
import {
	type FirebaseStorage,
	firebaseStorageForAppOptions,
	firebaseStorageForInitializedApp,
} from "./firebase-admin.js";
import {
	type FirebaseCliProjectConfig,
	firebaseFunctionsSourceDirectories,
} from "./firebase-env.js";

export const defaultFirebaseStoragePrefix = "agentpond";

export type FirebaseStorageObjectStoreConfig = {
	bucket?: string;
};

export function createFirebaseStorageStoreFromConfig(
	options: FirebaseStorageObjectStoreConfig = {},
): FilesObjectStore {
	return createFirebaseStorageStoreForBucket(
		firebaseStorageForInitializedApp().bucket(options.bucket),
	);
}

export async function createFirebaseStorageStoreFromCliProject(
	project: FirebaseCliProjectConfig,
	dependencies: {
		createStore?: (
			bucket: ReturnType<FirebaseStorage["bucket"]>,
		) => ObjectStore;
	} = {},
): Promise<ObjectStore> {
	const moduleDirectories = firebaseFunctionsSourceDirectories(project.root);
	const storage = firebaseStorageForAppOptions(
		{
			projectId: project.projectId,
			...(project.bucket ? { storageBucket: project.bucket } : {}),
		},
		"Firebase Admin is required for AgentPond Firebase storage; install firebase-admin in the Firebase project and authenticate with credentials supported by Firebase Admin",
		{ moduleDirectories },
	);
	const createStore =
		dependencies.createStore ?? createFirebaseStorageStoreForBucket;
	const stores = firebaseCliBucketCandidates(project).map((bucketName) =>
		createStore(storage.bucket(bucketName)),
	);
	return await selectFirebaseCliStore(
		stores,
		normalizePrefix(defaultFirebaseStoragePrefix),
	);
}

function createFirebaseStorageStoreForBucket(
	bucket: ReturnType<FirebaseStorage["bucket"]>,
): FilesObjectStore {
	return FilesObjectStore.fromAdapter(
		firebaseStorage({
			app: bucket as unknown as NonNullable<
				FirebaseStorageAdapterOptions["app"]
			>,
		}),
	);
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
	stores: ObjectStore[],
	prefix: string,
): Promise<ObjectStore> {
	let firstExistingStore: ObjectStore | undefined;
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
	if (maybeCode === 404 || maybeCode === "404" || maybeCode === "NotFound") {
		return true;
	}
	return isMissingBucketError((error as { cause?: unknown }).cause);
}
