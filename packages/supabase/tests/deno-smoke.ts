import {
	createSupabaseSpanExporter,
	supabaseStorageConfigFromEnv,
} from "../dist/index.js";

const projectRef = "abcdefghijklmnopqrst";
const env = {
	SUPABASE_URL: `https://${projectRef}.supabase.co`,
	SUPABASE_SECRET_KEYS: JSON.stringify({
		default: "sb_secret_deno_edge_smoke",
	}),
};
const config = supabaseStorageConfigFromEnv(env);
if (config.url !== env.SUPABASE_URL || config.bucket !== "agentpond") {
	throw new Error("Supabase Edge-style environment configuration failed");
}

const exporter = createSupabaseSpanExporter({ env });
await exporter.shutdown();
