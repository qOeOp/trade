# Video Note MCP

Standalone local MCP for illustrated Chinese notes from public Bilibili and YouTube videos,
or a public HTTPS video page/direct media link, of any subject.
It uses complete speech transcription and actual video frames to produce an overview, content-derived
chapters, concrete details, relevant screenshots and source/time links. No subject-specific framework
or fixed topic categories are imposed. The [design](bilibili-note.md) is the architecture authority.

## Use

```text
video_note.create({"url":"https://www.bilibili.com/video/BV..."})
video_note.create({"url":"https://www.youtube.com/watch?v=EtIAqiguRHs","quality":"fast"})
```

`bilibili_note.create` remains accepted as a compatibility alias.
The calling agent owns search and video selection, then passes a URL to `video_note.create`.
Both `search_and_create` names have been removed; they are not compatibility aliases.
YouTube accepts public finite `watch`, `youtu.be` and `shorts` links, including share/time parameters.
Playlists, channels and live streams are rejected. Install Deno (recommended) or Node 22+ on `PATH`;
the locked yt-dlp default dependencies include the matching EJS component. No browser cookies are
read automatically. Videos without subtitles use the same complete-audio ASR and quality tiers.

A successful response includes formatted `rendered_markdown`, `note_path`, `html_path`, and `images`.
The saved directory contains `note.md`, `note.html`, and `images/*.png`. Open `note.html` for the styled
preview, or move the whole directory to preserve relative image links in Markdown. The MCP text uses
absolute local image paths. A remote client cannot access the server's local files automatically.

The live author receives complete timestamped speech and labeled contact sheets, and generates
chapter text and image choices together. Images carry original-frame timestamps, without generated captions. Small videos use one author request. Large inputs
are divided at sentence boundaries, preserving all speech and frame bindings; only global overview
and takeaways need a final summary request. The host validates IDs, chronological order, image binding
and output limits. One malformed chunk may be regenerated once; transient provider errors retain
bounded retries without repeating acquisition or completed chunks. There is no extra model judge.

Contact sheets retain the last partial group. Up to 24 original PNG screenshots are published, without
replacing them with thumbnails. A talking-head video may have no useful screenshots. Time links identify
referenced speech intervals; they do not promise word alignment. Full original transcription and audio
review disagreements remain available. Reference checks do not prove factual accuracy or zero omissions.

The visual author defaults to official DeepSeek `deepseek-flash` at `https://api.deepseek.com`,
using `DEEPSEEK_API_KEY`. Apple Silicon retains local MLX transcription. Standard and precise
audio review still use SiliconFlow `Qwen/Qwen3-ASR-1.7B` and require `SILICONFLOW_API_KEY`;
fast quality with local MLX requires no SiliconFlow key. There is no automatic model downgrade.

The private model profile controls `response_format` (`json_object` or `json_schema`) and
`enable_thinking`. `thinking_budget` bounds reasoning tokens (128–32768); it is sent only when
thinking is enabled on SiliconFlow. DeepSeek uses its native `thinking.type` control instead.
Schema mode uses the same
contract as local validation; chapters select at most two images. Schema validity does not establish
semantic correctness.
Unsupported requests fail explicitly, with no automatic model or output-mode fallback.

Reported provider token usage is recorded per stage in the private operator event stream. Missing
usage is unknown, not zero. Rate limits return an explicit error instead of unbounded automatic retries.

## Public video links

`video_note.create({"url":"https://cn.tradingview.com/chart/XRPUSDT/e9QiRzXx/","quality":"fast"})`
also accepts a public HTTPS page containing one progressive MP4/WebM video, or a direct HTTPS video URL.
Bilibili and YouTube always use their dedicated adapters; a platform error does not trigger a bypass.
The generic extractor has no site-specific prompts. It rejects playlists with multiple videos, live
streams, manifests, DRM, authentication, redirects, non-public destinations and non-HTTPS URLs.
Only a complete video with an audio track and at least 720p can reach transcription. Unsupported
pages return a typed failure; arbitrary websites are not guaranteed to work. No cookies or proxy
are used by this fallback.

Generic sources use the downloaded file's measured duration; unknown author/date remain visibly
unknown. Their time labels are references, and links return to the source page without claiming seek
support. Generic media/transcripts are not cached because a URL can change content without changing
its metadata. All quality tiers, screenshot selection, authoring and publication use the same pipeline.

## Setup

Python 3.14, FFmpeg and the locked service environment are required:

```bash
uvx --from 'uv==0.12.3' uv sync --frozen --all-groups
export DEEPSEEK_API_KEY='set-in-your-private-shell'
# Required for standard/precise audio review or cloud primary ASR:
export SILICONFLOW_API_KEY='set-in-your-private-shell'
uvx --from 'uv==0.12.3' uv run --frozen video-note-mcp
```

Apple Silicon defaults to local MLX Whisper large-v3. Install its separate Python 3.12 runtime once
(the service remains on Python 3.14):

```bash
uvx --from 'uv==0.12.3' uv venv --python 3.12 ~/.local/share/bilibili-note-mcp/mlx-venv
uvx --from 'uv==0.12.3' uv pip install --python ~/.local/share/bilibili-note-mcp/mlx-venv/bin/python 'mlx-whisper==0.4.3'
~/.local/share/bilibili-note-mcp/mlx-venv/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download("mlx-community/whisper-large-v3-mlx", revision="49e6aa286ad60c14352c404340ded53710378a11")'
```

`BILIBILI_NOTE_ASR=mlx|siliconflow` overrides engine selection. `BILIBILI_NOTE_MLX_PYTHON` can select
another compatible runtime. Missing weights or a failed local worker produce an explicit error;
there is no automatic paid fallback. The visual note model uses official DeepSeek.
The cloud ASR profile uses `Qwen/Qwen3-ASR-1.7B`. Its text-only responses retain host-owned
45-second time windows, not word or sentence timestamps.

Local transcription and verified media are reused for 24 hours in
`~/.cache/bilibili-note-mcp/material-v1` (`BILIBILI_NOTE_CACHE_DIR` overrides it). Metadata is refreshed
on each request; changed metadata/model revision or digest mismatch prevents reuse. The cache stops
adding entries at 8 GiB and does not automatically delete existing entries. Cloud ASR is not cached.
Screenshot candidates grow with duration, up to 48 across the timeline; notes select at most 24 images.
This sampling improves coverage but cannot guarantee every visual detail is captured.

Register that stdio command in the client using this directory as its working directory. Keep keys in
private local environment configuration. The optional `BILIBILI_NOTE_OUTPUT_DIR` chooses a host-owned
absolute output directory; the default is `~/.local/share/bilibili-note-mcp/notes`. Each completed
request gets a unique directory. Outputs remain until explicitly deleted. Temporary source media and
provider credentials are not included. Interrupted delivery can leave a completed local bundle.

`BILIBILI_NOTE_EGRESS_PROXY` and `BILIBILI_NOTE_MEDIA_PROXY`, if used, must be explicit unauthenticated
loopback HTTP endpoints. No proxy is required by default.

The public success schema is `bilibili-note.result/v4`; errors use
`bilibili-note.error/v1`. This replaces the old text-only result. The direct-create input is unchanged.

## Verification

```bash
uvx --from 'uv==0.12.3' uv run --frozen python scripts/export_schemas.py --check
uvx --from 'uv==0.12.3' uv run --frozen ruff check src tests scripts
uvx --from 'uv==0.12.3' uv run --frozen ruff format --check src tests scripts
uvx --from 'uv==0.12.3' uv run --frozen mypy src
uvx --from 'uv==0.12.3' uv run --frozen python -m pytest -q
uvx --from 'uv==0.12.3' uv run --frozen python -m video_note_mcp --self-check
```

The self-check explicitly uses deterministic fixture content; it does not prove live provider quality.
Live acceptance must include non-domain-specific material and viewing the actual exported screenshots.

## 转录精度档位

`video_note.create` 接受可选 `quality`，默认 `standard`：

- `fast`：完整单路转写、笔记与原始截图核对。
- `standard`：额外复听最多三个包含疑似异常、重复、字母或数字的片段。启发式筛选不能找出所有错词。
- `precise`：第二种 ASR 复核全部音频，耗时与成本更高。

例如 `video_note.create({"url":"视频链接","quality":"precise"})`。
CLI 同样支持 `--create URL --quality precise`。已有内部 Python 调用默认仍为 `fast`。

所有档位都不依赖字幕，保留完整原转录、时间段与复核分歧。复核结果不会擅自覆盖原文，
两路一致也不代表绝对准确。复核使用硅基流动另一种 ASR，需配置密钥；失败会明确返回错误，
不会暗中降档。精度档位表示处理深度，不承诺固定错误率。确定性 fixture 验证请显式使用 `fast`。

模型服务临时繁忙、限流或网络中断时，MCP 会保留已完成步骤，只重试当前请求，最多三次，
采用退避等待并遵循有上限的 Retry-After。整个步骤受总超时约束；用户取消会立即停止重试。
参数、鉴权、输出格式和内容校验失败不盲目重试。进度通知显示重试次数；最终 HTTP 错误保留状态码，
不会只返回笼统的“请求失败”，也不会暗中更换模型或降低质量档位。

The HTML preview presents chapter summaries, screenshots and time links without a transcript appendix or a repeated takeaway section.
Markdown retains the complete linear transcript for reference.
