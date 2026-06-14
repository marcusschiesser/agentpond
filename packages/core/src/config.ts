import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type S3Config = {
  bucket: string;
  prefix: string;
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
};

export type AuthConfig = {
  projectId: string;
  publicKey: string;
  secretKey: string;
};

export type ApertoConfig = {
  projectId: string;
  dbPath: string;
  s3: S3Config;
  auth?: AuthConfig;
};

export function loadEnvFile(filePath: string): void {
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

export function configFromEnv(overrides: Partial<{
  dbPath: string;
  s3Bucket: string;
  s3Prefix: string;
  s3Endpoint: string;
}> = {}): ApertoConfig {
  const projectId = process.env.APERTO_PROJECT_ID ?? "default-project";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? process.env.APERTO_PUBLIC_KEY ?? "pk-aperto";
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? process.env.APERTO_SECRET_KEY ?? "sk-aperto";

  return {
    projectId,
    dbPath: overrides.dbPath ?? process.env.APERTO_DB ?? join(homedir(), ".aperto", "cache.duckdb"),
    s3: {
      bucket: overrides.s3Bucket ?? process.env.APERTO_S3_BUCKET ?? process.env.S3_BUCKET ?? "aperto",
      prefix: normalizePrefix(overrides.s3Prefix ?? process.env.APERTO_S3_PREFIX ?? ""),
      endpoint: overrides.s3Endpoint ?? process.env.APERTO_S3_ENDPOINT ?? process.env.S3_ENDPOINT,
      region: process.env.AWS_REGION ?? process.env.APERTO_S3_REGION ?? "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? process.env.APERTO_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? process.env.APERTO_S3_SECRET_ACCESS_KEY,
      forcePathStyle: (process.env.APERTO_S3_FORCE_PATH_STYLE ?? "true") !== "false",
    },
    auth: {
      projectId,
      publicKey,
      secretKey,
    },
  };
}

export function normalizePrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}
