from __future__ import annotations

import html
import re
import unicodedata
from typing import Any, cast
from urllib.parse import urlencode

from bilibili_note_mcp.adapters.bilibili_http import bilibili_browser_headers
from bilibili_note_mcp.adapters.egress import SafeHttpClient
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.domain.models import SearchCandidateV1

_BVID = re.compile(r"^BV[0-9A-Za-z]{10}$")
_HIGHLIGHT = re.compile(r'</?em(?: class="keyword")?>', re.IGNORECASE)
_HEADERS = bilibili_browser_headers(referer="https://search.bilibili.com/")
_QUERY_SEPARATORS = re.compile(r"[\s,，、/|;；:：]+")
_OFFICIAL_DECORATION = re.compile(r"(?:[-_·\s]+官方(?:账号)?|官方账号)$", re.IGNORECASE)


def _mapping(value: object, reason: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", reason)
    return cast(dict[str, Any], value)


def _sequence(value: object, reason: str) -> list[Any]:
    if not isinstance(value, list):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", reason)
    return value


def _clean_title(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    title = html.unescape(_HIGHLIGHT.sub("", value)).strip()
    if (
        not title
        or len(title) > 500
        or "<" in title
        or ">" in title
        or any(unicodedata.category(character) == "Cc" for character in title)
    ):
        return None
    return title


def _clean_author(value: object) -> str | None:
    author = _clean_title(value)
    return author if author is not None and len(author) <= 200 else None


def _published_at(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _relevance_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = unicodedata.normalize("NFKC", html.unescape(_HIGHLIGHT.sub("", value))).casefold()
    return "".join(
        character for character in normalized if unicodedata.category(character)[0] in {"L", "N"}
    )


def _query_units(query: str) -> tuple[str, ...]:
    chunks = _QUERY_SEPARATORS.split(unicodedata.normalize("NFKC", query).casefold())
    return tuple(dict.fromkeys(unit for value in chunks if (unit := _relevance_text(value))))


def _matches_all_query_units(query: str, row: dict[str, Any], title: str) -> bool:
    fields = tuple(
        _relevance_text(value)
        for value in (title, row.get("author"), row.get("tag"), row.get("description"))
    )
    units = _query_units(query)
    return bool(units) and all(any(unit in field for field in fields) for unit in units)


def _bounded_compact_match(query: str, value: object) -> bool:
    compact_query = _relevance_text(query)
    if not compact_query or not isinstance(value, str):
        return False
    field = unicodedata.normalize("NFKC", html.unescape(_HIGHLIGHT.sub("", value))).casefold()
    start = field.find(compact_query)
    while start >= 0:
        end = start + len(compact_query)
        left_boundary = start == 0 or unicodedata.category(field[start - 1])[0] not in {
            "L",
            "N",
        }
        right_boundary = end == len(field) or unicodedata.category(field[end])[0] not in {
            "L",
            "N",
        }
        if left_boundary and right_boundary:
            return True
        start = field.find(compact_query, start + 1)
    return False


def _bounded_compact_match_any_field(query: str, row: dict[str, Any], title: str) -> bool:
    return any(
        _bounded_compact_match(query, value)
        for value in (title, row.get("author"), row.get("tag"), row.get("description"))
    )


def _relevance_score(query: str, row: dict[str, Any], title: str) -> int:
    compact_query = _relevance_text(query)
    if not compact_query:
        return 0
    units = set(_query_units(query))
    if len(compact_query) == 1:
        units.add(compact_query)
    else:
        units.update(compact_query[index : index + 2] for index in range(len(compact_query) - 1))
    units.discard("")
    score = 0
    for value, weight in (
        (title, 8),
        (row.get("author"), 10),
        (row.get("tag"), 4),
        (row.get("description"), 2),
    ):
        field = _relevance_text(value)
        if not field:
            continue
        if len(compact_query) > 1 and compact_query in field:
            score += 100 * weight
        score += weight * sum(len(unit) for unit in units if unit in field)
    return score


def _normalized_identity(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(
        unicodedata.normalize("NFKC", html.unescape(_HIGHLIGHT.sub("", value))).casefold().split()
    )


def _creator_identity_matches(query: str, value: object) -> bool:
    normalized_query = _normalized_identity(query)
    normalized_author = _normalized_identity(value)
    if not normalized_query or not normalized_author:
        return False
    if normalized_author == normalized_query:
        return True
    if not normalized_author.startswith(normalized_query):
        return False
    return _OFFICIAL_DECORATION.fullmatch(normalized_author[len(normalized_query) :]) is not None


class BilibiliSearch:
    """Fresh anonymous Bilibili search behind the existing closed egress owner."""

    def __init__(self, http: SafeHttpClient | None = None) -> None:
        self._http = http or SafeHttpClient()

    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]:
        if not 1 <= limit <= 9:
            raise ValueError("search limit is invalid")
        units = _query_units(query)
        if not units:
            raise BilibiliNoteFailure("SEARCH_EMPTY", "search_no_usable_results")
        encoded = urlencode(
            {
                "search_type": "video",
                "keyword": " ".join(units),
                "order": "pubdate",
                "page": 1,
            }
        )
        envelope = await self._http.get_json(
            f"https://api.bilibili.com/x/web-interface/wbi/search/type?{encoded}",
            headers=_HEADERS,
        )
        code = envelope.get("code")
        if not isinstance(code, int) or isinstance(code, bool):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "search_payload_invalid")
        if code != 0:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "search_request_rejected")
        data = _mapping(envelope.get("data"), "search_payload_invalid")
        rows = _sequence(data.get("result"), "search_results_invalid")
        usable_rows: list[tuple[int, dict[str, Any], str, str]] = []
        for upstream_index, value in enumerate(rows):
            if not isinstance(value, dict) or value.get("type") != "video":
                continue
            video_id = value.get("bvid")
            title = _clean_title(value.get("title"))
            if not isinstance(video_id, str) or _BVID.fullmatch(video_id) is None or title is None:
                continue
            usable_rows.append((upstream_index, value, video_id, title))

        candidates: list[tuple[int, int, int, SearchCandidateV1]] = []
        seen: set[str] = set()
        for upstream_index, value, video_id, title in usable_rows:
            relevant = _matches_all_query_units(query, value, title) and (
                len(units) > 1 or _bounded_compact_match_any_field(query, value, title)
            )
            if not relevant:
                continue
            if video_id in seen:
                continue
            seen.add(video_id)
            candidates.append(
                (
                    0 if _creator_identity_matches(query, value.get("author")) else 1,
                    _relevance_score(query, value, title),
                    upstream_index,
                    SearchCandidateV1(
                        video_id=video_id,
                        title=title,
                        canonical_url=f"https://www.bilibili.com/video/{video_id}?p=1",
                        author_name=_clean_author(value.get("author")),
                        published_at=_published_at(value.get("pubdate")),
                    ),
                )
            )
        if not candidates:
            raise BilibiliNoteFailure("SEARCH_EMPTY", "search_no_usable_results")
        candidates.sort(
            key=lambda item: (
                item[0],
                -item[1],
                -(item[3].published_at or 0),
                item[2],
            )
        )
        return tuple(candidate for _, _, _, candidate in candidates[:limit])
