# AgentPond examples

This directory is organized by scenario. Each scenario includes its own README with setup and run commands.

Unless a scenario says otherwise, run example commands from the repository root.

- [Basic traces](./basic-traces/README.md): fixture-based Python and TypeScript examples that emit Langfuse traces, observations, and scores without calling an LLM.
- [Hugging Face Space](./huggingface-space/README.md): Docker Space deployment that stores AgentPond ingestion data in a Hugging Face Storage Bucket.
- [LLM compliance workflow](./llm-compliance/README.md): a Python `uv` example that calls OpenAI, parses a structured compliance score, and records the workflow in Langfuse.
- [OpenInference OpenAI traces](./openinference-openai/README.md): minimal Python and TypeScript examples that call OpenAI once and export OpenInference traces to AgentPond.
