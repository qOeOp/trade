#!/usr/bin/env python3

from __future__ import annotations

import http.client
import importlib.util
import io
import json
import sys
import unittest
import urllib.error
import urllib.parse
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

        research_workflow = (
            repository / ".github" / "workflows" / "research-source-canary.yml"
        ).read_text(encoding="utf-8")
        for secret_name in (
            "OPENALEX_API_KEY",
            "KAGGLE_API_TOKEN",
            "STACKEXCHANGE_KEY",
        ):
            assert f"secrets.{secret_name}" in research_workflow

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

        for probe, secret_name in zip(
            canary.RESEARCH_PROBES[4:],
            ("OPENALEX_API_KEY", "KAGGLE_API_TOKEN", "STACKEXCHANGE_KEY"),
            strict=True,
        ):
            receipt = canary.run_probe(probe, {}, timeout=1, opener=opener)
            assert receipt.status == canary.Status.SKIPPED
            assert secret_name in receipt.detail

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

    def test_new_research_secrets_are_used_without_leaking(self) -> None:
        secret = "test-secret-that-must-not-appear"
        fixtures = (
            (
                canary.RESEARCH_PROBES[4],
                "OPENALEX_API_KEY",
                b'{"meta": {}, "results": [{"id": "https://openalex.org/W1"}]}',
                "api_key",
            ),
            (
                canary.RESEARCH_PROBES[5],
                "KAGGLE_API_TOKEN",
                b'[{"ref": "owner/dataset", "title": "Dataset"}]',
                None,
            ),
            (
                canary.RESEARCH_PROBES[6],
                "STACKEXCHANGE_KEY",
                b'{"items": [], "quota_remaining": 9999}',
                "key",
            ),
        )

        for probe, secret_name, payload, query_parameter in fixtures:
            seen_secret = False

            def opener(
                request: Any,
                query_parameter: str | None = query_parameter,
                payload: bytes = payload,
                **_kwargs: Any,
            ) -> Response:
                nonlocal seen_secret
                if query_parameter is None:
                    seen_secret = request.get_header("Authorization") == f"Bearer {secret}"
                else:
                    query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
                    seen_secret = query.get(query_parameter) == [secret]
                return Response(payload)

            receipt = canary.run_probe(
                probe,
                {secret_name: secret},
                timeout=1,
                opener=opener,
            )
            assert seen_secret
            assert receipt.status == canary.Status.HEALTHY
            assert secret not in receipt.detail

    def test_new_research_probe_schema_drift_fails_closed(self) -> None:
        for probe, secret_name in zip(
            canary.RESEARCH_PROBES[4:],
            ("OPENALEX_API_KEY", "KAGGLE_API_TOKEN", "STACKEXCHANGE_KEY"),
            strict=True,
        ):
            receipt = canary.run_probe(
                probe,
                {secret_name: "private"},
                timeout=1,
                opener=lambda *_args, **_kwargs: Response(b"{}"),
            )
            assert receipt.status == canary.Status.FAILED
            assert "schema error" in receipt.detail

    def test_rate_limit_retries_with_bounded_exponential_backoff(self) -> None:
        attempts = 0
        waits = []

        def opener(*_args: Any, **_kwargs: Any) -> Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise urllib.error.HTTPError(
                    "https://example.invalid?secret=value",
                    429,
                    "",
                    {},
                    io.BytesIO(),
                )
            return Response(b'{"data": [{"paperId": "paper-1"}]}')

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[1],
            {"SEMANTIC_SCHOLAR_API_KEY": "private"},
            timeout=1,
            opener=opener,
            sleeper=waits.append,
        )
        assert receipt.status == canary.Status.HEALTHY
        assert attempts == 2
        assert waits == [1.0]

    def test_exhausted_rate_limit_is_distinct_and_does_not_leak_url(self) -> None:
        waits = []

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
            sleeper=waits.append,
        )
        assert receipt.status == canary.Status.RATE_LIMITED
        assert receipt.detail == "HTTP 429 after 3 attempts"
        assert waits == [1.0, 2.0]
        assert "private" not in receipt.detail

    def test_non_rate_limit_http_error_is_not_retried(self) -> None:
        attempts = 0

        def opener(*_args: Any, **_kwargs: Any) -> Response:
            nonlocal attempts
            attempts += 1
            raise urllib.error.HTTPError(
                "https://example.invalid",
                403,
                "",
                {},
                io.BytesIO(),
            )

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[1],
            {"SEMANTIC_SCHOLAR_API_KEY": "private"},
            timeout=1,
            opener=opener,
            sleeper=lambda _delay: self.fail("non-429 response was retried"),
        )
        assert receipt.status == canary.Status.FAILED
        assert receipt.detail == "HTTP 403"
        assert attempts == 1

    def test_core_request_uses_canonical_trailing_slash_endpoint(self) -> None:
        request, _detail = canary.RESEARCH_PROBES[2].request(
            {"CORE_API_KEY": "private"},
        )
        assert request is not None
        assert request.full_url.startswith(
            "https://api.core.ac.uk/v3/search/works/?",
        )

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
