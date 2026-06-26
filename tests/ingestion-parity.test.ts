import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AgentPondConfig,
	type BatchManifest,
	MemoryObjectStore,
} from "@agentpond/core";
import { buildServer } from "@agentpond/ingest";

type FixtureObject = {
	key: string;
	value: unknown;
};

type ParityFixture = {
	projectId: string;
	prefix: string;
	nonOtel: {
		input: { batch: unknown[] };
		expectedObjects: FixtureObject[];
	};
	otel: {
		input: { resourceSpans: unknown[] };
		expectedObject: {
			keyPattern: string;
			value: unknown;
		};
	};
	otelProtobuf: {
		payloadBase64: string;
		expectedObject: {
			keyPattern: string;
			value: unknown;
		};
	};
};

const fixture = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"fixtures/langfuse-ingestion-parity.json",
		),
		"utf8",
	),
) as ParityFixture;

const config: AgentPondConfig = {
	projectId: fixture.projectId,
	dbPath: "/tmp/agentpond-parity-test.duckdb",
	prefix: fixture.prefix,
	s3: {
		bucket: "agentpond",
		region: "us-east-1",
		forcePathStyle: true,
	},
	gcs: {
		bucket: "agentpond",
	},
	auth: {
		projectId: fixture.projectId,
		publicKey: "pk",
		secretKey: "sk",
	},
};

function authHeader(): string {
	return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("non-OTEL ingestion stores Langfuse-compatible event payload objects and AgentPond manifests", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({ config, store });
	try {
		const response = await server.inject({
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			payload: JSON.stringify(fixture.nonOtel.input),
		});

		assert.equal(response.statusCode, 207);
		assert.deepEqual(
			response.json().successes.map((success: { id: string }) => success.id),
			fixture.nonOtel.input.batch.map((event) => (event as { id: string }).id),
		);

		for (const expected of fixture.nonOtel.expectedObjects) {
			assert.deepEqual(await store.getJson(expected.key), expected.value);
		}

		const payloadKeys = (
			await Promise.all([
				store.listKeys(`${fixture.prefix}${fixture.projectId}/trace/`),
				store.listKeys(`${fixture.prefix}${fixture.projectId}/observation/`),
				store.listKeys(`${fixture.prefix}${fixture.projectId}/score/`),
			])
		)
			.flat()
			.sort();
		assert.deepEqual(
			payloadKeys,
			fixture.nonOtel.expectedObjects.map((object) => object.key).sort(),
		);

		const manifestKeys = await store.listKeys(
			`${fixture.prefix}${fixture.projectId}/manifests/`,
		);
		assert.equal(manifestKeys.length, 1);
		const manifest = await store.getJson<BatchManifest>(manifestKeys[0]);
		assert.deepEqual(
			manifest.objects.map((object) => object.key).sort(),
			payloadKeys,
		);
	} finally {
		await server.close();
	}
});

test("OTEL ingestion stores raw Langfuse-compatible resourceSpans without an AgentPond manifest", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({ config, store });
	try {
		const response = await server.inject({
			method: "POST",
			url: "/api/public/otel/v1/traces",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
				"x-langfuse-ingestion-version": "4",
			},
			payload: JSON.stringify(fixture.otel.input),
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(
			await store.listKeys(`${fixture.prefix}${fixture.projectId}/trace/`),
			[],
		);
		assert.deepEqual(
			await store.listKeys(
				`${fixture.prefix}${fixture.projectId}/observation/`,
			),
			[],
		);

		const otelKeys = await store.listKeys(`${fixture.prefix}otel/`);
		assert.equal(otelKeys.length, 1);
		assert.match(
			otelKeys[0],
			new RegExp(fixture.otel.expectedObject.keyPattern),
		);
		assert.deepEqual(
			await store.getJson(otelKeys[0]),
			fixture.otel.expectedObject.value,
		);

		assert.deepEqual(
			await store.listKeys(`${fixture.prefix}${fixture.projectId}/manifests/`),
			[],
		);
	} finally {
		await server.close();
	}
});

test("protobuf OTEL ingestion stores Langfuse-compatible decoded resourceSpans without an AgentPond manifest", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({ config, store });
	try {
		const response = await server.inject({
			method: "POST",
			url: "/api/public/otel/v1/traces",
			headers: {
				authorization: authHeader(),
				"content-type": "application/x-protobuf",
			},
			payload: Buffer.from(fixture.otelProtobuf.payloadBase64, "base64"),
		});

		assert.equal(response.statusCode, 200);
		const otelKeys = await store.listKeys(`${fixture.prefix}otel/`);
		assert.equal(otelKeys.length, 1);
		assert.match(
			otelKeys[0],
			new RegExp(fixture.otelProtobuf.expectedObject.keyPattern),
		);
		assert.deepEqual(
			await store.getJson(otelKeys[0]),
			fixture.otelProtobuf.expectedObject.value,
		);

		assert.deepEqual(
			await store.listKeys(`${fixture.prefix}${fixture.projectId}/manifests/`),
			[],
		);
	} finally {
		await server.close();
	}
});
