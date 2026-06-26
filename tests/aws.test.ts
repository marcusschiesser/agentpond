import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { s3ConfigFromEnv } from "@agentpond/aws";

test("S3 config reads provider settings from env files below process env", () => {
	const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
	const originalSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
	const originalRegion = process.env.AWS_REGION;
	const envFile = join(
		mkdtempSync(join(tmpdir(), "agentpond-aws-")),
		"aws.env",
	);
	writeFileSync(
		envFile,
		[
			"AGENTPOND_S3_BUCKET=file-bucket",
			"AGENTPOND_S3_ENDPOINT=http://localhost:9000",
			"AGENTPOND_S3_REGION=us-east-1",
			"AGENTPOND_S3_ACCESS_KEY_ID=file-access",
			"AGENTPOND_S3_SECRET_ACCESS_KEY=file-secret",
			"AGENTPOND_S3_FORCE_PATH_STYLE=false",
			"",
		].join("\n"),
		"utf8",
	);

	try {
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
		delete process.env.AWS_REGION;

		assert.deepEqual(s3ConfigFromEnv(envFile), {
			bucket: "file-bucket",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
			accessKeyId: "file-access",
			secretAccessKey: "file-secret",
			forcePathStyle: false,
		});

		process.env.AWS_ACCESS_KEY_ID = "process-access";
		process.env.AWS_SECRET_ACCESS_KEY = "process-secret";
		process.env.AWS_REGION = "eu-central-1";

		assert.deepEqual(s3ConfigFromEnv(envFile), {
			bucket: "file-bucket",
			endpoint: "http://localhost:9000",
			region: "eu-central-1",
			accessKeyId: "process-access",
			secretAccessKey: "process-secret",
			forcePathStyle: false,
		});
	} finally {
		restoreEnv("AWS_ACCESS_KEY_ID", originalAccessKey);
		restoreEnv("AWS_SECRET_ACCESS_KEY", originalSecretKey);
		restoreEnv("AWS_REGION", originalRegion);
	}
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}
