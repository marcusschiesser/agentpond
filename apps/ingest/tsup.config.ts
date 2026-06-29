import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node24",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	splitting: false,
	banner: {
		js: [
			"import { createRequire as __agentpondCreateRequire } from 'node:module';",
			"const require = __agentpondCreateRequire(import.meta.url);",
		].join("\n"),
	},
});
