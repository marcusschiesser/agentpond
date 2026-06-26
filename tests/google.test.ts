import assert from "node:assert/strict";
import test from "node:test";
import { GcsObjectStore } from "@agentpond/google";

test("GCS object store writes, reads, and lists JSON objects", async () => {
	const objects = new Map<string, string>();
	const store = new GcsObjectStore(
		{ bucket: "agentpond" },
		{
			bucket: () => ({
				file: (name: string) => ({
					save: async (data: string, options: { contentType: string }) => {
						assert.equal(options.contentType, "application/json");
						objects.set(name, data);
					},
					download: async () => [Buffer.from(objects.get(name) ?? "", "utf8")],
				}),
				getFiles: async ({ prefix }: { prefix: string }) => [
					[...objects.keys()]
						.filter((key) => key.startsWith(prefix))
						.map((name) => ({ name })),
				],
			}),
		},
	);

	await store.putJson("project-a/trace/trace-1/event.json", { ok: true });
	await store.putJson("project-a/trace/trace-2/event.json", { ok: 2 });

	assert.deepEqual(await store.getJson("project-a/trace/trace-1/event.json"), {
		ok: true,
	});
	assert.deepEqual(await store.listKeys("project-a/trace/"), [
		"project-a/trace/trace-1/event.json",
		"project-a/trace/trace-2/event.json",
	]);
});
