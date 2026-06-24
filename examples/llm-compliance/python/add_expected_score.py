import os
import sys

from langfuse import get_client

EXPECTED_SCORE_NAME = "expected-compliance-score"
EXPECTED_SCORE_VALUE = 8
EXPECTED_SCORE_COMMENT = "Expected score is 8 because measurable impact is important for actionable follow-up."


def require_langfuse_env():
    missing = [
        key
        for key in ("LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
        if not os.getenv(key)
    ]
    if missing:
        raise RuntimeError(
            f"Missing required Langfuse environment variables: {', '.join(missing)}. "
            'Run eval "$(agentpond dev env)" before running this example.'
        )


def require_trace_id(argv):
    if len(argv) != 2:
        raise RuntimeError("Usage: python add_expected_score.py <trace-id>")
    return argv[1]


def create_expected_score(langfuse, trace_id):
    langfuse.create_score(
        trace_id=trace_id,
        name=EXPECTED_SCORE_NAME,
        value=EXPECTED_SCORE_VALUE,
        data_type="NUMERIC",
        comment=EXPECTED_SCORE_COMMENT,
        metadata={"source": "EXPECTED"},
    )


def main():
    require_langfuse_env()
    trace_id = require_trace_id(sys.argv)
    langfuse = get_client()
    create_expected_score(langfuse, trace_id)
    langfuse.flush()
    print(f"Added {EXPECTED_SCORE_NAME}={EXPECTED_SCORE_VALUE} to trace {trace_id}")
    print("")
    print("Inspect scores:")
    print("agentpond sync")
    print(f"agentpond scores list --traceId {trace_id}")


if __name__ == "__main__":
    main()
