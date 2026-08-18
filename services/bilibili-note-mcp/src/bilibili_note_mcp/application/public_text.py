from __future__ import annotations

import html
import re
import unicodedata

from bilibili_note_mcp.domain.private_identity import (
    canonical_text_contains_private_catalog_identity,
    canonical_text_contains_private_identity,
)
from bilibili_note_mcp.domain.strategy_summary import (
    MARKDOWN_LITERAL_CONTROL_CHARACTERS,
    PUBLIC_RULE_FRAME,
    UNVERIFIED_SUMMARY_SCOPE,
)

_RENDERER_ESCAPE = re.compile(rf"\\+([{re.escape(MARKDOWN_LITERAL_CONTROL_CHARACTERS)}])")
_HOST_RENDERED_LINE_BOUNDARY = re.compile(r"\r\n?|\n")
# Unicode 17.0 DerivedCoreProperties.txt, Default_Ignorable_Code_Point.
# Keep the complete normative ranges rather than deleting every combining mark.
_DEFAULT_IGNORABLE_RANGES = (
    (0x00AD, 0x00AD),
    (0x034F, 0x034F),
    (0x061C, 0x061C),
    (0x115F, 0x1160),
    (0x17B4, 0x17B5),
    (0x180B, 0x180F),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2060, 0x206F),
    (0x3164, 0x3164),
    (0xFE00, 0xFE0F),
    (0xFEFF, 0xFEFF),
    (0xFFA0, 0xFFA0),
    (0xFFF0, 0xFFF8),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0000, 0xE0FFF),
)
_PRIVATE_MARKERS = (
    "## 证据时间轴",
    "## Provenance",
    "## 画面补足的信息",
    "Source snapshot:",
    "Transcript:",
    "Model:",
    "Internal visual frames analyzed:",
    "Public image count:",
    "brief_ref:",
    "https://www.bilibili.com/video/",
    "## 候选视频",
    "## 解析结果",
    "解析失败：",
    "来源视频主张",
    "来源视频假设",
    "Research 验证问题",
    "Research 否证条件",
    "待确认来源视频",
)

_BASE64_RUN = re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{80,}={0,2}(?![A-Za-z0-9+/])")
# Any ASCII element-shaped token is markup, including unknown, legacy and future names. A finite
# browser vocabulary silently becomes incomplete. Comparisons remain available when the operator is
# separated from an identifier (``EMA5 < EMA20``); compact ``<name>`` is ambiguous and fails closed.
_TAG_SHAPED_MARKUP = re.compile(r"</?[a-z][^<>]*>")
_FORBIDDEN_MODEL_MARKERS = (
    "data:image",
    "base64,",
    "![",
    "<img",
    "<image",
    "file://",
    "http://",
    "https://",
    "/tmp/",
    "/private/tmp/",
    "bilibili-note-assets",
    "media:",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
)
_FORBIDDEN_RENDERED_MARKERS = (
    "data:image",
    "base64,",
    "![",
    "<img",
    "<image",
    "file://",
    "/tmp/",
    "/private/tmp/",
    "bilibili-note-assets",
    "media:",
)


def _contains_forbidden(value: str, markers: tuple[str, ...]) -> bool:
    visible = _browser_visible_detection_view(value)
    return (
        any(marker in visible for marker in markers)
        or _BASE64_RUN.search(visible) is not None
        or _TAG_SHAPED_MARKUP.search(visible) is not None
    )


def _is_default_ignorable(character: str) -> bool:
    code_point = ord(character)
    return any(start <= code_point <= end for start, end in _DEFAULT_IGNORABLE_RANGES)


def _browser_visible_detection_view(value: str) -> str:
    """Return a browser-visible canonical view used only for representation detection."""
    rendered_equivalent = html.unescape(_RENDERER_ESCAPE.sub(r"\1", value))
    return "".join(
        character
        for character in unicodedata.normalize("NFKC", rendered_equivalent).casefold()
        if not _is_default_ignorable(character)
    )


def _contains_private_identity(value: str) -> bool:
    return canonical_text_contains_private_identity(_browser_visible_detection_view(value))


def _rendered_contains_private_identity(value: str) -> bool:
    # Split literal host lines before entity decoding. A provider-owned ``&NewLine;`` stays in its
    # source line and becomes a private-ID gap, while independent Markdown lines never join.
    return any(
        _contains_private_identity(source_line)
        for source_line in _HOST_RENDERED_LINE_BOUNDARY.split(value)
    )


def _contains_private_marker(value: str) -> bool:
    detection_value = _browser_visible_detection_view(value)
    return any(
        _browser_visible_detection_view(marker) in detection_value for marker in _PRIVATE_MARKERS
    )


def model_public_rule_representation_is_valid(value: str) -> bool:
    """Reject only unsafe representations; semantic usefulness belongs to the verifier."""
    cjk = sum("\u4e00" <= character <= "\u9fff" for character in value)
    return (
        cjk >= 4
        and not _contains_forbidden(value, _FORBIDDEN_MODEL_MARKERS)
        and not _contains_private_marker(value)
        and not _contains_private_identity(value)
    )


def contains_private_catalog_identity(value: str) -> bool:
    """Detect private catalog IDs through case, format and Markdown escape variants."""
    return canonical_text_contains_private_catalog_identity(_browser_visible_detection_view(value))


def rendered_summary_structure_is_valid(value: str) -> bool:
    """Prove scope, ordered nonempty sections and one host-owned frame per rule."""
    lines = value.splitlines()
    if len(lines) < 5 or value.count(UNVERIFIED_SUMMARY_SCOPE) != 1:
        return False
    if not lines[0].startswith("# ") or lines[0].startswith("## "):
        return False
    if lines[1:4] != ["", UNVERIFIED_SUMMARY_SCOPE, ""]:
        return False
    cursor = 4
    allowed_headings = ("## 核心策略", "## 具体方法", "## 风险管理")
    previous_heading_index = -1
    section_count = 0
    while cursor < len(lines):
        if section_count > 0:
            if lines[cursor] != "":
                return False
            cursor += 1
        if cursor >= len(lines) or lines[cursor] not in allowed_headings:
            return False
        heading_index = allowed_headings.index(lines[cursor])
        if heading_index <= previous_heading_index:
            return False
        previous_heading_index = heading_index
        section_count += 1
        cursor += 1
        if cursor >= len(lines) or lines[cursor] != "":
            return False
        cursor += 1
        item_count = 0
        while cursor < len(lines) and lines[cursor].startswith("- "):
            if not lines[cursor].startswith(f"- {PUBLIC_RULE_FRAME}"):
                return False
            if lines[cursor] == f"- {PUBLIC_RULE_FRAME}":
                return False
            item_count += 1
            cursor += 1
        if item_count == 0:
            return False
    return section_count > 0 and cursor == len(lines)


def rendered_public_text_is_valid(value: str) -> bool:
    """Reject media-like representations after the deterministic render."""
    return not _contains_forbidden(value, _FORBIDDEN_RENDERED_MARKERS)


def contains_private_audit_noise(value: str) -> bool:
    return _contains_private_marker(value) or _contains_private_identity(value)


def rendered_contains_private_audit_noise(value: str) -> bool:
    """Detect private identities without joining independently host-rendered lines."""
    return _contains_private_marker(value) or _rendered_contains_private_identity(value)
