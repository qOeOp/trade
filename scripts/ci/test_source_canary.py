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
        assert receipt.detail == "public endpoint; instrument schema present; after 1 attempt"

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
        assert receipt.detail.endswith("; after 2 attempts")
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

    def test_public_endpoint_address_refusal_is_blocked_not_failed(self) -> None:
        for index, code in ((0, 451), (2, 403)):
            with self.subTest(probe=canary.MARKET_PROBES[index].name, code=code):

                def opener(*_args: Any, _code: int = code, **_kwargs: Any) -> Response:
                    raise urllib.error.HTTPError(
                        "https://example.invalid",
                        _code,
                        "",
                        {},
                        io.BytesIO(),
                    )

                receipt = canary.run_probe(
                    canary.MARKET_PROBES[index],
                    {},
                    timeout=1,
                    opener=opener,
                    sleeper=lambda _delay: self.fail("address refusal was retried"),
                )
                assert receipt.status == canary.Status.BLOCKED
                assert receipt.detail == f"HTTP {code}"

    def test_authenticated_endpoint_refusal_still_fails(self) -> None:
        def opener(*_args: Any, **_kwargs: Any) -> Response:
            raise urllib.error.HTTPError(
                "https://example.invalid?secret=value",
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
        )
        assert receipt.status == canary.Status.FAILED
        assert receipt.detail == "HTTP 403"

    def test_binance_probe_avoids_the_host_that_refuses_runners(self) -> None:
        request, _detail = canary.MARKET_PROBES[0].request({})
        assert request is not None
        host = request.full_url.split("/")[2]
        # `api.binance.com` answers 451 to GitHub-hosted runners, so a probe pointed there
        # can only ever report BLOCKED. Pin the invariant, not the URL: any host that does
        # answer is fine, this one provably does not.
        assert host != "api.binance.com", (
            f"the Binance probe targets {host}, which refuses GitHub runners with 451; "
            "use the documented public-data host so the cell can produce a real signal"
        )

    def test_each_probe_asks_for_the_type_its_validator_reads(self) -> None:
        arxiv, _detail = canary.RESEARCH_PROBES[0].request({})
        assert arxiv is not None
        assert canary.RESEARCH_PROBES[0].name == "arXiv query"
        # Atom is what _validate_arxiv reads; a JSON Accept is what arXiv refused with 406.
        assert arxiv.get_header("Accept") == "application/atom+xml"
        binance, _detail = canary.MARKET_PROBES[0].request({})
        assert binance is not None
        assert binance.get_header("Accept") == "application/json"
        core, _detail = canary.RESEARCH_PROBES[2].request({"CORE_API_KEY": "fixture"})
        assert core is not None
        assert core.get_header("Accept") == "application/json"

    def test_arxiv_intermittent_406_is_retried(self) -> None:
        answers = [406, None]
        waits: list[float] = []

        def opener(*_args: Any, **_kwargs: Any) -> Response:
            code = answers.pop(0)
            if code:
                raise urllib.error.HTTPError("https://example.invalid", code, "", {}, io.BytesIO())
            return Response(b"<feed><entry>paper</entry></feed>")

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[0],
            {},
            timeout=1,
            opener=opener,
            sleeper=waits.append,
        )
        assert receipt.status == canary.Status.HEALTHY
        assert receipt.detail == "public endpoint; Atom entry present; after 2 attempts"
        assert waits == [1.0]

    def _arxiv_answers(self, codes: list[int]) -> tuple[Any, list[float]]:
        waits: list[float] = []

        def opener(*_args: Any, **_kwargs: Any) -> Response:
            raise urllib.error.HTTPError(
                "https://example.invalid",
                codes.pop(0),
                "",
                {},
                io.BytesIO(),
            )

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[0],
            {},
            timeout=1,
            opener=opener,
            sleeper=waits.append,
        )
        return receipt, waits

    def test_arxiv_406_surviving_every_attempt_is_blocked(self) -> None:
        receipt, waits = self._arxiv_answers([406, 406, 406])
        assert receipt.status == canary.Status.BLOCKED
        assert receipt.detail == "HTTP 406 after 3 attempts"
        assert waits == [1.0, 2.0]
        assert canary.exit_status([receipt]) == 0

    def test_arxiv_answering_any_other_error_still_fails(self) -> None:
        # The BLOCKED reading covers one code from one source after the retries; an arXiv API that
        # breaks answers something else, and that must stay FAILED however it arrives.
        for codes, detail in (
            ([500], "HTTP 500"),
            ([404], "HTTP 404"),
            ([406, 406, 503], "HTTP 503"),
            ([406, 429, 429], "HTTP 429 after 3 attempts"),
        ):
            with self.subTest(codes=codes):
                receipt, _waits = self._arxiv_answers(list(codes))
                assert receipt.detail == detail
                assert receipt.status == (
                    canary.Status.RATE_LIMITED if "429" in detail else canary.Status.FAILED
                )

    def test_a_persistent_intermittent_code_fails_unless_named_a_refusal(self) -> None:
        def opener(*_args: Any, **_kwargs: Any) -> Response:
            raise urllib.error.HTTPError("https://example.invalid", 406, "", {}, io.BytesIO())

        probe = canary.Probe(
            "retries 406 only",
            canary.RESEARCH_PROBES[0].request,
            canary.RESEARCH_PROBES[0].validate,
            rate_limit_backoff=(1.0,),
            intermittent_codes=(406,),
        )
        receipt = canary.run_probe(probe, {}, timeout=1, opener=opener, sleeper=lambda _s: None)
        assert receipt.status == canary.Status.FAILED
        assert receipt.detail == "HTTP 406 after 2 attempts"
        # A keyed endpoint that refuses is refusing the key, not the address.
        keyed = canary.Probe(
            "keyed refusal",
            canary.RESEARCH_PROBES[2].request,
            canary.RESEARCH_PROBES[2].validate,
            rate_limit_backoff=(1.0,),
            intermittent_codes=(406,),
            address_refusal_after_retries=(406,),
        )
        receipt = canary.run_probe(
            keyed,
            {"CORE_API_KEY": "private"},
            timeout=1,
            opener=opener,
            sleeper=lambda _s: None,
        )
        assert receipt.status == canary.Status.FAILED

    def test_only_arxiv_reads_a_406_after_retries_as_a_refusal(self) -> None:
        named = {
            probe.name: probe.address_refusal_after_retries
            for probe in (*canary.MARKET_PROBES, *canary.RESEARCH_PROBES)
            if probe.address_refusal_after_retries
        }
        assert named == {"arXiv query": (406,)}
        try:
            canary.Probe(
                "unretried refusal",
                canary.RESEARCH_PROBES[0].request,
                canary.RESEARCH_PROBES[0].validate,
                address_refusal_after_retries=(406,),
            )
        except ValueError:
            pass
        else:
            self.fail("a refusal code that is never retried was accepted")

    def test_a_406_elsewhere_is_not_retried(self) -> None:
        attempts = 0

        def opener(*_args: Any, **_kwargs: Any) -> Response:
            nonlocal attempts
            attempts += 1
            raise urllib.error.HTTPError("https://example.invalid", 406, "", {}, io.BytesIO())

        receipt = canary.run_probe(
            canary.RESEARCH_PROBES[1],
            {"SEMANTIC_SCHOLAR_API_KEY": "private"},
            timeout=1,
            opener=opener,
            sleeper=lambda _seconds: None,
        )
        assert receipt.status == canary.Status.FAILED
        assert receipt.detail == "HTTP 406"
        assert attempts == 1

    def test_only_failed_receipts_fail_the_run(self) -> None:
        healthy = canary.Receipt("ok", canary.Status.HEALTHY, "")
        tolerated = [
            canary.Receipt("blocked", canary.Status.BLOCKED, "HTTP 451"),
            canary.Receipt("limited", canary.Status.RATE_LIMITED, ""),
            canary.Receipt("skipped", canary.Status.SKIPPED, ""),
        ]
        assert canary.exit_status([healthy, *tolerated]) == 0
        assert canary.exit_status([healthy, canary.Receipt("x", canary.Status.FAILED, "")]) == 1


if __name__ == "__main__":
    unittest.main()
