from __future__ import annotations

from typing import Any


def require_exact_model_envelope(value: object, expected_model: str) -> dict[str, Any]:
    """Require the provider to acknowledge the exact configured model identity."""
    if not isinstance(value, dict):
        raise ValueError("provider envelope must be an object")
    observed_model = value.get("model")
    if (
        not isinstance(observed_model, str)
        or not observed_model
        or observed_model != expected_model
    ):
        raise ValueError("provider model identity is missing or changed")
    return value
