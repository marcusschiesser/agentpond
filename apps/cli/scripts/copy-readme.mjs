import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

copyFileSync(
	resolve(__dirname, "../../../README.md"),
	resolve(__dirname, "../README.md"),
);
