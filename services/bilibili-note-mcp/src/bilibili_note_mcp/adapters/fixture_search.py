from __future__ import annotations

from bilibili_note_mcp.domain.models import SearchCandidateV1
from bilibili_note_mcp.fixture import FIXTURE_URL

_FIXTURE_BVID = "BV1bK411W797"


class FixtureSearch:
    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]:
        return (
            SearchCandidateV1(
                video_id=_FIXTURE_BVID,
                title=f"Fixture search result: {query}",
                canonical_url=FIXTURE_URL,
            ),
        )
