from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files

from bilibili_note_mcp.domain.refs import raw_ref


@dataclass(frozen=True, slots=True)
class ModelProfile:
    provider: str
    base_url: str
    vision_model: str
    asr_model: str
    api_key_env: str
    timeout_seconds: float
    max_output_tokens: int


def load_model_profile() -> ModelProfile:
    resource = files("bilibili_note_mcp").joinpath("profiles/v1/siliconflow.json")
    value = json.loads(resource.read_text(encoding="utf-8"))
    expected = {
        "schema",
        "provider",
        "base_url",
        "vision_model",
        "asr_model",
        "api_key_env",
        "timeout_seconds",
        "max_output_tokens",
    }
    if set(value) != expected or value["schema"] != "bilibili-note-model-profile/v1":
        raise ValueError("model profile is invalid")
    return ModelProfile(
        provider=str(value["provider"]),
        base_url=str(value["base_url"]),
        vision_model=str(value["vision_model"]),
        asr_model=str(value["asr_model"]),
        api_key_env=str(value["api_key_env"]),
        timeout_seconds=float(value["timeout_seconds"]),
        max_output_tokens=int(value["max_output_tokens"]),
    )


def model_profile_material_ref() -> str:
    resource = files("bilibili_note_mcp").joinpath("profiles/v1/siliconflow.json")
    return raw_ref(resource.read_bytes())
