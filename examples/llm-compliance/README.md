# LLM compliance workflow

This scenario demonstrates a small agent workflow that calls an LLM, parses a structured result, and records the workflow in Langfuse.

Run commands in this README from the repository root.

The workflow:

- loads a concise incident-summary document from [`incident-summary.md`](./incident-summary.md)
- checks one graded rule with `gpt-5.5`
- parses a structured object with `compliance_score` from `0` to `10` and `reasoning`
- records one trace with two root observations: a document-loading span and one captured LLM generation
- uses the Langfuse OpenAI integration to capture the LLM generation automatically

The compliance rule is intentionally graded instead of binary:

> The incident summary should be actionable for follow-up by clearly covering observed issue, evidence, user impact, mitigation status, and next action.

## Prerequisites

Start AgentPond in one terminal:

```sh
agentpond dev
```

Load the local Langfuse-compatible credentials in a second terminal that will run the example:

```sh
eval "$(agentpond dev env)"
```

Set an OpenAI API key:

```sh
export OPENAI_API_KEY=...
```

## Run

Run the Python example with `uv`:

```sh
uv run --project examples/llm-compliance/python python examples/llm-compliance/python/compliance_workflow.py
```

The script prints the structured compliance result, generated trace ID, and `agentpond` commands for inspecting the trace and observations.

It also prints a follow-up command for adding the expected trace score. You can run that command directly, or call the score script with any trace ID:

```sh
uv run --project examples/llm-compliance/python python examples/llm-compliance/python/add_expected_score.py <trace-id>
```

## Analyze with a coding agent

After sending the workflow trace and adding the expected score, ask a coding agent to inspect the AgentPond traces:

```text
analyze traces for compliance_workflow.py
```

Use the trace analysis to compare the model's structured compliance score with the human annotation and improve the workflow prompt or rubric when they drift.
