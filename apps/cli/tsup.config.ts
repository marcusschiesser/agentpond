import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node22",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	splitting: false,
	external: ["@duckdb/node-api", "@duckdb/node-bindings"],
});
