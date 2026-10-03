import json

import httpx
from pydantic import BaseModel

from bilibili_note_mcp.adapters.asr_siliconflow import SiliconFlowAsr
from bilibili_note_mcp.adapters.model_client import JsonModelClient
from bilibili_note_mcp.config import load_model_profile


class Reply(BaseModel):
    value: str


async def test_default_author_uses_official_deepseek_wire_and_key(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-only")
    monkeypatch.delenv("SILICONFLOW_API_KEY", raising=False)

    def respond(request):
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["Authorization"] == "Bearer deepseek-test-only"
        body = json.loads(request.content)
        assert body["model"] == "deepseek-flash"
        assert body["thinking"] == {"type": "disabled"}
        assert "enable_thinking" not in body
        assert "thinking_budget" not in body
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json={
                "model": body["model"],
                "choices": [{"finish_reason": "stop", "message": {"content": '{"value":"ok"}'}}],
            },
        )

    assert (
        await JsonModelClient(transport=httpx.MockTransport(respond)).request("test", [], Reply)
    ).value == "ok"


def test_cloud_asr_keeps_its_own_provider_and_credentials():
    author = load_model_profile()
    asr = SiliconFlowAsr()._profile
    assert author.api_key_env == "DEEPSEEK_API_KEY"
    assert asr.provider == "siliconflow"
    assert asr.base_url == "https://api.siliconflow.cn/v1"
    assert asr.api_key_env == "SILICONFLOW_API_KEY"
    assert asr.asr_model == "Qwen/Qwen3-ASR-1.7B"
