import { createRequire } from "node:module";
import { join } from "node:path";
import type { AppOptions, getApps, initializeApp } from "firebase-admin/app";
import type {
	Storage as FirebaseAdminStorage,
	getStorage,
} from "firebase-admin/storage";

const require = createRequire(import.meta.url);

type FirebaseAppModule = {
	getApps: typeof getApps;
	initializeApp: typeof initializeApp;
};

export type FirebaseStorage = FirebaseAdminStorage;

export function firebaseStorageForInitializedApp(): FirebaseStorage {
	try {
		return requireFirebaseAdminStorage().getStorage();
	} catch (error) {
		throw new Error(
			"Firebase Admin is required for FirebaseStorageObjectStore.fromConfig(); install firebase-admin and call initializeApp() before creating the store",
			{ cause: error },
		);
	}
}

export function firebaseStorageForAppOptions(
	options: AppOptions,
	errorMessage: string,
): FirebaseStorage {
	try {
		ensureDefaultFirebaseApp(options);
		return requireFirebaseAdminStorage().getStorage();
	} catch (error) {
		throw new Error(errorMessage, { cause: error });
	}
}

function ensureDefaultFirebaseApp(options: AppOptions): void {
	const app = requireFirebaseAdminApp();
	if (app.getApps().length > 0) return;
	app.initializeApp(options);
}

function requireFirebaseAdminStorage(): { getStorage: typeof getStorage } {
	try {
		return createRequire(join(process.cwd(), "package.json"))(
			"firebase-admin/storage",
		) as { getStorage: typeof getStorage };
	} catch {
		return require("firebase-admin/storage") as {
			getStorage: typeof getStorage;
		};
	}
}

function requireFirebaseAdminApp(): FirebaseAppModule {
	try {
		return createRequire(join(process.cwd(), "package.json"))(
			"firebase-admin/app",
		) as FirebaseAppModule;
	} catch {
		return require("firebase-admin/app") as FirebaseAppModule;
	}
}
