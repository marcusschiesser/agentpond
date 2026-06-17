#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "../src/index.ts");
const result = spawnSync(
	process.execPath,
	["--import", "tsx", entry, ...process.argv.slice(2)],
	{
		stdio: "inherit",
	},
);

process.exit(result.status ?? 1);
