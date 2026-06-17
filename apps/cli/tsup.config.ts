import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node20",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	splitting: false,
	noExternal: [/^@agentpond\//],
	external: ["duckdb"],
});
