import os

from langfuse import get_client, propagate_attributes

SCORE_NAME = "human-quality"
SCORE_VALUE = 1
SCORE_COMMENT = "Human review: answer is accurate and actionable."
COST_DETAILS = {"input": 0.038, "output": 0.044, "total": 0.082}


def require_langfuse_env():
    missing = [
        key
        for key in ("LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
        if not os.getenv(key)
    ]
    if missing:
        raise RuntimeError(
            f"Missing required Langfuse environment variables: {', '.join(missing)}. "
            "Set LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY before running this example."
        )


def answer_checkout_question(langfuse):
    with langfuse.start_as_current_observation(
        as_type="span",
        name="checkout support trace",
        input={
            "question": "Why was my card declined?",
            "locale": "en-US",
            "cart_total": 128.45,
        },
        metadata={
            "example": "agentpond-python",
            "route": "/support/checkout",
            "tenant": "acme-retail",
        },
    ) as trace:
        with propagate_attributes(
            user_id="user_42",
            session_id="sdk-example-session",
            trace_name="checkout support trace",
            metadata={
                "example": "agentpond-python",
                "feature": "checkout-support",
                "release": "2026-06-15",
            },
        ):
            with langfuse.start_as_current_observation(
                as_type="span",
                name="load customer order context",
                input={"user_id": "user_42", "order_id": "ord_2026_001"},
            ) as lookup:
                lookup.update(
                    output={
                        "payment_status": "declined",
                        "decline_code": "insufficient_funds",
                        "attempts": 1,
                    }
                )

            with langfuse.start_as_current_observation(
                as_type="generation",
                name="draft support response",
                model="gpt-5.5-mini",
                input=[
                    {
                        "role": "system",
                        "content": "Answer checkout support questions with concise next steps.",
                    },
                    {
                        "role": "user",
                        "content": "Why was my card declined?",
                    },
                ],
                metadata={"provider": "example-fixture", "temperature": 0.2},
            ) as generation:
                generation.update(
                    output={
                        "answer": "The bank declined the authorization. Try another card or contact your bank.",
                        "confidence": 0.92,
                    },
                    usage_details={"input": 38, "output": 22, "total": 60},
                    cost_details=COST_DETAILS,
                )

            trace.update(
                output={
                    "answer": "The bank declined the authorization. Try another card or contact your bank.",
                    "next_action": "retry_payment",
                }
            )
        return getattr(trace, "trace_id", None)


def create_annotation_score(langfuse, trace_id):
    langfuse.create_score(
        trace_id=trace_id,
        name=SCORE_NAME,
        value=SCORE_VALUE,
        data_type="NUMERIC",
        comment=SCORE_COMMENT,
        metadata={
            "source": "ANNOTATION",
            "annotator": "human-reviewer",
        },
    )


def require_trace_id(trace_id, trace_name):
    if not trace_id:
        raise RuntimeError(f"Langfuse SDK did not provide a trace id for {trace_name}")
    return trace_id


def print_summary(checkout_trace_id):
    print("Sent 1 Python Langfuse SDK trace and 1 annotation score:")
    print(f"- checkout support trace ({checkout_trace_id})")
    print(f"- {SCORE_NAME}={SCORE_VALUE} on checkout support trace")
    print(f"- generation cost_details total: {COST_DETAILS['total']}")
    print("")
    print("Inspect checkout trace cost, observations, and scores:")
    print("agentpond sync")
    print(f"agentpond traces get {checkout_trace_id}")
    print(f"agentpond observations list --traceId {checkout_trace_id}")
    print(f"agentpond scores list --traceId {checkout_trace_id}")


def main():
    require_langfuse_env()
    langfuse = get_client()
    checkout_trace_id = require_trace_id(answer_checkout_question(langfuse), "checkout support trace")
    create_annotation_score(langfuse, checkout_trace_id)
    langfuse.flush()
    print_summary(checkout_trace_id)


if __name__ == "__main__":
    main()
