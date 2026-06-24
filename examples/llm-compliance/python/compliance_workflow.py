import os
from pathlib import Path

from langfuse import get_client, propagate_attributes
from langfuse.openai import OpenAI
from pydantic import BaseModel, Field

MODEL = "gpt-5.5"
DOCUMENT_PATH = Path(__file__).resolve().parent.parent / "incident-summary.md"
COMPLIANCE_RULE = (
    "The incident summary should be actionable for follow-up by clearly covering "
    "observed issue, evidence, user impact, mitigation status, and next action."
)


class ComplianceResult(BaseModel):
    compliance_score: int = Field(
        ge=0,
        le=10,
        description="Compliance score from 0 for unusable to 10 for fully actionable.",
    )
    reasoning: str = Field(description="Concise explanation for the score.")


def require_env():
    missing = [
        key
        for key in (
            "OPENAI_API_KEY",
            "LANGFUSE_BASE_URL",
            "LANGFUSE_PUBLIC_KEY",
            "LANGFUSE_SECRET_KEY",
        )
        if not os.getenv(key)
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}. "
            'Set OPENAI_API_KEY and run eval "$(agentpond dev env)" before running this example.'
        )


def load_incident_summary(langfuse, trace_id):
    load_span = langfuse.start_observation(
        trace_context={"trace_id": trace_id},
        name="load incident summary",
        as_type="span",
        input={
            "document_type": "incident-summary",
            "path": str(DOCUMENT_PATH),
        },
    )
    document = DOCUMENT_PATH.read_text(encoding="utf-8")
    load_span.update(output={"document": document})
    load_span.end()
    return document


def compliance_messages(document):
    return [
        {
            "role": "system",
            "content": (
                "You are a compliance reviewer for engineering incident summaries. "
                "Score only the supplied document against the supplied rule. "
                "Use the full 0 to 10 range and explain the biggest reason for the score."
            ),
        },
        {
            "role": "user",
            "content": f"Rule:\n{COMPLIANCE_RULE}\n\nDocument:\n{document}",
        },
    ]


def check_document(trace_id, document):
    openai_client = OpenAI()
    messages = compliance_messages(document)
    completion = openai_client.chat.completions.parse(
        model=MODEL,
        messages=messages,
        response_format=ComplianceResult,
        name="gpt-5.5 compliance scorer",
        metadata={
            "structured_output": "ComplianceResult",
            "compliance_rule": COMPLIANCE_RULE,
        },
        trace_id=trace_id,
    )
    return completion.choices[0].message.parsed


def run_workflow():
    langfuse = get_client()
    trace_id = langfuse.create_trace_id()
    with propagate_attributes(
        trace_name="incident summary compliance workflow",
        session_id="llm-compliance-example",
        metadata={
            "example": "agentpond-llm-compliance-python",
            "feature": "llm-compliance",
            "document_path": str(DOCUMENT_PATH),
            "compliance_rule": COMPLIANCE_RULE,
        },
    ):
        document = load_incident_summary(langfuse, trace_id)
        result = check_document(trace_id, document)
    return trace_id, result


def require_trace_id(trace_id):
    if not trace_id:
        raise RuntimeError("Langfuse SDK did not provide a trace id")
    return trace_id


def print_summary(trace_id, result):
    print("LLM compliance result:")
    print(f"- compliance_score: {result.compliance_score}")
    print(f"- reasoning: {result.reasoning}")
    print("")
    print(f"Sent 1 LLM compliance trace ({trace_id})")
    print("")
    print("Inspect the trace and observations:")
    print("agentpond sync")
    print(f"agentpond traces get {trace_id}")
    print(f"agentpond observations list --traceId {trace_id}")
    print("")
    print("Add the expected score:")
    print(f"uv run --project examples/llm-compliance/python python examples/llm-compliance/python/add_expected_score.py {trace_id}")


def main():
    require_env()
    langfuse = get_client()
    trace_id, result = run_workflow()
    trace_id = require_trace_id(trace_id)
    langfuse.flush()
    print_summary(trace_id, result)


if __name__ == "__main__":
    main()
