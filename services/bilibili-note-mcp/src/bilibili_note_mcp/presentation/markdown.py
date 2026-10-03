from __future__ import annotations

import html
from collections.abc import Mapping

from bilibili_note_mcp.domain.artifacts import NoteDraft, TranscriptSegment
from bilibili_note_mcp.domain.models import GroundedText


def markdown_literal(value: str) -> str:
    value = value.replace("&", "&amp;")
    for character in "\\`*_[]<>#()!|~":
        value = value.replace(character, "\\" + character)
    return value


def timestamp(milliseconds: int) -> str:
    seconds = milliseconds // 1000
    return f"{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02}"


def render(
    drafts: tuple[NoteDraft, ...],
    image_paths: Mapping[tuple[int, str], str],
    *,
    html_mode: bool = False,
) -> str:
    blocks: list[str] = []
    esc = html.escape if html_mode else markdown_literal

    def heading(level: int, text: str) -> None:
        blocks.append(
            f"<h{level}>{esc(text)}</h{level}>" if html_mode else "#" * level + " " + esc(text)
        )

    def paragraph(text: str) -> None:
        blocks.append(f"<p>{esc(text)}</p>" if html_mode else esc(text))

    for index, draft in enumerate(drafts):
        heading(1 if len(drafts) == 1 else 2, draft.source.title)
        url = draft.source.canonical_url
        source = html.escape(url, quote=True)
        label = (
            f"来源：{draft.source.author_name or '作者未提供'} · "
            f"{draft.source.published_at[:10] if draft.source.published_at else '日期未提供'} "
            f"· {timestamp(draft.source.duration_ms)}"
        )
        blocks.append(
            f'<p><a href="{source}">{esc(label)}</a></p>'
            if html_mode
            else f"[{esc(label)}](<{url}>)"
        )

        def time_url(
            ms: int, url: str = url, generic: bool = draft.source.platform == "generic"
        ) -> str:
            return url if generic else url + f"&t={ms // 1000}"

        if draft.source.platform == "generic":
            paragraph("时间标记用于对照原视频；通用来源链接仅返回原页面，不保证跳转到指定时间。")
        paragraph(
            "以下笔记依据视频内容整理，保留原作者观点；正文时间为转写片段范围，来源支持时可点击跳至片段起点；截图时间为实际取帧位置。"
        )
        paragraph(
            "处理档位："
            + {"fast": "快速", "standard": "标准", "precise": "精细"}[draft.quality]
            + "；复核音频片段："
            + str(len(draft.reviews))
            + "。复核一致不代表绝对准确。"
        )
        if any(r.differs for r in draft.reviews):
            paragraph("存在转写分歧，请结合文末原始转录与复核记录核对相关正文。")
        evidence = {s.evidence_id: s for s in draft.transcript}

        def point(
            item: GroundedText,
            bullet: bool,
            evidence: dict[str, TranscriptSegment] = evidence,
            url: str = url,
        ) -> None:
            ms = min(evidence[e].start_ms for e in item.evidence_refs)
            end_ms = max(evidence[e].end_ms for e in item.evidence_refs)
            time_label = f"约 {timestamp(ms)}–{timestamp(end_ms)}"
            link = time_url(ms)
            if html_mode:
                blocks.append(
                    f'<p class="point">{esc(item.text)} '
                    f'<a class="time" href="{html.escape(link, quote=True)}">'
                    f"{time_label}</a></p>"
                )
            else:
                blocks.append(
                    ("- " if bullet else "") + esc(item.text) + f" [{time_label}](<{link}>)"
                )

        heading(2 if len(drafts) == 1 else 3, "概览")
        for p in draft.note.overview:
            point(p, False)
        if html_mode:
            blocks.append('<div class="chapter-timeline">')
        for chapter in draft.note.chapters:
            if html_mode:
                refs = [evidence[e] for point in chapter.points for e in point.evidence_refs]
                start = min(s.start_ms for s in refs)
                end = max(s.end_ms for s in refs)
                blocks.append(
                    '<section class="chapter-row">'
                    f'<div class="chapter-time">{timestamp(start)}<span>—</span>'
                    f'{timestamp(end)}</div><div class="chapter-card">'
                )
            heading(2 if len(drafts) == 1 else 3, chapter.title)
            for p in chapter.points:
                point(p, True)
            frame_map = {f.frame_id: f for f in draft.frames}
            for image in sorted(
                chapter.screenshots, key=lambda item: frame_map[item.frame_id].timestamp_ms
            ):
                path = image_paths[index, image.frame_id]
                frame_time = frame_map[image.frame_id].timestamp_ms
                caption = f"视频原始画面 · {timestamp(frame_time)}"
                frame_link = html.escape(time_url(frame_time), quote=True)
                if html_mode:
                    blocks.append(
                        f'<figure><img src="{html.escape(path, quote=True)}" '
                        f'alt="{esc(caption)}" loading="lazy">'
                        f'<figcaption><a href="{frame_link}">{esc(caption)}</a>'
                        "</figcaption></figure>"
                    )
                else:
                    blocks.append(f"![{esc(caption)}](<{path}>)\n\n*{esc(caption)}*")
            if html_mode:
                blocks.append("</div></section>")
        if html_mode:
            blocks.append("</div>")
        if draft.note.takeaways and not html_mode:
            heading(2 if len(drafts) == 1 else 3, "要点回顾")
            for p in draft.note.takeaways:
                point(p, True)
        if not html_mode:
            heading(2 if len(drafts) == 1 else 3, "完整转录（原始文本）")
            for segment in draft.transcript:
                paragraph(
                    f"[{timestamp(segment.start_ms)}–{timestamp(segment.end_ms)}] {segment.text}"
                )
        if draft.reviews:
            heading(2 if len(drafts) == 1 else 3, "音频复核记录")
            for review in draft.reviews:
                state = (
                    "转写存在分歧，待核对"
                    if review.differs
                    else "两路转写一致（忽略断句标点、空白、大小写）"
                )
                paragraph(f"[{timestamp(review.start_ms)}–{timestamp(review.end_ms)}] {state}")
                paragraph("原转写：" + review.primary_text)
                paragraph("复核转写：" + review.alternate_text)
                paragraph("复核来源：" + review.provider_ref)
    body = "\n\n".join(blocks) + "\n"
    if not html_mode:
        return body
    return (
        """<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';
 img-src 'self' file:;
 style-src 'unsafe-inline';
 base-uri 'none';
 form-action 'none'">
<title>视频笔记</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f2f4f1;color:#26352e;
font:16px/1.85 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}
main{max-width:1120px;margin:48px auto;padding:48px 52px;background:#fff;
border:1px solid #e3e9e2;border-radius:24px;box-shadow:0 12px 48px #24392b08}
h1{font-size:32px;line-height:1.45;letter-spacing:-.025em;margin:0 0 20px}
h2,h3{font-size:23px;line-height:1.5;margin:40px 0 20px;scroll-margin-top:24px}
a{color:#277252;text-underline-offset:4px}a:hover{color:#154d35}
a.time{display:inline-block;font:12px/1.8 ui-monospace,monospace;background:#eef5f0;
padding:2px 8px;border-radius:6px;text-decoration:none;margin:6px 0}
.point{margin:12px 0}figure{margin:24px 0 8px}img{display:block;width:100%;height:auto;
border-radius:12px;background:#15221c}figcaption{font-size:12px;margin-top:8px}
figcaption a{color:#6b7c71;text-decoration:none}
.chapter-timeline{margin:36px 0;--rail:112px;--node-y:40px}
.chapter-row{display:grid;grid-template-columns:var(--rail) minmax(0,1fr);
position:relative;padding:0 0 24px}
.chapter-row:before{content:"";position:absolute;left:calc(var(--rail) - 1px);
top:0;bottom:0;width:2px;background:#dfe9e1}
.chapter-row:first-child:before{top:var(--node-y)}
.chapter-row:last-child:before{bottom:24px}
.chapter-row:after{content:"";position:absolute;left:calc(var(--rail) - 5px);
top:calc(var(--node-y) - 5px);width:10px;height:10px;border-radius:50%;
background:#428467;box-shadow:0 0 0 4px white}
.chapter-time{font:12px/20px ui-monospace,monospace;font-variant-numeric:tabular-nums;
color:#6c8072;padding:calc(var(--node-y) - 10px) 22px 0 0;text-align:right;
white-space:nowrap}
.chapter-time span{display:block;color:#a6b8ac;line-height:14px}
.chapter-card{margin-left:26px;padding:24px 28px;background:#fafbf9;border:1px solid #e5ebe3;
border-radius:16px;min-width:0}.chapter-card h2,.chapter-card h3{margin:0 0 16px;font-size:22px}
@media(max-width:650px){body{font-size:15px}
main{margin:0;padding:28px 18px;border:0;border-radius:0}
h1{font-size:25px}.chapter-timeline{--rail:82px;--node-y:33px}
.chapter-time{font-size:10px;padding-right:16px}.chapter-card{margin-left:14px;padding:18px 14px}
.chapter-card h2,.chapter-card h3{font-size:20px}
}
@media print{body,main{background:white}main{margin:0;padding:0;border:0;box-shadow:none}
figure{break-inside:avoid}.chapter-card{background:white}}
</style>
<main>"""
        + body
        + "</main></html>"
    )
