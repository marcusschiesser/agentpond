export function devSdkEnvironment(host: string, port: number): EnvVar[] {
	return [
		{ key: "LANGFUSE_BASE_URL", value: `http://${host}:${port}` },
		{ key: "LANGFUSE_PUBLIC_KEY", value: "pk-agentpond-dev" },
		{ key: "LANGFUSE_SECRET_KEY", value: "sk-agentpond-dev" },
	];
}

export type EnvVar = {
	key: string;
	value: string;
};
