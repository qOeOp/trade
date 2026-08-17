#!/usr/bin/env python3
"""
Run bounded, read-only health probes against external source APIs.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any


class Status(StrEnum):
    HEALTHY = "HEALTHY"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


Validator = Callable[[bytes], str]
RequestFactory = Callable[
    [Mapping[str, str]],
    tuple[urllib.request.Request | None, str],
]


@dataclass(frozen=True)
class Probe:
    name: str
    request: RequestFactory
    validate: Validator


@dataclass(frozen=True)
class Receipt:
    source: str
    status: Status
    detail: str


def _json(body: bytes) -> Any:
    return json.loads(body.decode("utf-8"))


def _request(
    url: str,
    *,
    headers: Mapping[str, str] | None = None,
) -> urllib.request.Request:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("canary requests require an HTTPS endpoint")
    safe_headers = {
        "Accept": "application/json",
        "User-Agent": "qOeOp-trade-source-canary/1",
    }
    safe_headers.update(headers or {})
    return urllib.request.Request(url, headers=safe_headers)  # noqa: S310


def _public_request(url: str) -> RequestFactory:
    return lambda _env: (_request(url), "public endpoint")


def _optional_bearer_request(url: str, secret_name: str) -> RequestFactory:
    def factory(env: Mapping[str, str]) -> tuple[urllib.request.Request | None, str]:
        secret = env.get(secret_name, "").strip()
        if not secret:
            return None, f"{secret_name} is not configured"
        return _request(
            url,
            headers={"Authorization": f"Bearer {secret}"},
        ), "authenticated endpoint"

    return factory


def _fred_request(env: Mapping[str, str]) -> tuple[urllib.request.Request | None, str]:
    secret = env.get("FRED_API_KEY", "").strip()
    if not secret:
        return None, "FRED_API_KEY is not configured"
    query = urllib.parse.urlencode(
        {"series_id": "FEDFUNDS", "api_key": secret, "file_type": "json"},
    )
    return _request(
        f"https://api.stlouisfed.org/fred/series?{query}",
    ), "authenticated endpoint"


def _semantic_scholar_request(
    env: Mapping[str, str],
) -> tuple[urllib.request.Request, str]:
    headers = {}
    detail = "public endpoint"
    secret = env.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if secret:
        headers["x-api-key"] = secret
        detail = "authenticated endpoint"
    query = urllib.parse.urlencode(
        {"query": "algorithmic trading", "limit": 1, "fields": "paperId,title"},
    )
    return (
        _request(
            f"https://api.semanticscholar.org/graph/v1/paper/search?{query}",
            headers=headers,
        ),
        detail,
    )


def _validate_binance(body: bytes) -> str:
    payload = _json(body)
    symbols = payload.get("symbols") if isinstance(payload, dict) else None
    if not isinstance(symbols, list) or not any(
        item.get("symbol") == "BTCUSDT" and isinstance(item.get("status"), str)
        for item in symbols
        if isinstance(item, dict)
    ):
        raise ValueError("missing BTCUSDT instrument fields")
    return "instrument schema present"


def _validate_okx(body: bytes) -> str:
    payload = _json(body)
    data = payload.get("data") if isinstance(payload, dict) else None
    if (
        payload.get("code") != "0"
        or not isinstance(data, list)
        or not any(item.get("instId") == "BTC-USDT" for item in data if isinstance(item, dict))
    ):
        raise ValueError("missing BTC-USDT instrument fields")
    return "instrument schema present"


def _validate_bybit(body: bytes) -> str:
    payload = _json(body)
    result = payload.get("result") if isinstance(payload, dict) else None
    items = result.get("list") if isinstance(result, dict) else None
    if (
        payload.get("retCode") != 0
        or not isinstance(items, list)
        or not any(item.get("symbol") == "BTCUSDT" for item in items if isinstance(item, dict))
    ):
        raise ValueError("missing BTCUSDT instrument fields")
    return "instrument schema present"


def _validate_arxiv(body: bytes) -> str:
    if b"<entry>" not in body or b"</entry>" not in body:
        raise ValueError("missing Atom entry")
    return "Atom entry present"


def _validate_semantic_scholar(body: bytes) -> str:
    payload = _json(body)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not data or not isinstance(data[0].get("paperId"), str):
        raise ValueError("missing paper search fields")
    return "paper search schema present"


def _validate_core(body: bytes) -> str:
    payload = _json(body)
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        raise ValueError("missing results list")
    return "work search schema present"


def _validate_fred(body: bytes) -> str:
    payload = _json(body)
    series = payload.get("seriess") if isinstance(payload, dict) else None
    if not isinstance(series, list) or not series or series[0].get("id") != "FEDFUNDS":
        raise ValueError("missing FEDFUNDS series fields")
    return "series schema present"


MARKET_PROBES = (
    Probe(
        "Binance public instruments",
        _public_request("https://api.binance.com/api/v3/exchangeInfo?symbol=BTCUSDT"),
        _validate_binance,
    ),
    Probe(
        "OKX public instruments",
        _public_request(
            "https://www.okx.com/api/v5/public/instruments?instType=SPOT&instId=BTC-USDT",
        ),
        _validate_okx,
    ),
    Probe(
        "Bybit public instruments",
        _public_request(
            "https://api.bybit.com/v5/market/instruments-info?category=spot&symbol=BTCUSDT",
        ),
        _validate_bybit,
    ),
)


RESEARCH_PROBES = (
    Probe(
        "arXiv query",
        _public_request(
            "https://export.arxiv.org/api/query?search_query=all%3Aalgorithmic%20trading&start=0&max_results=1",
        ),
        _validate_arxiv,
    ),
    Probe(
        "Semantic Scholar search",
        _semantic_scholar_request,
        _validate_semantic_scholar,
    ),
    Probe(
        "CORE work search",
        _optional_bearer_request(
            "https://api.core.ac.uk/v3/search/works?q=algorithmic%20trading&limit=1",
            "CORE_API_KEY",
        ),
        _validate_core,
    ),
    Probe("FRED series", _fred_request, _validate_fred),
)


def run_probe(
    probe: Probe,
    env: Mapping[str, str],
    *,
    timeout: float,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> Receipt:
    request, request_detail = probe.request(env)
    if request is None:
        return Receipt(probe.name, Status.SKIPPED, request_detail)

    try:
        with opener(request, timeout=timeout) as response:
            body = response.read()
        validation_detail = probe.validate(body)
        return Receipt(
            probe.name,
            Status.HEALTHY,
            f"{request_detail}; {validation_detail}",
        )
    except urllib.error.HTTPError as e:
        return Receipt(probe.name, Status.FAILED, f"HTTP {e.code}")
    except urllib.error.URLError as e:
        return Receipt(probe.name, Status.FAILED, f"network error: {e.reason}")
    except (http.client.HTTPException, TimeoutError) as e:
        return Receipt(
            probe.name,
            Status.FAILED,
            f"network error: {type(e).__name__}",
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        ValueError,
    ) as e:
        return Receipt(probe.name, Status.FAILED, f"schema error: {e}")


def _markdown(domain: str, receipts: list[Receipt]) -> str:
    rows = [
        f"## {domain.replace('-', ' ').title()} canary",
        "",
        "This is a read-only health receipt. No source payload was persisted or admitted.",
        "",
        "| Source | Status | Detail |",
        "| --- | --- | --- |",
    ]
    rows.extend(f"| {r.source} | {r.status.value} | {r.detail} |" for r in receipts)
    return "\n".join(rows) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domain", choices=("market-data", "research-source"))
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args(argv)

    probes = MARKET_PROBES if args.domain == "market-data" else RESEARCH_PROBES
    receipts = [run_probe(probe, os.environ, timeout=args.timeout) for probe in probes]
    print(
        json.dumps(
            {
                "schema": "qoeop-source-canary-receipt/v1",
                "domain": args.domain,
                "persisted": False,
                "admitted_as_business_fact": False,
                "results": [
                    {"source": r.source, "status": r.status.value, "detail": r.detail}
                    for r in receipts
                ],
            },
            indent=2,
        ),
    )
    if args.summary:
        args.summary.write_text(_markdown(args.domain, receipts), encoding="utf-8")
    return 1 if any(receipt.status is Status.FAILED for receipt in receipts) else 0


if __name__ == "__main__":
    sys.exit(main())
