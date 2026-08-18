from __future__ import annotations

import html
import re
import unicodedata

from bilibili_note_mcp.domain.private_identity import canonical_text_contains_private_identity

_CHANNEL_DECORATION_SUFFIX = re.compile(r"(?:[-_·\s]+官方(?:账号)?)+$", re.IGNORECASE)
_SUMMARY_SUFFIX = "交易思想与策略总结"
UNVERIFIED_SUMMARY_SCOPE = "以下内容仅为未验证的交易观点摘要，须另行研究验证。"
PUBLIC_RULE_FRAME = "规则描述："
MARKDOWN_LITERAL_CONTROL_CHARACTERS = "`*_[]<>#()!|~:@"
_RENDERER_ESCAPE = re.compile(rf"\\+([{re.escape(MARKDOWN_LITERAL_CONTROL_CHARACTERS)}])")
_TAG_SHAPED_MARKUP = re.compile(r"</?[a-z][^<>]*>")
_LATIN_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
_SUBJECT_PRIVATE_MARKERS = (
    "## 证据时间轴",
    "## provenance",
    "source snapshot:",
    "transcript:",
    "model:",
    "brief_ref:",
    "https://www.bilibili.com/video/",
    "解析失败：",
)
_SUBJECT_UNSAFE_MARKERS = (
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
)
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


def _is_default_ignorable(character: str) -> bool:
    code_point = ord(character)
    return any(start <= code_point <= end for start, end in _DEFAULT_IGNORABLE_RANGES)


def _subject_detection_view(value: str) -> str:
    rendered_equivalent = html.unescape(_RENDERER_ESCAPE.sub(r"\1", value))
    return "".join(
        character
        for character in unicodedata.normalize("NFKC", rendered_equivalent).casefold()
        if not _is_default_ignorable(character)
    )


def _safe_subject_base(value: str) -> str:
    cleaned = " ".join(value.split()).strip()
    visible = _subject_detection_view(cleaned)
    if (
        not cleaned
        or any(marker in visible for marker in _SUBJECT_PRIVATE_MARKERS)
        or any(marker in visible for marker in _SUBJECT_UNSAFE_MARKERS)
        or _TAG_SHAPED_MARKUP.search(visible) is not None
        or canonical_text_contains_private_identity(visible)
    ):
        return "视频"
    return cleaned


def public_author_subject(value: str) -> str:
    """Project a source-author subject while preserving narrow proper/technical forms."""
    cleaned = _safe_subject_base(value)
    if cleaned == "视频":
        return cleaned
    latin_words = _LATIN_WORD.findall(cleaned)
    if len(latin_words) > 2 or any(
        word[0].islower() and not any(character.isupper() for character in word[1:])
        for word in latin_words
    ):
        return "视频"
    return cleaned


def public_search_subject(value: str) -> str:
    """Project a user query only when it is already Chinese-facing prose."""
    cleaned = _safe_subject_base(value)
    if cleaned == "视频" or not any("\u4e00" <= character <= "\u9fff" for character in cleaned):
        return "视频"
    latin_words = _LATIN_WORD.findall(cleaned)
    if any(
        word[0].islower() and not any(character.isupper() for character in word[1:])
        for word in latin_words
    ):
        return "视频"
    return cleaned


def strategy_summary_title(subject: str) -> str:
    cleaned = public_author_subject(subject)
    cleaned = _CHANNEL_DECORATION_SUFFIX.sub("", cleaned).strip(" -_·") or "视频"
    return f"{cleaned}：{_SUMMARY_SUFFIX}"
