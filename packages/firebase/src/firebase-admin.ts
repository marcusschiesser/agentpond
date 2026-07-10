import { createRequire } from "node:module";
import { join } from "node:path";
import type { AppOptions, getApps, initializeApp } from "firebase-admin/app";
import type {
	Storage as FirebaseAdminStorage,
	getStorage,
} from "firebase-admin/storage";

type FirebaseAppModule = {
	getApps: typeof getApps;
	initializeApp: typeof initializeApp;
};

export type FirebaseStorage = FirebaseAdminStorage;

export type FirebaseAdminModuleResolutionOptions = {
	moduleDirectories?: readonly string[];
};

export function firebaseStorageForInitializedApp(
	resolution?: FirebaseAdminModuleResolutionOptions,
): FirebaseStorage {
	try {
		return requireFirebaseAdminStorage(resolution).getStorage();
	} catch (error) {
		throw new Error(
			`Firebase Admin is required for FirebaseStorageObjectStore.fromConfig(); install firebase-admin and call initializeApp() before creating the store. ${errorDetail(error)}`,
			{ cause: error },
		);
	}
}

export function firebaseStorageForAppOptions(
	options: AppOptions,
	errorMessage: string,
	resolution?: FirebaseAdminModuleResolutionOptions,
): FirebaseStorage {
	try {
		ensureDefaultFirebaseApp(options, resolution);
		return requireFirebaseAdminStorage(resolution).getStorage();
	} catch (error) {
		throw new Error(`${errorMessage}. ${errorDetail(error)}`, {
			cause: error,
		});
	}
}

function ensureDefaultFirebaseApp(
	options: AppOptions,
	resolution?: FirebaseAdminModuleResolutionOptions,
): void {
	const app = requireFirebaseAdminApp(resolution);
	if (app.getApps().length > 0) return;
	app.initializeApp(options);
}

function requireFirebaseAdminStorage(
	resolution?: FirebaseAdminModuleResolutionOptions,
): { getStorage: typeof getStorage } {
	return requireFirebaseAdminModule("firebase-admin/storage", resolution) as {
		getStorage: typeof getStorage;
	};
}

function requireFirebaseAdminApp(
	resolution?: FirebaseAdminModuleResolutionOptions,
): FirebaseAppModule {
	return requireFirebaseAdminModule(
		"firebase-admin/app",
		resolution,
	) as FirebaseAppModule;
}

function requireFirebaseAdminModule(
	moduleName: string,
	resolution: FirebaseAdminModuleResolutionOptions = {},
): unknown {
	const directories = [
		...new Set([...(resolution.moduleDirectories ?? []), process.cwd()]),
	];
	let lastError: unknown;
	for (const directory of directories) {
		try {
			return createRequire(join(directory, "package.json"))(moduleName);
		} catch (error) {
			if (!isMissingRequestedModule(error, moduleName)) throw error;
			lastError = error;
		}
	}

	throw new Error(
		`Could not find ${moduleName}. AgentPond checked Firebase Functions source directories declared in firebase.json and the current working directory. Install firebase-admin in a declared Functions source package, or add firebase-admin to this workspace's devDependencies.`,
		{ cause: lastError },
	);
}

function errorDetail(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Unknown Firebase Admin error";
}

function isMissingRequestedModule(error: unknown, moduleName: string): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { code?: unknown }).code === "MODULE_NOT_FOUND" &&
		error.message.includes(moduleName)
	);
}
