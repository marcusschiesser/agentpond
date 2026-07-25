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
		"references/firebase.md",
		"references/supabase.md",
		"references/vercel.md",
	]);

	assert.match(content, /agentpond env use <alias-or-project-id>/);
	assert.match(content, /agentpond env use <environment>/);
	assert.match(content, /agentpond env use <project-ref>/);
	assert.match(content, /agentpond --env staging/);
	assert.match(content, /--platform supabase/);
	assert.match(content, /vercel-project-id>-<target>/);
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

test("analytics skill keeps provider access in separate references", () => {
	const entry = readSkillFiles("agentpond", ["SKILL.md"]);
	const firebase = readSkillFiles("agentpond", ["references/firebase.md"]);
	const supabase = readSkillFiles("agentpond", ["references/supabase.md"]);
	const vercel = readSkillFiles("agentpond", ["references/vercel.md"]);

	assert.match(entry, /references\/firebase\.md/);
	assert.match(entry, /references\/supabase\.md/);
	assert.match(entry, /references\/vercel\.md/);
	assert.match(firebase, /agentpond env use <alias-or-project-id>/);
	assert.match(firebase, /agentpond --env staging sync/);
	assert.match(firebase, /manual environment operations/);
	assert.doesNotMatch(firebase, /Supabase/);
	assert.doesNotMatch(firebase, /Vercel/);
	assert.match(supabase, /supabase link --project-ref <project-ref>/);
	assert.match(supabase, /agentpond --env <project-ref> sync/);
	assert.match(supabase, /manual environment operations/);
	assert.doesNotMatch(supabase, /Firebase/);
	assert.doesNotMatch(supabase, /Vercel/);
	assert.match(vercel, /vercel target list --format json/);
	assert.match(vercel, /agentpond env use staging/);
	assert.match(vercel, /manual environment operations/);
	assert.doesNotMatch(vercel, /Firebase/);
	assert.doesNotMatch(vercel, /Supabase/);
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
		/agentpond env use <alias-or-project-id>/,
		/agentpond traces list --limit 10/,
	]) {
		assert.match(content, required);
	}
	assert.doesNotMatch(content, /new SimpleSpanProcessor/);
});

test("Vercel instrumentation skill uses direct target-aware Blob export", () => {
	const content = readSkillFiles("agentpond-instrumentation", [
		"SKILL.md",
		"references/vercel.md",
		"references/openinference.md",
	]);

	for (const required of [
		/explicit confirmation/i,
		/createVercelSpanExporter/,
		/vercel blob create-store agentpond --access private/,
		/trusted Node\.js/i,
		/Edge Runtime/i,
		/agentpond\/otel\/<vercel-project-id>-<target>/,
		/VERCEL_TARGET_ENV/,
		/BatchSpanProcessor/,
		/after\(\)/,
		/waitUntil\(\)/,
		/one real request/i,
		/agentpond env use staging/,
	]) {
		assert.match(content, required);
	}
	assert.doesNotMatch(content, /handleIngestRequest/);
});

test("Supabase instrumentation skill covers hosted Edge and Node setup", () => {
	const content = readSkillFiles("agentpond-instrumentation", [
		"SKILL.md",
		"references/supabase.md",
		"references/openinference.md",
	]);

	for (const required of [
		/explicit confirmation/i,
		/createSupabaseSpanExporter/,
		/private bucket named `agentpond`/i,
		/storage\.buckets/,
		/RLS policies on `storage\.objects`/,
		/private buckets are not an unconditional deny/i,
		/SUPABASE_SECRET_KEYS/,
		/server-only environment configuration/,
		/BasicTracerProvider/,
		/BatchSpanProcessor/,
		/trace\.setGlobalTracerProvider\(provider\)/,
		/EdgeRuntime\.waitUntil/,
		/captures the CLI output only in\s+memory/i,
		/agentpond env use <project-ref>/,
		/agentpond --env <branch-project-ref> sync/,
		/one real AI request/i,
	]) {
		assert.match(content, required);
	}
	assert.doesNotMatch(content, /provider\.register\(\)/);
	assert.doesNotMatch(content, /handleIngestRequest/);
	assert.doesNotMatch(content, /supabase projects api-keys .*--reveal/);
});

test("instrumentation skill keeps provider setup details in separate references", () => {
	const entry = readSkillFiles("agentpond-instrumentation", ["SKILL.md"]);
	const firebase = readSkillFiles("agentpond-instrumentation", [
		"references/firebase.md",
	]);
	const supabase = readSkillFiles("agentpond-instrumentation", [
		"references/supabase.md",
	]);
	const vercel = readSkillFiles("agentpond-instrumentation", [
		"references/vercel.md",
	]);

	assert.match(entry, /references\/firebase\.md/);
	assert.match(entry, /references\/supabase\.md/);
	assert.match(entry, /references\/vercel\.md/);
	assert.match(firebase, /createFirebaseSpanExporter/);
	assert.doesNotMatch(firebase, /Supabase/);
	assert.doesNotMatch(firebase, /Vercel/);
	assert.match(supabase, /createSupabaseSpanExporter/);
	assert.doesNotMatch(supabase, /Firebase/);
	assert.doesNotMatch(supabase, /Vercel/);
	assert.match(vercel, /createVercelSpanExporter/);
	assert.doesNotMatch(vercel, /Firebase/);
	assert.doesNotMatch(vercel, /Supabase/);
});
