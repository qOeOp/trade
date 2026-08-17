#!/usr/bin/env python3

from __future__ import annotations

import http.client
import importlib.util
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from types import ModuleType
from typing import Any
from typing import Self


def _load_module() -> ModuleType:
    path = Path(__file__).with_name("source_canary.py")
    spec = importlib.util.spec_from_file_location("source_canary", path)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


canary = _load_module()


class Response:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.payload


class SourceCanaryTest(unittest.TestCase):
    def test_workflows_are_read_only_and_do_not_persist_probe_data(self) -> None:
        repository = Path(__file__).resolve().parents[2]
        for name in ("market-data-canary.yml", "research-source-canary.yml"):
            workflow = (repository / ".github" / "workflows" / name).read_text(
                encoding="utf-8",
            )
            assert "contents: read" in workflow
            assert "schedule:" in workflow
            assert "workflow_dispatch:" in workflow
            assert "contents: write" not in workflow
            assert "upload-artifact" not in workflow
            assert "git push" not in workflow

    def test_market_probe_accepts_required_schema(self) -> None:
        payload = json.dumps(
            {"symbols": [{"symbol": "BTCUSDT", "status": "TRADING"}]},
        ).encode()
        receipt = canary.run_probe(
            canary.MARKET_PROBES[0],
            {},
            timeout=1,
            opener=lambda *_args, **_kwargs: Response(payload),
        )
        assert receipt.status == canary.Status.HEALTHY

    def test_schema_drift_fails_closed(self) -> None:
        receipt = canary.run_probe(
            canary.MARKET_PROBES[0],
            {},
            timeout=1,
            opener=lambda *_args, **_kwargs: Response(b'{"symbols": []}'),
        )
        assert receipt.status == canary.Status.FAILED
        assert "schema error" in receipt.detail

    def test_missing_optional_secret_is_explicitly_skipped(self) -> None:
        def opener(*_args: Any, **_kwargs: Any) -> Response:
            raise AssertionError("skipped probe opened the network")

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[2],
            {},
            timeout=1,
            opener=opener,
        )
        assert receipt.status == canary.Status.SKIPPED
        assert "CORE_API_KEY" in receipt.detail

    def test_secret_is_used_but_never_returned_in_receipt(self) -> None:
        seen_authorization = ""

        def opener(request: Any, **_kwargs: Any) -> Response:
            nonlocal seen_authorization
            seen_authorization = request.get_header("Authorization")
            return Response(b'{"results": []}')

        secret = "test-secret-that-must-not-appear"
        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[2],
            {"CORE_API_KEY": secret},
            timeout=1,
            opener=opener,
        )
        assert seen_authorization == f"Bearer {secret}"
        assert receipt.status == canary.Status.HEALTHY
        assert secret not in receipt.detail

    def test_http_error_reports_status_without_request_url(self) -> None:
        def opener(*_args: Any, **_kwargs: Any) -> Response:
            raise urllib.error.HTTPError(
                "https://example.invalid?secret=value",
                429,
                "",
                {},
                io.BytesIO(),
            )

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[1],
            {"SEMANTIC_SCHOLAR_API_KEY": "private"},
            timeout=1,
            opener=opener,
        )
        assert receipt.detail == "HTTP 429"
        assert "private" not in receipt.detail

    def test_incomplete_response_fails_one_probe_without_crashing(self) -> None:
        def opener(*_args: Any, **_kwargs: Any) -> Response:
            raise http.client.IncompleteRead(b"partial", 10)

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[0],
            {},
            timeout=1,
            opener=opener,
        )
        assert receipt.status == canary.Status.FAILED
        assert receipt.detail == "network error: IncompleteRead"


if __name__ == "__main__":
    unittest.main()
