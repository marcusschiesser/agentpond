type FirebaseRuntimeConfig = {
	projectId?: string;
	storageBucket?: string;
};

export function firebaseProjectIdFromEnv(
	env: NodeJS.ProcessEnv,
): string | undefined {
	return (
		firebaseRuntimeConfig(env.FIREBASE_CONFIG)?.projectId ??
		env.GCLOUD_PROJECT ??
		env.GCP_PROJECT ??
		env.GOOGLE_CLOUD_PROJECT
	);
}

export function firebaseRuntimeConfig(
	config: string | undefined,
): FirebaseRuntimeConfig | undefined {
	if (!config) return undefined;
	try {
		const parsed = JSON.parse(config) as {
			projectId?: unknown;
			storageBucket?: unknown;
		};
		return {
			...(typeof parsed.projectId === "string" && parsed.projectId
				? { projectId: parsed.projectId }
				: {}),
			...(typeof parsed.storageBucket === "string" && parsed.storageBucket
				? { storageBucket: parsed.storageBucket }
				: {}),
		};
	} catch {
		return undefined;
	}
}
