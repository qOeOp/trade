from __future__ import annotations

from pathlib import Path

from bilibili_note_mcp.domain.models import StrategySummaryV1
from bilibili_note_mcp.domain.refs import raw_ref
from bilibili_note_mcp.domain.strategy_summary import (
    MARKDOWN_LITERAL_CONTROL_CHARACTERS,
    PUBLIC_RULE_FRAME,
    UNVERIFIED_SUMMARY_SCOPE,
    strategy_summary_title,
)

MATERIAL_REF = raw_ref(Path(__file__).read_bytes())


def markdown_literal(value: str) -> str:
    """Render untrusted text as Markdown-visible literal text, never as structure."""
    escaped = value.replace("\\", "\\\\")
    # Values are normalized to one line and placed after a host-owned heading or
    # bullet prefix. Escape only inline Markdown control characters; prose
    # punctuation must stay readable (for example MA20/MA40, 61.8%). Colons and
    # at-signs remain escaped so bare URLs and email addresses cannot autolink.
    for character in MARKDOWN_LITERAL_CONTROL_CHARACTERS:
        escaped = escaped.replace(character, f"\\{character}")
    return escaped


class MarkdownRenderer:
    @property
    def material_ref(self) -> str:
        return MATERIAL_REF

    def render(self, summary: StrategySummaryV1) -> str:
        lines = [
            f"# {markdown_literal(strategy_summary_title(summary.subject))}",
            "",
            UNVERIFIED_SUMMARY_SCOPE,
        ]
        sections = (
            ("核心策略", summary.core_strategies),
            ("具体方法", summary.methods),
            ("风险管理", summary.risk_management),
        )
        for heading, items in sections:
            if not items:
                continue
            lines.extend(("", f"## {heading}", ""))
            lines.extend(
                f"- {PUBLIC_RULE_FRAME}{markdown_literal(item.rule_body)}" for item in items
            )
        return "\n".join(lines).rstrip() + "\n"
