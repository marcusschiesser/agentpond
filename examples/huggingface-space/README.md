---
title: AgentPond Ingest
sdk: docker
app_port: 3000
---

# AgentPond on Hugging Face Spaces

Deploy AgentPond's ingestion container to a Hugging Face Docker Space and store traces in a Hugging Face Storage Bucket. Applications keep using normal Langfuse SDK environment variables, with `LANGFUSE_BASE_URL` pointed at the Hugging Face Space.

## References

- Hugging Face Docker Spaces: <https://huggingface.co/docs/hub/spaces-sdks-docker>
- Hugging Face CLI: <https://huggingface.co/docs/huggingface_hub/guides/cli>
- Hugging Face S3 buckets: <https://huggingface.co/docs/hub/storage-buckets-s3>

## Prerequisites

- `hf` CLI installed and authenticated with write access:

```sh
hf auth login
```

- Node.js 22 or newer for running AgentPond with `npx`.

## 1. Choose names

Use your Hugging Face username or organization as `HF_NAMESPACE`.

```sh
export HF_NAMESPACE=<namespace>
export HF_SPACE_NAME=agentpond-ingest
export HF_SPACE_ID="$HF_NAMESPACE/$HF_SPACE_NAME"
export HF_BUCKET=agentpond-traces
```

## 2. Create the bucket and Space

Create a private bucket for trace objects:

```sh
hf buckets create "$HF_NAMESPACE/$HF_BUCKET" --private --exist-ok
```

Create a public Docker Space. Do not make the Space private or protected for this basic example; the Langfuse SDK sends directly to the Space URL, and AgentPond handles request authentication with `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`.

```sh
hf repos create "$HF_SPACE_ID" \
  --type space \
  --space-sdk docker \
  --public \
  --exist-ok
```

## 3. Configure one AgentPond environment file

Initialize a local AgentPond environment:

```sh
npx agentpond env init hf-space --store s3
npx agentpond env use hf-space
```

Generate Hugging Face S3 credentials before editing the environment file:

1. Open <https://huggingface.co/settings/tokens>.
2. Create or select a write-capable token scoped to the target namespace and bucket.
3. Open the token dropdown and choose **Generate S3 credentials**.
4. Copy the generated access key ID (`HFAK...`) and secret access key. The secret is shown only once.

Replace `.agentpond/envs/hf-space.env` with the Space and bucket configuration:

```sh
cat > .agentpond/envs/hf-space.env <<EOF
AGENTPOND_PROJECT_ID=default-project
AGENTPOND_STORE=s3
AGENTPOND_S3_BUCKET=$HF_BUCKET
AGENTPOND_S3_ENDPOINT=https://s3.hf.co/$HF_NAMESPACE
AGENTPOND_S3_REGION=us-east-1
AGENTPOND_S3_FORCE_PATH_STYLE=true
AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

LANGFUSE_BASE_URL=https://${HF_NAMESPACE}-${HF_SPACE_NAME}.hf.space
LANGFUSE_PUBLIC_KEY=pk-agentpond-hf
LANGFUSE_SECRET_KEY=sk-replace-with-a-random-secret

AGENTPOND_S3_ACCESS_KEY_ID=<hf-s3-access-key>
AGENTPOND_S3_SECRET_ACCESS_KEY=<hf-s3-secret-key>
EOF
```

Use a real random `LANGFUSE_SECRET_KEY`. If your namespace or Space name contains characters that Hugging Face normalizes differently in subdomains, copy the direct Space URL from the Space page into `LANGFUSE_BASE_URL`.

Upload the whole file as Space secrets. This is simpler than splitting public variables and sensitive secrets, and every entry is available to the container as an environment variable.

```sh
hf spaces secrets add "$HF_SPACE_ID" --secrets-file .agentpond/envs/hf-space.env
```

## 4. Upload the Space files

From the repository root:

```sh
hf upload "$HF_SPACE_ID" examples/huggingface-space . --repo-type space
hf spaces wait "$HF_SPACE_ID" --timeout 10m
```

## 5. Send a Python trace

Load the same environment file used by the Space:

```sh
eval "$(npx agentpond env get hf-space)"

uv run --project examples/basic-traces/python \
  python examples/basic-traces/python/send_traces.py
```

The Python example sends one trace, one generation observation, and one annotation score through the Space.

## 6. Inspect the bucket and sync locally

Check that objects arrived in the Hugging Face Storage Bucket:

```sh
hf buckets list "$HF_NAMESPACE/$HF_BUCKET" -R
```

Sync and inspect locally:

```sh
npx agentpond sync
npx agentpond traces list
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>
npx agentpond scores list --traceId <trace-id>
```

## Reliability note

Free Spaces can sleep when idle, which may drop or delay ingestion requests. For always-on ingestion, use upgraded CPU hardware and disable sleep:

```sh
hf spaces settings "$HF_SPACE_ID" --hardware cpu-upgrade --sleep-time -1
```
