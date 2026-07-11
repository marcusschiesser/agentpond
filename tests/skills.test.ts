import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSkillFiles(skill: string, files: string[]): string {
	return files
		.map((file) =>
			readFileSync(
				new URL(`../skills/${skill}/${file}`, import.meta.url),
				"utf8",
			),
		)
		.join("\n");
}

test("analytics skill is limited to selecting and inspecting existing data", () => {
	const content = readSkillFiles("agentpond", [
		"SKILL.md",
		"references/cli.md",
	]);

	assert.match(content, /firebase use <alias-or-project-id>/);
	assert.match(content, /agentpond env use <name>/);
	for (const forbidden of [
		/instrument/i,
		/OpenTelemetry/i,
		/exporter/i,
		/ingestion/i,
		/Storage Rules/i,
		/agentpond env get/i,
		/agentpond env init/i,
		/agentpond dev/i,
	]) {
		assert.doesNotMatch(content, forbidden);
	}
});

test("Firebase instrumentation skill preserves the setup and verification workflow", () => {
	const content = readSkillFiles("agentpond-instrumentation", [
		"SKILL.md",
		"references/firebase.md",
		"references/openinference.md",
	]);

	for (const required of [
		/explicit confirmation/i,
		/createFirebaseSpanExporter/,
		/getApp\(\)/,
		/named app/i,
		/trusted server/i,
		/Storage Rules/i,
		/nested block/i,
		/framework-native/i,
		/traceExporter/,
		/BatchSpanProcessor/,
		/CHAIN/,
		/TOOL/,
		/session\.id/,
		/force-flush/i,
		/one real AI request/i,
		/agentpond traces list --limit 10/,
	]) {
		assert.match(content, required);
	}
	assert.doesNotMatch(content, /new SimpleSpanProcessor/);
});
