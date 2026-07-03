export type EnvFamily = "all" | "otel" | "langfuse";

export function devSdkEnvironment(
	host: string,
	port: number,
	family: EnvFamily = "all",
): EnvVar[] {
	return filterEnvEntries(
		[
			{
				key: "OTEL_EXPORTER_OTLP_ENDPOINT",
				value: otelEndpoint(`http://${host}:${port}`),
			},
			{ key: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/json" },
			{ key: "LANGFUSE_BASE_URL", value: `http://${host}:${port}` },
			{ key: "LANGFUSE_PUBLIC_KEY", value: "pk-agentpond-dev" },
			{ key: "LANGFUSE_SECRET_KEY", value: "sk-agentpond-dev" },
		],
		family,
	);
}

export function filterEnvEntries(
	entries: EnvVar[],
	family: EnvFamily,
): EnvVar[] {
	if (family === "all") return entries;
	return entries.filter((entry) =>
		family === "otel"
			? entry.key.startsWith("OTEL_")
			: entry.key.startsWith("LANGFUSE_"),
	);
}

export function otelEndpoint(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/api/public/otel`;
}

export type EnvVar = {
	key: string;
	value: string;
};
