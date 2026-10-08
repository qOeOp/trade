"""Build the small GitHub Pages site from the repository's Markdown documents."""

from __future__ import annotations

import html
import posixpath
import re
import shutil
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import markdown

ROOT = Path(__file__).resolve().parents[2]
PAGES = (
    ("zh/index.html", "docs/index.zh.md", "概览"),
    ("zh/architecture/index.html", "docs/architecture.zh.md", "当前架构"),
    ("zh/replay/index.html", "docs/plans/nautilus-upstream-poc.zh.md", "R1 回放"),
    ("zh/findings/index.html", "docs/plans/r1-native-rd-findings.zh.md", "研发发现"),
)
SOURCE_TO_PAGE = {str((ROOT / source).resolve()): output for output, source, _ in PAGES}
ATTRIBUTE = re.compile(r'(?P<name>href|src)="(?P<value>[^"]*)"')
GITHUB = "https://github.com/qOeOp/trade/blob/main/"
RAW = "https://raw.githubusercontent.com/qOeOp/trade/main/"


def relative_page(from_page: str, to_page: str) -> str:
    source_dir = posixpath.dirname(from_page)
    target_dir = posixpath.dirname(to_page)
    relative = posixpath.relpath(target_dir, source_dir)
    return "./" if relative == "." else f"{relative}/"


def rewrite_links(body: str, source: Path, output_page: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name, value = match.group("name", "value")
        parsed = urlsplit(html.unescape(value))
        if parsed.scheme or parsed.netloc or not parsed.path:
            return match.group(0)
        target = (source.parent / unquote(parsed.path)).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file():
            raise ValueError(f"{source.relative_to(ROOT)}: missing local link {value}")
        if str(target) in SOURCE_TO_PAGE and name == "href":
            url = relative_page(output_page, SOURCE_TO_PAGE[str(target)])
        else:
            prefix = RAW if name == "src" else GITHUB
            url = prefix + quote(target.relative_to(ROOT).as_posix())
        if parsed.fragment:
            url += "#" + quote(unquote(parsed.fragment), safe="-._~")
        return f'{name}="{html.escape(url, quote=True)}"'

    return ATTRIBUTE.sub(replace, body)


def build() -> None:
    output = ROOT / "_site"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    (output / "assets").mkdir()
    shutil.copyfile(ROOT / "docs/site/style.css", output / "assets/site.css")

    for page, source_name, title in PAGES:
        source = ROOT / source_name
        body = markdown.markdown(
            source.read_text(encoding="utf-8"),
            extensions=["fenced_code", "tables", "toc", "sane_lists"],
            output_format="html5",
        )
        body = rewrite_links(body, source, page)
        menu = "".join(
            f'<a href="{relative_page(page, destination)}"'
            f'{" aria-current=\"page\"" if destination == page else ""}>{html.escape(label)}</a>'
            for destination, _, label in PAGES
        )
        css = relative_page(page, "assets/site.css") + "site.css"
        document = f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} · Trade 研究文档</title>
  <link rel="stylesheet" href="{css}">
</head>
<body>
<header><div class="wrap"><a class="brand" href="{relative_page(page, 'zh/index.html')}">Trade 研究文档</a><nav aria-label="文档导航">{menu}</nav></div></header>
<main class="wrap">{body}</main>
<footer class="wrap">文档来自 <a href="{GITHUB}{quote(source_name)}">仓库源码</a>。</footer>
</body>
</html>
'''
        destination = output / page
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(document, encoding="utf-8")

    (output / "index.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta http-equiv="refresh" content="0; url=zh/">'
        '<a href="zh/">打开 Trade 研究文档</a></html>\n',
        encoding="utf-8",
    )
    (output / "404.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<title>页面不存在 · Trade 研究文档</title>'
        '<p>旧页面已整理。<a href="/trade/zh/">查看当前文档</a>。</p></html>\n',
        encoding="utf-8",
    )
    (output / ".nojekyll").touch()


if __name__ == "__main__":
    build()
