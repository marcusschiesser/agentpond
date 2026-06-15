from langfuse import get_client, propagate_attributes

SCORE_NAME = "human-quality"
SCORE_VALUE = 1
SCORE_COMMENT = "Human review: answer is accurate and actionable."


def answer_checkout_question(langfuse, example_language):
    with langfuse.start_as_current_observation(
        as_type="span",
        name="checkout support trace",
        input={
            "question": "Why was my card declined?",
            "locale": "en-US",
            "cart_total": 128.45,
        },
        metadata={
            "example": "aperto-python",
            "exampleLanguage": example_language,
            "route": "/support/checkout",
            "tenant": "acme-retail",
        },
    ) as trace:
        with propagate_attributes(
            user_id="user_42",
            session_id="sdk-example-session",
            trace_name="checkout support trace",
            metadata={
                "example": "aperto-python",
                "exampleLanguage": example_language,
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
                )

            trace.update(
                output={
                    "answer": "The bank declined the authorization. Try another card or contact your bank.",
                    "next_action": "retry_payment",
                }
            )
        return getattr(trace, "trace_id", None)


def summarize_refund_policy(langfuse, example_language):
    with langfuse.start_as_current_observation(
        as_type="span",
        name="refund policy trace",
        input={
            "question": "Can I get a refund after the package ships?",
            "order_status": "shipped",
        },
    ) as trace:
        with propagate_attributes(
            user_id="user_77",
            session_id="sdk-example-session",
            trace_name="refund policy trace",
            metadata={
                "example": "aperto-python",
                "exampleLanguage": example_language,
                "feature": "policy-answer",
            },
        ):
            with langfuse.start_as_current_observation(
                as_type="generation",
                name="summarize refund policy",
                model="gpt-5.5-mini",
                input="Summarize refund policy for a shipped package.",
            ) as generation:
                generation.update(
                    output="Refunds are available after delivery if the item is returned within 30 days.",
                    usage_details={"input": 18, "output": 16, "total": 34},
                )

            trace.update(output={"policy": "return_after_delivery", "return_window_days": 30})
        return getattr(trace, "trace_id", None)


def create_annotation_score(langfuse, trace_id, example_language):
    langfuse.create_score(
        trace_id=trace_id,
        name=SCORE_NAME,
        value=SCORE_VALUE,
        data_type="NUMERIC",
        comment=SCORE_COMMENT,
        metadata={
            "source": "ANNOTATION",
            "annotator": "human-reviewer",
            "exampleLanguage": example_language,
        },
    )


def require_trace_id(trace_id, trace_name):
    if not trace_id:
        raise RuntimeError(f"Langfuse SDK did not provide a trace id for {trace_name}")
    return trace_id


def print_summary(trace_ids):
    checkout_trace_id, refund_trace_id = trace_ids
    print("Sent 2 Python Langfuse SDK traces and 1 annotation score:")
    print(f"- checkout support trace ({checkout_trace_id})")
    print(f"- refund policy trace ({refund_trace_id})")
    print(f"- {SCORE_NAME}={SCORE_VALUE} on checkout support trace")
    print("")
    print("Inspect checkout observations and scores:")
    print("pnpm cli sync")
    print(f"pnpm cli observations list --traceId {checkout_trace_id}")
    print(f"pnpm cli scores list --traceId {checkout_trace_id}")


def main():
    langfuse = get_client()
    example_language = "python"
    trace_ids = [
        require_trace_id(answer_checkout_question(langfuse, example_language), "checkout support trace"),
        require_trace_id(summarize_refund_policy(langfuse, example_language), "refund policy trace"),
    ]
    create_annotation_score(langfuse, trace_ids[0], example_language)
    langfuse.flush()
    print_summary(trace_ids)


if __name__ == "__main__":
    main()
