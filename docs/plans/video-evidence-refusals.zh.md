# video-note-mcp 拒绝清单与 video-evidence 处置表

状态：PR1 定稿，[视频取证决策记录](video-evidence-refactor.zh.md)的附表。日期 2026-10-10。

**摘要。** 旧服务的拒绝归为 92 行（E、U、S、R、D、L、P、C、T、F、N、A、J、X 共 14 组）。用户 2026-10-10 点名
放宽的（A 类）是出站网络五项：DNS 固定、重定向拒绝、主机白名单、回环代理限制、请求预算，代之以 yt-dlp 旗标
白名单、通用页私网主机检查、容器白名单与回执清洗。

普查时新路径上还有 11 处拒绝面既没保留也没被完全替换（C 类）。PR1 把其中能事后从字节重算的部分做成了检查器
的失败检查：`receipt_matches_probe`（S7）、`max_side_pixels`（R1）、`hd_floor`（R2）、每个子进程的超时（P1）、
`regular_files_only`（原 `no_symlink`）与不跟随链接的 `present`（L2）、严格 JSON（J1）、`frame_in_cited_span`（F7），
并让检查器自己的 ffprobe/ffmpeg 保留 `-protocol_whitelist file,pipe` 并加容器白名单（D1），`sha()` 与 `pcm()` 改为
流式哈希；2026-10-10 复核后又恢复 R3 `duration_ceiling`、T2 `engine_pinned`，并加 R4 的事后 `max_bytes` 与下载配方的
`ulimit -f`。必须发生在网络请求
之前的预防仍是 skill 规则或固定旗标：旗标白名单、`host_check.jq`（补上 scheme、端口、userinfo、`.test/.invalid`）、
cookie 规则、本地文件 `[ ! -L ]`。第 4 节的 C 类已由用户 2026-10-10 全部授权、委托 Agent 逐条取舍。

## 1. 口径

- 旧代码：`services/video-note-mcp`，行号对应 `ad0412c4e`（该目录最后一次改动是 `37ce449f7`，主 checkout 与本 worktree 内容一致）。PR 1 只冻结旧服务、不删除，旧拒绝在旧服务里原样存在。本表比较的是**研究取材改走 skill 之后**，新路径上还剩什么。
- 普查方法：`src` 内全部匹配 `raise ` 或 `BilibiliNoteFailure(` 的 352 行（含 `BilibiliNoteFailure`、`ValueError`、`OSError`、`StrictJsonError`、`StdioFrameRejected`、`RuntimeError`、`_raise`、`_failure`），加上不抛异常的拒绝（例如 `return 2`、哨兵帧、`allow_redirects=False`、yt-dlp 选项、环境清洗、CSP），以及 `README.md`、`bilibili-note.md` 中的拒绝句。同一目的的多处写成一行，并列出全部 `file:line`。路径省略前缀 `services/video-note-mcp/src/video_note_mcp/`。
- 新侧对照：PR1 的 `.agents/skills/video-evidence/`（SKILL.md、`references/*.md`、`assets/*`）与 `services/video-evidence/check_bundle.py`，以及用户 2026-10-10 已定的「yt-dlp 旗标白名单」，即只用 `acquire.md`、`custody.md` 配方里出现的旗标。
- 处置：**KEPT** 表示同一拒绝仍在，落点写明是 skill 规则、固定 CLI 旗标还是 checker 检查名。**REPLACED** 表示换成别的机制覆盖同一危害，覆盖不全时标「部分」。**DROPPED** 表示无替代，并写明为什么对单用户本机壳代理是安全的。普查阶段的「建议 KEPT」已在 PR1 实现，表中改记 KEPT。
- 授权列：
  - **A**：用户 2026-10-10 已点名放宽的五项，即 DNS 固定、重定向拒绝、主机白名单、回环代理限制、请求预算。
  - **B**：新路径上不存在该载体，例如 MCP stdio、内部 LLM 作者、云 ASR、24 h 缓存仓、worker IPC、质量档位。新路径上没有可被这条拒绝保护的面，只需记入决策记录。
  - **C**：新路径上同一个面还在，拒绝没有保留，也没有被完全替换，又不属于 A。C 类的取舍见第 4 节。
  - **—**：KEPT，或等价替换。

## 2. 拒绝表

### 2.1 出站网络（DNS、主机、重定向、代理、预算）

| # | 拒绝（code / reason / 消息） | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| E1 | `resolver_host_changed`（OSError） | adapters/egress.py:31-32 | 固定解析器只给已审主机返回已审地址，连接时不能换主机 | DROPPED | 自写的 `wbi/view` 客户端整体由 yt-dlp BiliBili 提取器取代，不再做 DNS 固定 | A |
| E2 | ACCESS_DENIED `egress_address_invalid`、`egress_address_not_public`；SOURCE_UNAVAILABLE `egress_dns_failed`、`egress_dns_empty` | adapters/egress.py:50-69 | 元数据请求只连 `is_global` 地址，防止 SSRF 打到内网或回环。历史上 Clash Fake-IP（198.18/15）触发过 | DROPPED（部分替换） | 只有通用页在下载前跑 `assets/host_check.jq`：只看页面声明的 `webpage_url`、`url`、`formats[].url`，拦 IP 字面量、`[`、`localhost`、单标签、`.local/.lan/.internal/.localhost/.home.arpa`。YouTube/Bilibili 不查，重定向与 DNS 重绑不查。单用户 Mac 上接受，共享或云主机要靠 harness 网络策略 | A |
| E3 | ACCESS_DENIED `egress_url_invalid`、`egress_scheme_denied`、`egress_port_denied`、`egress_credentials_denied`、`egress_host_denied`（只认 `api.bilibili.com`）、`egress_ip_literal_denied` | adapters/egress.py:72-93 | 元数据出站只到 `https://api.bilibili.com:443`，不带凭据，不用 IP 字面量 | DROPPED | 自写 Bilibili API 客户端删除，主机由 yt-dlp 提取器决定 | A |
| E4 | ACCESS_DENIED `egress_proxy_invalid`（代理只能是显式、无认证、回环 `http://127.0.0.1` 或 `::1` 带端口） | adapters/egress.py:96-115；调用于 adapters/_youtube_worker.py:117、adapters/_ytdlp_worker.py:177-180、adapters/youtube_source.py:38-43、adapters/bilibili_media_ytdlp.py:309-316 | 流量不经未审的代理 | DROPPED | skill 规则：不改网络路径、不加代理，要改须问用户。旗标白名单不含 `--proxy`，`--ignore-config` 挡住配置文件注入的 `--proxy`。**后果**：没给 `--proxy` 时，stock yt-dlp 会读环境变量 `HTTP(S)_PROXY`（yt-dlp `YoutubeDL.py:4215` `urllib.request.getproxies()`），而旧服务用 `proxy: ""` 和 `trust_env=False` 关掉了它 | A |
| E5 | 元数据请求不跟随重定向（`allow_redirects=False`、`follow_redirects=False`），超时 total 30 s、connect 15 s，`trust_env=False`，`auto_decompress=False` 加 `Accept-Encoding: identity`，连接数 `limit=2` | adapters/egress.py:124-143, 153-158, 178-187 | 重定向绕过主机白名单、环境代理、解压炸弹、并发 | DROPPED | 载体删除；yt-dlp 自己处理超时与解压 | A（重定向）/ B（其余） |
| E6 | SOURCE_UNAVAILABLE `metadata_too_large`（2 MiB）、`egress_request_failed`、`metadata_json_invalid`、`metadata_shape_invalid` | adapters/egress.py:159-203 | 元数据响应体的上限与严格解析 | DROPPED | 载体删除 | B |
| E7 | `youtube_redirect_denied`（补丁 `RedirectHandler.redirect_request`） | adapters/extractor_http.py:27-28；装入 adapters/_youtube_worker.py:156-159、adapters/_generic_worker.py:111-114 | YouTube 与通用 worker 拒绝一切重定向，包括同主机的 googlevideo 302 | DROPPED | 无替代。这条正是 doz72-I2LKM 丢失、S19/S24/S33/S42/S43 首试失败的原因 | A |
| E8 | `youtube_nonpublic_address`（补丁 `socket.getaddrinfo`，代理端口除外） | adapters/extractor_http.py:31-42；装入位置同 E7 | worker 内一切连接只到公网地址 | DROPPED（部分替换） | 同 E2，只剩通用页下载前的 host_check | A |
| E9 | `youtube_egress_denied`（每个 `urlopen` 须 https:443、无凭据、无片段，主机属于 {`youtube.com`、`www.`/`m.youtube.com`、`youtubei.googleapis.com`、`*.googlevideo.com`}） | adapters/_youtube_worker.py:37-51, 54-59 | YouTube 主机白名单 | DROPPED | 请求主机由 yt-dlp Youtube 提取器决定 | A |
| E10 | `build_request_director([UrllibRH])`，只用 urllib 处理器 | adapters/_youtube_worker.py:68-69；adapters/_generic_worker.py:43-44 | 让 E7、E8 的补丁无法被 curl_cffi、requests、websockets 处理器绕过 | DROPPED | 只为 E7、E8 存在 | A |
| E11 | `generic_request_limit`（一次提取最多 24 个请求），且每个 `urlopen` 重做 `validate_generic_url` | adapters/_generic_worker.py:30-41 | 通用页的请求预算；页面引出的每个后续 URL 都重审 | DROPPED（部分替换） | 下载前的 host_check 只审页面声明的 URL，后续请求与重定向不审 | A |
| E12 | `bilibili_media_url_invalid`（媒体 URL 须 https:443、无凭据，主机后缀为 `.bilivideo.com` 或 `.akamaized.net`） | adapters/_ytdlp_worker.py:243-260, 316 | Bilibili 媒体主机白名单 | DROPPED | 自写 html5 playurl 路径删除，改由 yt-dlp BiliBili 提取器取 DASH | A |
| E13 | `youtube_response_too_large`（非媒体响应 4 MiB，媒体 2 GiB） | adapters/extractor_http.py:10-24；adapters/_youtube_worker.py:60-66；adapters/_generic_worker.py:41 | 单个响应体的字节上限 | REPLACED（部分） | 媒体靠固定旗标 `--max-filesize 2G`，但它只比较声明的 Content-Length（yt-dlp `downloader/http.py:219-226`），长度未知的流不封顶。页面与元数据响应不再设上限 | A（预算）+ C（见 R4） |
| E14 | 通用 worker 只注册 `GenericIE`（`auto_init=False`, `ie_key="Generic"`），不能转交其他平台提取器 | adapters/_generic_worker.py:115-118 | 让通用路径的请求准入覆盖全部请求 | DROPPED | stock 通用提取器会转交其他提取器，例如 jwplayer 转 Youtube（yt-dlp `extractor/generic.py:1239-1240`）。这条随 E11 一起放宽，后果列在第 4 节 | A（随请求准入） |
| E15 | HTTP 与信封的具名拒绝：429 `source_rate_limited`、412 `source_risk_control_blocked`、401 `source_login_required`、403 `source_access_forbidden`、451 `source_region_restricted`、其他非 2xx `source_http_failed`；信封 -412、-403 | adapters/egress.py:205-220；adapters/bilibili_http.py:15-25 | 区分「可等待」「需登录」「不可为」，不对 403/451 盲目重试 | REPLACED | `acquire.md` 失败表（逐字症状对应动作）：412 或限流等一阵重试一次；403 同一命令最多重跑两次，之后问用户；删除、地区限制、仅会员可见即停；cookie 或换网络都须用户同意 | — |
| E16 | yt-dlp 选项硬化：`remote_components=set()`（不下载远程 EJS 组件）、通用路径 `js_runtimes={}`、不设外部下载器、`cachedir=False` | adapters/_youtube_worker.py:133-153；adapters/_generic_worker.py:98-110；adapters/_ytdlp_worker.py:192-212 | 不从远端拉可执行组件，不调用外部下载器（设计第 116-121 行 "external media downloaders are unavailable"） | KEPT / DROPPED | 旗标白名单：`--remote-components`、`--downloader`、`--downloader-args`、`--exec`、`--use-postprocessor`、`--netrc-cmd`、`--ffmpeg-location`、`--plugin-dirs`、`--config-locations` 都不在白名单（挑战者 1 实测过 `--use-postprocessor Exec:` 可执行命令）。`cachedir` 与 `js_runtimes` 不再设：通用提取器本身不跑 JS，`~/.cache/yt-dlp` 缓存无害 | —（cachedir 为 B） |

### 2.2 URL 文法准入

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| U1 | Bilibili：INVALID_URL `url_size_invalid`、`url_text_invalid`、`url_syntax_invalid`、`url_authority_invalid`、`url_query_invalid`、`url_query_duplicate`、`url_part_invalid`、`url_tracking_invalid`；UNSUPPORTED_URL `url_authority_unsupported`（只认 `bilibili.com`、`www.bilibili.com`）、`url_resource_unsupported`（只认 `/video/BV…`）、`url_query_unsupported`（只认 `p`、`spm_id_from`） | domain/url_policy.py:37-97 | 只接受单个 BV 视频页、可选 `p` 与跟踪参数；拒控制字符、超长、重复键 | DROPPED / REPLACED | URL 前固定加 `--`，以 `--` 开头的字符串不会被当成旗标；`"$URL"` 加引号，配方放在 `bash <<'SH'` 里（zsh 会把 `?` 当通配）。探测门槛与 `?p=` 规则见 S3 | A（主机部分）+ C（其余文法，危害面已由 `--` 与引号覆盖，列在第 4 节） |
| U2 | YouTube：`url_text_invalid`、`url_authority_unsupported`、`url_resource_invalid`、`url_syntax_invalid`、`url_query_invalid`（54、63、69 行）、`url_query_unsupported`（只认 `v/t/start/si/feature`，因此拒 `list=`）、`url_time_invalid`、`url_resource_unsupported`（拒频道和播放列表路径）、`url_video_identity_invalid`、`youtube_part_invalid` | domain/youtube_url.py:18-74 | 只接受有限的单视频 `watch`、`youtu.be`、`shorts` | REPLACED / DROPPED | 播放列表与频道：固定旗标 `--no-playlist`，探测门槛 `._type == "video"`，需要时 `-J --flat-playlist -I 1:50` 列出后逐条显式挑选。其余文法同 U1 | A/C 同 U1 |
| U3 | 通用：INVALID_URL `url_text_invalid`（≤2048、ASCII、无空白与控制字符、无 `\<>"` 和反引号、无坏 `%` 转义）；UNSUPPORTED_URL `generic_url_unsupported`（非 https、端口不是 443、带 userinfo、带片段、主机不是 LDH 名、后缀 `.localhost/.local/.internal/.test/.invalid`、`ip_literal`）；`generic_part_invalid` | domain/generic_url.py:20-62 | 通用页只到公网 HTTPS 的名字主机 | REPLACED | `assets/host_check.jq` 打印页面声明的每个非「经 443 端口、按名字访问的公网 HTTPS」URL：非 https 的 scheme、非 443 的显式端口、userinfo（`@`）、IP 字面量、IPv6、`localhost`、单标签主机、`.local/.lan/.internal/.localhost/.test/.invalid/.home.arpa`；媒体格式由选择器 `[protocol=https]` 限定 | A（非公网目的地） |
| U4 | 路由：YouTube/Bilibili 主机走专用适配器，其余走通用；UNSUPPORTED_URL `generic_source_unavailable` | domain/video_url.py:10-22；adapters/video_source.py:21-30 | 平台 URL 不落进通用路径 | REPLACED | yt-dlp 按 URL 选择提取器 | — |
| U5 | `create_note.download` 先跑 `validate_video_url`，把 `InvalidBilibiliUrl` 转成失败 | application/create_note.py:90-95 | 同 U1-U3 | 同 U1-U3 | 同 U1-U3 | 同 U1-U3 |

### 2.3 来源判定（单视频、直播、分 P、清单、DRM、鉴权、身份、元数据）

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| S1 | `youtube_video_required`；`generic_single_video_required`（清单条目不是 1 条） | adapters/_youtube_worker.py:72-74；adapters/_generic_worker.py:47-51 | 只处理单个视频 | KEPT | 固定旗标 `--no-playlist`；探测门槛 `._type == "video"`；checker `single_finite_video` | — |
| S2 | `youtube_finite_video_required`；`generic_finite_video_required`（`is_live`、`live_status`） | adapters/_youtube_worker.py:80-81；adapters/_generic_worker.py:53-60 | 拒直播与预告 | KEPT | 门槛要求 `live_status` 属于 {`not_live`, `was_live`}；checker `single_finite_video`；失败表「unavailable / live 即停」 | — |
| S3 | PART_REQUIRED `source_part_required`；`source_part_out_of_range`；`source_part_identity_changed`；`bilibili_page_list_rejected`、`bilibili_page_list_invalid`、`bilibili_part_identity_invalid` | adapters/bilibili_source.py:94-104；adapters/_ytdlp_worker.py:263-285 | 多 P 合集必须显式选 P，不能默认取第 1 P | KEPT | 门槛：`id` 以 `_pN` 结尾时，`webpage_url` 必须含 `?p=N`（BV1bK411W797 不带 `?p` 已实测被拒，`?p=2` 通过）；checker `single_finite_video` 查同一条件；P 越界由 yt-dlp 报错，逐字写入 FAILED | — |
| S4 | `has_drm`（视频级与格式级） | adapters/_generic_worker.py:57, 77 | 拒 DRM | REPLACED | yt-dlp 默认丢弃 `has_drm` 格式并报 "This video is DRM protected"（`YoutubeDL.py:2929-2932, 1192-1194`），只有 `--allow-unplayable-formats` 能放开，而它不在白名单。加密流也过不了 checker `container:` 与解码 | — |
| S5 | 清单与分片：跳过 `protocol` 不属于 {None, https}、带 `fragments`、带 `manifest_url`、只有音轨或只有视轨的格式；`generic_progressive_video_required`；`generic_formats_invalid`（超过 100 个格式）、`generic_format_invalid` | adapters/_generic_worker.py:64-88 | 只下载渐进式 HTTPS 文件，不拉 HLS/DASH 清单 | REPLACED | 固定选择器 `(b[height>=?720][protocol=https])/(bv[height>=720][protocol=https]+ba[protocol=https])`：`m3u8*`、`http_dash_segments`、`rtmp` 都不入选。YouTube 自适应流本身是 `https`，作为 DASH 原始分轨被接受，这正是设计要的身份文件。checker `container:` 拒 `hls`、`concat` 等 format_name。格式数上限不再设 | —（格式数为 B） |
| S6 | 通用路径「无鉴权」：无 cookie、无代理、URL 不带凭据（README.md:62-66 所说的 authentication） | adapters/_generic_worker.py:98-110；domain/generic_url.py:41-45 | 通用页不携带任何身份 | REPLACED | cookie 规则（仅 Bilibili、用户提供的文件、临时副本、留存前查泄漏）；旗标白名单不含通用页的 `--cookies`、`--cookies-from-browser`、`--netrc`、`--netrc-cmd`、`-u/-p`；URL userinfo 由 `host_check.jq` 打印并阻止下载 | — |
| S7 | `youtube_identity_invalid`（id 须 11 字符）、`youtube_identity_changed`（提取到的 id 与 URL 不符）；`source_video_identity_changed`（bvid 与请求不符）；SOURCE_CHANGED `media_video_identity_changed`（媒体上游 id 或 P 与元数据不符）、`media_video_identity_invalid`、`generic_media_identity_changed`；`source_identity_invalid`、`youtube_part_identity_invalid`、`generic_source_identity_invalid`、`local_source_identity_invalid` | adapters/_youtube_worker.py:75-79；adapters/bilibili_source.py:91-93；adapters/source_acquisition.py:35-40；adapters/bilibili_media_ytdlp.py:329-332；adapters/generic_source.py:42-45；domain/models.py:68-112 | 下载到的字节确实属于探测或请求的那条视频 | KEPT | 检查器 `receipt_matches_probe`：`media/receipt.json` 与 `probe/identity.json` 的 `id`、`webpage_url` 必须相同；配方自检原始 info 与回执的 `webpage_url`、`format_id` 相同；`format_known` 要求每个身份文件名对应回执里的格式 | — |
| S8 | `platform_metadata_required`（YouTube/Bilibili 必须有作者与发布时间）；`youtube_date_invalid`（date 须 8 位）；`youtube_title_invalid`、`youtube_author_invalid`；`source_owner_invalid`、`source_metadata_invalid`（pubdate 范围） | domain/models.py:98-99；adapters/youtube_source.py:116-120；adapters/_youtube_worker.py:89-93；adapters/bilibili_source.py:138-162 | 平台来源必须有作者与日期 | REPLACED（拒绝放宽为标注） | 规则：作者和日期只取平台元数据或页面结构化数据，不取标题；未知保持未知；`upload_date` 只精确到日 | —（只改标注，不扩大网络或文件面） |
| S9 | 通用来源的 `uploader` 等于主机名时，作者置空 | adapters/_generic_worker.py:129-142 | 不把域名当作者。yt-dlp 通用提取器把 `uploader` 设为域名（`extractor/generic.py:1250`），直链的 `timestamp` 取自 HTTP `Last-Modified`（同文件 855 行） | KEPT | `assets/identity.jq` 对 `Generic`、`HTML5MediaEmbed` 删除 `uploader`、`timestamp`、`upload_date`、`release_timestamp`；直链的 `Last-Modified` 不保留（不是发布时间）；作者与时间只取页面自己的结构化数据（`probe/page.json`，由 `assets/page_record.py` 取出） | — |
| S10 | 标题 `_natural_text`（去首尾空白、无控制字符），title ≤500、author ≤200 | domain/models.py:32-38, 55-66 | 标题进入笔记或文件名时不带控制字符 | REPLACED | 固定 `-o 'source.%(ext)s'`；来源文本从不进入文件名或命令行，只经 jq 读取；eval `title-metachar` | — |

### 2.4 体积、像素、时长、高清下限

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| R1 | `downloaded_media_invalid`：最大边超过 8192、像素超过 8192²、宽或高不为正（`MEDIA_SOURCE_MAX_SIDE`、`MEDIA_SOURCE_MAX_PIXELS`，application/resource_limits.py:7-8）；同一上限还在 `dimension_invalid` 中 | adapters/media_acquisition.py:74-89；adapters/local_import.py:29-34；adapters/source_acquisition.py:41-47；adapters/youtube_source.py:107-115；adapters/bilibili_source.py:122-137；adapters/media_ffmpeg.py:442-455 | 解码、PNG、ImageMagick 的内存与时间（像素炸弹） | KEPT | 检查器 `max_side_pixels:<name>`：同一次 ffprobe 读宽高，每边须在 1 到 8192 之间（像素上限随之不超过 8192²） | — |
| R2 | HD_SOURCE_UNAVAILABLE `source_below_hd_floor`（最短边 <720，或像素 <1280×720）；`bilibili_hd_media_unavailable`（quality <64）；旧 YouTube 选择器还要求 `width>=720`、`height<=1920` | adapters/source_acquisition.py:41-47；adapters/youtube_source.py:107-115；adapters/bilibili_source.py:163-168；adapters/local_import.py:29-34；adapters/media_ffmpeg.py:449-455；application/note_validation.py:84-85；adapters/_ytdlp_worker.py:307-309；adapters/_youtube_worker.py:146-149 | 证据画面 720p 下限 | KEPT | 固定选择器 `height>=720` 原子化、不降级（渐进式 `height>=?720`）；检查器 `hd_floor:<name>` 沿用旧语义：最短边 ≥720 且像素 ≥1280×720；降 720p 须用户同意，确认后仍是失败检查，写成局限 | — |
| R3 | 时长上限 `MAX_SOURCE_DURATION_MS` = 45 s × 128 = 96 分钟：`youtube_duration_invalid`、`source_duration_exceeds_supported_limit`、`SourceV1.duration_ms` 的 `le=` | domain/models.py:28-30, 64；adapters/_youtube_worker.py:82-88；adapters/bilibili_source.py:112-121 | 云 ASR 的 45 秒窗 × 128 段预算，间接限制总耗时与内存 | KEPT（事后，2026-10-10 审阅后恢复） | 检查器 `duration_ceiling:<name>`：每个身份文件最后一个包的时刻不超过 96 分钟；`sha()` 与 `pcm()` 仍是流式哈希。下载前不再拦，超长片在检查时失败 | — |
| R4 | 下载字节：`_MediaBytesExceeded`（预计或已下载超过 2 GiB，跨重试累计）；声明的 `durl.size` 超过 2 GiB；`media_size_invalid`（1 ≤ size ≤ 2 GiB）；复制时的 `media_bytes_exceeded`、`media_file_invalid` | adapters/_ytdlp_worker.py:94-115, 313-315；adapters/bilibili_media_ytdlp.py:301-302；adapters/media_acquisition.py:90-91, 143-157 | 磁盘占用与托管体积 | REPLACED（部分） | 固定旗标 `--max-filesize 2G`，只看声明长度。长度未知的流、跨重试的累计量、本地文件都不封顶。`retain_file` 本身没有体积上限，靠 checker `no_media_or_large_file_in_bundle`（包内每个文件小于 8 MiB，且不等于任何媒体哈希）、版式白名单与 `png_plain` 防止把媒体误 retain 进 Dolt。2026-10-10 审阅后检查器加 `max_bytes:<name>`（每个身份文件不超过 2 GiB，事后）；下载配方以 `ulimit -f 2097152` 由内核在写入时封顶每个文件 2 GiB，长度未知的流同样被截停（实测 yt-dlp 报 `File too large`、退出 1） | —（第 4 节第 3 条） |
| R5 | 时长一致：`media_access_restricted_preview`（实测比声明短 2 s 以上）；`media_duration_changed`（偏差超过 2 s 或 1.5 s，变长也拒）；`incomplete audio`（MLX 处理的音频时长偏差超过 2 s） | adapters/source_acquisition.py:48-52；adapters/media_ffmpeg.py:456-461；adapters/asr_mlx.py:88-89 | 拒预览截断，拒换片 | KEPT（变短）/ DROPPED（变长） | checker `not_truncated:<name>`（不短于声明 −1 s）加失败表「preview 不是来源」；`exact_size:<name>` 要求与声明 filesize 逐字节相等。变长不再拒：TradingView 实片 553.55 s 长于页面声明的 547 s，属正常。ASR 输入由 `pcm_recomputed` 绑定到整段音频 | — |
| R6 | 必须有音轨：`downloaded_media_invalid`（无 audio stream） | adapters/media_acquisition.py:81-82 | 只有带音轨的完整视频能进入转写 | REPLACED | 选择器 `b`（音视频同在）或原子化的 `bv+ba` 对；checker `input_is_audio_identity_file` 要求 ASR 输入是 SHA256SUMS 里带音轨的身份文件 | — |

### 2.5 容器与解码

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| D1 | `-protocol_whitelist file,pipe`（ffprobe/ffmpeg 只读本地文件与管道） | adapters/media_acquisition.py:31-44；adapters/media_ffmpeg.py:410-423, 532-563；adapters/asr_mlx.py:54-68；adapters/asr_siliconflow.py:62-86 | 防止媒体里夹带的 HLS/concat 列表让 ffmpeg 读网络或任意本地文件 | REPLACED / KEPT | 检查器 `container:<name>`：format_name 必须属于 {`mov,mp4,m4a,3gp,3g2,mj2`, `matroska,webm`}，否则不解码；检查器自己的 ffprobe/ffmpeg 仍带 `-protocol_whitelist file,pipe`；规则「不解码其他容器」；回归评测 `concat-as-mp4` | — |
| D2 | `generic_container_unsupported`（文件头须为 `ftyp` 或 EBML） | adapters/generic_source.py:28-34；调用于 adapters/local_import.py:73、adapters/generic_source.py:74 | 解码前拒绝冒充 mp4 的文本清单 | REPLACED | 同 D1 的 format_name 白名单。第二轮确认单独的魔数检查被它覆盖 | — |
| D3 | `downloaded_media_invalid`（ffprobe 非零退出或字段缺失）、`ffprobe_rejected_media`、`media_dimensions_invalid` | adapters/media_acquisition.py:56-80；adapters/media_ffmpeg.py:409-448 | 无法探测的文件不进入后续步骤 | KEPT | checker：探测失败时 format_name 为空，`container:` 失败，之后不再解码 | — |

### 2.6 本地文件与符号链接

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| L1 | `import_directory_not_configured`；INVALID_URL `import_filename_invalid`（根目录须绝对、不是符号链接（62 行）、是目录；文件名须匹配 `[\w .-]{1,180}\.(mp4\|webm)`，且不是 `.` 或 `..`） | adapters/local_import.py:55-67 | MCP 模型不能指定任意宿主路径；防路径穿越 | REPLACED | 路径只来自用户在对话中给出。SKILL.md 规定内容不得选择 URL、旗标、cookie、代理、路径。壳代理本来就能读用户指定的文件 | — |
| L2 | 源文件不跟随符号链接、不读非常规文件：`O_NOFOLLOW` 加 `S_ISREG`，否则 `media_file_invalid` | adapters/media_acquisition.py:143-149；调用于 adapters/local_import.py:70、adapters/artifact_store.py:137 | 不跟随链接，不读 FIFO 或设备 | KEPT | 本地文件配方在复制前检查 `[ -f "$F" ] && [ ! -L "$F" ]`；检查器 `present:<name>` 要求媒体是常规文件且不是链接，`regular_files_only` 在读取任何文件前拒绝包内的链接、FIFO 与设备 | — |
| L3 | `import_file_unavailable` | adapters/local_import.py:68-72 | 复制失败要有具名原因 | REPLACED | 阶段 `FAILED` 逐字记录 | — |
| L4 | 下载结果是符号链接时 `generic_media_invalid`；工作区须绝对、不是链接、是目录：`youtube_workspace_invalid`、`worker_workspace_invalid`、`generic_workspace_invalid` | adapters/generic_source.py:71-73；adapters/_youtube_worker.py:118-126；adapters/_ytdlp_worker.py:174-176；adapters/_generic_worker.py:95-97 | worker 写入的目录可信 | REPLACED | 每个来源新建空目录 `$ROOT/work/<key>/`；阶段先在 `.stage-<name>` 建好再 `mv`；checker `no_incomplete_stage`；结果文件由 L2 的链接检查覆盖 | — |
| L5 | 输出根：`output_root_not_absolute`、`output_root_symlink`（任一祖先是链接）；缓存根 `artifact_root_invalid` | adapters/note_publisher.py:35-39；adapters/artifact_store.py:87-92 | 写入位置不被链接重定向 | REPLACED / DROPPED | `ROOT=${VIDEO_EVIDENCE_ROOT:-$HOME/.local/share/video-evidence}`，规则「不放 Git 或 /tmp」；`material retain` 拒绝本仓库内与临时目录中的路径（`research/records/evidence.py:38-43`）。祖先链接检查不再做：单用户本机，根目录是用户自己设的 | B |

### 2.7 子进程期限、输出上限、进程回收、并发

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| P1 | DEADLINE_EXCEEDED `media_probe_timeout`（30 s）、`media_download_timeout`（媒体 360 s，元数据 90 s）、`media_subprocess_timeout`（60 s）、`audio_extract_timeout`（90 s）；MLX 解码 120 s，MLX worker 900 s | adapters/media_acquisition.py:45-53, 103-114；adapters/youtube_source.py:55-61；adapters/generic_source.py:54-60；adapters/bilibili_media_ytdlp.py:34, 270-277；adapters/media_ffmpeg.py:70-79；adapters/asr_siliconflow.py:87-95；adapters/asr_mlx.py:69, 79 | 恶意或损坏的输入让解码器、下载器挂死 | REPLACED / KEPT | 配方里长下载与 ASR 放后台、轮询输出文件（退出码不可信），由 harness 命令超时兜底；检查器每个子进程带 `timeout=600`，超时记为失败检查 `deadline:<tool>`（PCM 解码超时由 `pcm_decoded` 报出），从不挂起 | —（配方侧为 C，列名待确认） |
| P2 | 输出上限：`media_probe_output_exceeded`（stdout、stderr 各 1 MiB）、`media_subprocess_output_exceeded`、`audio_extract_output_exceeded`、`media_worker_receipt_invalid`（64 KiB）、MLX stdout ≤2 MiB、`ProcessOutputLimitExceeded` | adapters/media_acquisition.py:54-55, 115-116；adapters/media_ffmpeg.py:80-81；adapters/asr_siliconflow.py:96-97；adapters/asr_mlx.py:80-81；adapters/subprocesses.py:76-92；application/resource_limits.py:3-5 | 子进程输出撑爆内存 | DROPPED | 检查器读到的 ffprobe JSON 与 framehash 文本都很小；PCM 改为流式哈希，不需要字节上限 | C（列名待确认） |
| P3 | 进程组回收：`start_new_session`、先 SIGTERM 后 SIGKILL、`process_group_not_reaped`；取消传播 `owned_tasks` | adapters/subprocesses.py:26-61, 153-191；application/owned_tasks.py:6-37 | 取消或超时后不留下孤儿 yt-dlp、ffmpeg、MLX 进程 | REPLACED | 没有常驻服务。规则：中断后先跑 `pgrep -fl '[y]t-dlp\|[f]fmpeg'`，再删 `*.part`、`*.ytdl`；`.stage-*` 加 checker `no_incomplete_stage` | B |
| P4 | 并发：解码 3 路、MLX 1 路（`Semaphore(1)`）、云 ASR 3 路；缓存仓提交锁 `artifact_store_busy` | adapters/media_ffmpeg.py:60, 203；adapters/asr_mlx.py:45, 51；adapters/asr_siliconflow.py:32, 111；adapters/artifact_store.py:103-110 | 机器负载、MLX 显存、并发写入 | KEPT（MLX）/ REPLACED | `transcribe.md`：一次只跑一个 MLX 任务。媒体按内容寻址，`mv -n` 原子落盘，"already held" 表示字节相同。帧用单次解码配方 | —（解码并发为 B） |

### 2.8 Cookie、环境、隐私

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| C1 | `cookie_file_invalid`、ACCESS_DENIED `bilibili_cookie_file_invalid`（须绝对路径、不是符号链接、是常规文件） | adapters/_ytdlp_worker.py:141-149；adapters/bilibili_media_ytdlp.py:81-88 | yt-dlp 回写 cookie 文件时不经链接写到别处；不自动发现 cookie | REPLACED | cookie 规则：只用用户为此提供的文件，只用于 Bilibili；先 `cp` 成 `.cookies.tmp` 再传入（yt-dlp 会回写所给文件）；留存文件里不得出现任何 cookie 值（`grep -F -f`）；不记录 cookie 路径 | — |
| C2 | 不自动读浏览器 cookie（README.md:21-22，设计第 107-108 行） | 代码中从未设置 `cookiesfrombrowser` | 不读浏览器 cookie | KEPT | 旗标白名单不含 `--cookies-from-browser`；`--ignore-config` 阻止配置文件注入；eval `planted-config` | — |
| C3 | worker 环境清洗：只传 `PATH LANG LC_ALL SSL_CERT_FILE SSL_CERT_DIR`，去掉 API key、代理变量、`PYTHONPATH` 等 | adapters/media_acquisition.py:120-124 | 下载子进程拿不到密钥、环境代理、插件路径 | DROPPED / REPLACED | 新路径没有 API key（DeepSeek、SiliconFlow 已退出）；`--no-plugin-dirs` 挡住来自 `PYTHONPATH` 或工作目录的插件；`--ignore-config` 挡住配置文件；环境代理现在生效，见 E4 | A（代理）+ B（密钥） |
| C4 | 封闭式失败回执：worker 只回 `youtube_acquisition_failed`、`generic_acquisition_failed` 或封闭分类，不外泄上游文本（URL、标题、cookie 路径） | adapters/_youtube_worker.py:181-189；adapters/_generic_worker.py:145-153；adapters/_ytdlp_worker.py:532-590（尤其 584-588） | 隐私：错误文本里的签名 URL、IP、cookie 路径不进入响应与日志 | REPLACED（方向反转） | `<stage>/FAILED` 写逐字错误行（去掉查询串）与命令；checker `no_signed_url_or_cookie:<stage>/FAILED` 扫 `ip/oi/mid/buvid/upsig/sig/expire` 与 `cookie`；规则「不保留原始 info JSON 与 `-v` 日志」「不记录 cookie 路径」。改向的理由：封闭回执掩盖了 S19/S24/S33/S42/S43 的真因。注意 FAILED 可经 `material retain` 进入只追加的 Dolt，而泄漏正则不覆盖本机用户路径 | C（隐私方向改变，列在第 4 节） |
| C5 | 操作员事件：字段白名单；值不超过 64 字符且无换行（不记 URL、正文、密钥）；每行不超过 2048 B；sink 路径须绝对、不是链接、是常规文件；`O_NOFOLLOW` | application/operator_events.py:86-117, 130-135, 172-190 | 运行日志不泄漏 | DROPPED / REPLACED | 不再有操作员日志。receipt 走 `assets/receipt.jq` 白名单投影，加泄漏 grep 与 checker `no_signed_url_or_cookie` | B |
| C6 | 凭据与签名 URL 不持久化（设计第 151 行 "credentials are never persisted"） | 分散在 C4、C5、adapters/artifact_store.py | 隐私 | KEPT | `identity.jq` 与 `receipt.jq` 白名单投影，通用来源的媒体 URL 去掉查询串，平台来源不留媒体 URL；`custody.md` 泄漏 grep；checker `no_signed_url_or_cookie:*` 覆盖 probe、media、FAILED | —（即用户已授权的「receipt 清洗」） |

### 2.9 转写

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| T1 | TRANSCRIPT_INCOMPLETE `local_asr_failed`：解码失败、worker 非零退出、回执不合 `_Receipt`（语言 1-32 字、1-4096 段、每段不超过 16000 字、时间非负） | adapters/asr_mlx.py:26-36, 73-98 | 失败或残缺的转写不被当成成功 | REPLACED | 输出门槛：`test -s transcript.json`，stdout 里没有 `^Skipping`，`.segments` 长度大于 0（mlx_whisper CLI 失败时也退出 0），否则写 `asr/FAILED`；checker `transcript_nonempty`、`run_identity`。段数与长度上限不再设 | — |
| T2 | `MLX runtime version mismatch`（mlx-whisper 必须是 0.4.3） | adapters/_mlx_worker.py:18-19 | 引擎版本漂移 | KEPT（2026-10-10 审阅后恢复） | 检查器 `engine_pinned`：`run.json` 的 `versions.mlx-whisper` 必须是 0.4.3、模型必须是钉住的 repo 与 revision；`argv_is_recipe` 要求 argv 与配方逐项相同。Qwen3-ASR 测量结论是暂不切换；换引擎要改检查器 | — |
| T3 | 权重固定：`local_files_only=True`，revision `49e6aa28…` | adapters/_mlx_worker.py:21-25 | 不联网拉取未钉版本的权重 | KEPT | `HF_HUB_OFFLINE=1` 加绝对快照路径；`run.json.model {repo, revision, weights_sha256}` | — |
| T4 | `invalid worker audio`（须单声道、16 kHz、s16）、`truncated worker audio` | adapters/_mlx_worker.py:26-36 | ASR 输入的格式与完整性 | KEPT | 固定 `ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le`；checker `pcm_recomputed` 用相同参数从音频身份文件重算 PCM 哈希 | — |
| T5 | `transcript_coverage_incomplete`、`transcript_timeline_invalid`（空段、E-ID 次序、重叠、越界）、`transcript_bytes_exceeded`（2 MiB）、段数不超过 4096 | application/transcript_validation.py:7-35 | 转写覆盖完整，时间线自洽 | REPLACED（拒绝改为旗标） | E-ID 由段序派生，不存储；检查器只在 `flags` 下给出 `tail_gap_s`、`gaps_over_3s`、`loops`、`too_dense`、`too_sparse`、`empty_or_outside`、`repeats`、`numbers_to_verify` 与 `claims_citing_flagged`，从不决定 `ok`（阈值只按一位普通话作者调过）；`schema_known` 要求 Whisper 键齐全，不把缺失的 `compression_ratio` 当 0 | — |
| T6 | 云 ASR 全部拒绝：`asr_credential_unavailable`、`audio_extract_failed`、`asr_rate_limited`、`asr_response_bytes_exceeded`（256 KiB）、`asr_response_invalid`、`asr_text_empty`、`asr_text_bytes_exceeded`（16 KiB）、`transcript_bytes_exceeded`；45 s 窗 | adapters/asr_siliconflow.py:94-287 | 云服务边界 | DROPPED | 不再有云 ASR 与密钥；Qwen3-ASR 只在本地测量 | B |
| T7 | `review_engine_not_independent`（复核引擎须与主引擎不同） | adapters/audio_review.py:78-80 | 不把同一引擎复跑当作独立复核 | REPLACED | `transcribe.md`：另一个 Whisper 变体不算独立；审查者用同一命令复跑只证明可复现 | — |
| T8 | `reviewer_not_configured`（不悄悄降档）、`invalid quality`、`exactly_one_transcription_source_required` | application/create_note.py:121-126, 172-173；domain/primitive_inputs.py:58-66 | 质量档位不静默降级 | DROPPED | 质量档位与复核阶段都不存在了 | B |
| T9 | `BILIBILI_NOTE_ASR must be mlx or siliconflow`（引擎显式选择，无静默回落） | __main__.py:37-40 | 不静默换引擎 | REPLACED | 单一钉死的引擎，身份记在 `run.json` | — |
| T10 | `subtitle_empty` | adapters/subtitles.py:43-44 | 空字幕 | DROPPED | 不用字幕 | B |

### 2.10 画面

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| F1 | `frame_png_bytes_exceeded`（单帧 PNG 超过 8 MiB） | adapters/media_ffmpeg.py:353-361；application/note_validation.py:95-96；adapters/note_publisher.py:52-53；adapters/artifact_store.py:44-53 | 单个资产的体积 | KEPT | checker `no_media_or_large_file_in_bundle`（包内每个文件小于 8 MiB）。注意新网格是原分辨率 PNG，旧帧缩到不超过 1920×1080。4K 屏幕录像的单帧可能超过 8 MiB，检查会失败，届时由用户决定 | — |
| F2 | `frame_png_total_bytes_exceeded`（合计 128 MiB）、`visual_count_invalid`（2-48 帧）、`visual_group_count_invalid`、DISTILLATION_FAILED `selected_frame_count_exceeded`（最多发布 24 张） | adapters/media_ffmpeg.py:385-406；application/note_validation.py:73-75, 97-99, 129-130；application/create_note.py:263-265 | 给作者模型与 MCP 的载荷上限，48 帧上限 | DROPPED | 网格步长不超过 6 s，不设上限，保留尾帧（checker `tail_frame_kept`）；只 retain 被引用的帧 | B |
| F3 | `frame_dimensions_invalid`（帧最短边小于 720，或像素超过 1920×1080） | adapters/media_ffmpeg.py:362-371；application/note_validation.py:84-87；adapters/note_publisher.py:56-62 | 缩放后的帧尺寸 | DROPPED | 新帧保持原分辨率；720p 下限移到来源（R2） | B |
| F4 | `frame_decode_failed` | adapters/media_ffmpeg.py:564-565 | 解码失败时不出图 | REPLACED | 配方自检「PNG 数等于 framehash 行数」后才 `mv`；检查器 `png_present`、`pngs_have_rows`、`row_shape`、`recomputed:*`、`png_pixels:*` | — |
| F5 | 帧身份与分组：`frame_identity_invalid`、`frame_group_order_invalid`、`frame_group_identity_invalid`、`frame_group_size_invalid`、`frame_group_timeline_invalid`、`frame_group_dimensions_invalid`、`frame_group_binding_invalid`、`frame_group_reason_invalid`、`ordered_group_cue_invalid`、`ordered_group_count_invalid`；`artifact_frames_invalid` | application/note_validation.py:81-94, 109-132；adapters/artifact_store.py:283-295 | 旧 F01/G01 编号与 1 帧或 3 帧组的一致性 | REPLACED | 帧以 `{media_sha256, pts:"n*num/den", decoded_sha256}` 引用，且必须是某个 `grid.tsv` 的行；检查器 `row_shape`、`rows_agree`、`frame_tuple`、`bound_to_video_identity`（帧目录绑定包内唯一的视频身份文件）、`recomputed:*`、`png_pixels:*` | — |
| F6 | `asset_not_png`、`asset_digest_invalid`（PNG 签名、sha 等于 asset_ref、不重复）；`asset digest changed`、`invalid image`、`frame_image_invalid` | application/note_validation.py:100-106；adapters/note_publisher.py:54-63；adapters/direct_notes.py:66-67 | 资产字节被替换 | KEPT | checker `png_sha256`、`crop_sha256`、`parent_is_frame` | — |
| F7 | 帧时刻必须落在它绑定的语音段内：`chapter_frame_binding_invalid`（`validate_frame_bindings`） | application/note_validation.py:135-151 | 画面与它佐证的那句话同时出现 | KEPT（证据层） | 检查器 `frame_in_cited_span:C<n>`：claim 引用的帧与裁剪父帧的 pts 必须落在所引语音段 [最早开始 −0.5 s, 最晚结束 +0.5 s] 内，`explicitness == "visible_only"` 除外；`number_has_frame_or_label` 只认时段内的帧或裁剪、sidecar 或 `asr_only` | — |

### 2.11 笔记作者、渲染、发布

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| N1 | `note_evidence_invalid`（引用的 E-ID 必须存在且不重复） | application/note_validation.py:35-40 | 笔记不引用不存在的话 | DROPPED（笔记不是证据） | 检查器不再读笔记；`note.md` 规则要求每个要点引用 E-ID、不引用被标记段 | B |
| N2 | `chapter_order_invalid`；笔记图片须落在章节与语音段内（`chapter_frame_binding_invalid`，66 行） | application/note_validation.py:41-66 | 章节按时间排列，图文对应 | REPLACED（规则） | `note.md`：章节按时间顺序；图片只用包内相对路径，放进所引语音包含其时刻的那一章 | — |
| N3 | `note_text_too_large`、`terminal exceeded`、`bundle_count_invalid`；`VideoNote` 字段上限（overview ≤4、chapters ≤16、points ≤16、screenshots ≤5、takeaways ≤12、text ≤3000）；`ErrorV1.reason` 正则 | application/note_validation.py:33-34；adapters/note_publisher.py:33-34, 71-75；domain/models.py:115-150 | MCP 响应与作者输出的体积 | DROPPED | 不再有 MCP 响应与作者模型 | B |
| N4 | 作者预算：`transcript_bytes_exceeded`、`author_input_budget_exceeded`（48 KiB × 16 块）、`author_output_budget_exceeded`、`author_summary_budget_exceeded`（96 KiB） | adapters/direct_notes.py:100-101, 144-156, 203-208, 247 | DeepSeek 作者的载荷 | DROPPED | 内部作者退役，由调用方 Agent 写笔记 | B |
| N5 | 模型客户端：`provider_key_missing`、`vision_request_too_large`（48 MiB）、`provider model identity is missing or changed`、`incomplete response`、`invalid content`（超过 128 KiB）、`provider_timeout`、`provider_response_invalid`、`vision_response_too_large`（256 KiB）、`provider_http_<status>`、`provider_transport_retries_exhausted`；`follow_redirects=False`、`trust_env=False` | adapters/model_client.py:40-180 | 云模型边界 | DROPPED | 同 N4 | B |
| N6 | 模型配置：`model profile is invalid`、`model output settings are invalid`、`thinking budget is invalid` | config.py:41-49 | 配置合法 | DROPPED | 不再有模型 profile | B |
| N7 | HTML 转义加 CSP（`default-src 'none'`，无脚本，无远程资源） | presentation/markdown.py:3, 29-42, 104, 137-145, 182-190 | 模型或来源文本不变成可执行标记 | REPLACED | `pandoc -f markdown-raw_html-yaml_metadata_block --lua-filter note.lua -s --embed-resources`，原始 HTML 与 YAML 元数据不读入，元数据只留标题，所有元素的属性清空（pandoc 会嵌入 `data-src`、`poster` 等属性指向的资源）；`note.md` 规定图片只用包内相对路径，不链接包外图片 | B（CSP） |
| N8 | 发布原子性：`bundle collision`（不覆盖）、`bundle_publication_failed`、`asset bytes exceeded` | adapters/note_publisher.py:41-91 | 不覆盖已发布的笔记，失败不留半成品 | REPLACED | `note.md` 写在包内；阶段 `.stage-*` 完成后再 `mv`；规则「完成的阶段不重做」 | — |

### 2.12 24 h 缓存仓 artifact_store

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| A1 | ARTIFACT_UNAVAILABLE `artifact_expired`（24 h TTL）、`artifact_capacity_exceeded`（256 条、8 GiB）、`artifact_manifest_too_large`（8 MiB） | adapters/artifact_store.py:68-85, 111-132, 154-158, 182-186 | 有界缓存 | DROPPED（有意） | TTL 与持久托管正好相反。媒体按内容寻址存为 `$ROOT/sha256/<sha>.<ext>`，用 `rsync` 备份，再跑哈希循环（不一致打印 BAD） | B |
| A2 | `artifact_store_invalid`（未知条目、链接、非常规文件、锁文件不是常规文件）、`artifact_store_busy`、`artifact_id_invalid`、`artifact_missing`、`artifact_digest_invalid`、`artifact_manifest_invalid`、`artifact_file_invalid`、`artifact_file_too_large`、`artifact_media_invalid`、`artifact_files_invalid`、`artifact_parent_mismatch`、`artifact_invalid` | adapters/artifact_store.py:40-64, 87-212, 236-240 | 读回时重新校验内容 | REPLACED | 复制后先 `shasum -a 256 -c` 再 `mv -n`；checker `present:`、`sha256:`；研究托管的 `artifact://source_media/sha256/…` 由 `show`、`validate` 重算哈希（不符即失败），发表预检只报告缺失或不符（`research/records/cli.py` 的 `_check_ref`，`ledger.evidence_read_findings`）；`compare` 只读运行的 audit 引用；另见 L2 的链接检查 | — |

### 2.13 严格 JSON、MCP 准入、IPC

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| J1 | `StrictJsonError`：嵌套超过 128 层、NaN/Infinity、重复键、根不是对象、十进制或整数字符串格式不对 | adapters/strict_json.py:19-103；消费方为 worker 回执、Bilibili API、ffprobe JSON、模型输出 | 解析器歧义（重复键时不同解析器取不同的值）、非有限数 | 原消费方：DROPPED；检查器：KEPT | 检查器 `load()` 用 `object_pairs_hook` 拒重复键、`parse_constant` 拒 NaN/Infinity、根必须是对象，失败记为 `readable_json:<path>` | — |
| J2 | MCP stdio 准入：帧超过 1 MiB、不是严格 UTF-8、非有限数、超出 int64、重复键、深度超过 32、根不是对象；钉 `mcp==2.0.0`；包装器身份检查 | stdio_admission.py:16-236 | JSON-RPC 对端 | DROPPED | 不再有 MCP 服务 | B |
| J3 | 工具参数：`tool_name_invalid`、`tool_arguments_invalid`（`StrictModel` 的 extra=forbid、strict）；`exactly_one_media_source_required`、`exactly_one_evidence_source_required`、`media_import_fields_invalid`、`transcript_import_fields_invalid`；URL ≤2048；结果模型的长度上限 | mcp_server.py:307-317；domain/primitive_inputs.py:10-83；domain/primitive_results.py:18-33；domain/models.py:41-52 | 工具输入 | DROPPED | 同 J2 | B |
| J4 | worker IPC：stdin 超过 16 KiB（`youtube_request_too_large`、`generic_request_too_large`、`_ytdlp_worker` 返回 2）；请求键集合（`youtube_request_invalid`、`worker_request_invalid`、`generic_request_invalid`、`worker_proxy_invalid`）；回执 schema（`youtube_worker_failed`、`youtube_worker_receipt_invalid`、`generic_receipt_invalid`、`media_worker_receipt_invalid` 共 8 处、`invalid_metadata`） | adapters/_youtube_worker.py:109-129, 181-189；adapters/_ytdlp_worker.py:152-182, 510-518, 572-576；adapters/_generic_worker.py:91-97, 145-153；adapters/youtube_source.py:62-70；adapters/generic_source.py:61-70；adapters/bilibili_media_ytdlp.py:116-280；adapters/media_acquisition.py:115-116 | 父子进程之间的协议 | DROPPED | 直接调用 stock CLI | B |
| J5 | Bilibili API 严格解析：`bilibili_api_response_invalid`（为空、超过 2 MiB、不是对象、不是正整数）、`bilibili_playurl_rejected`、`bilibili_playurl_invalid`（`durl` 必须恰好 1 段）；`source_metadata_invalid`、`source_metadata_rejected`、`source_parts_invalid`、`source_parts_empty`、`source_owner_invalid`、`dimension_invalid` | adapters/_ytdlp_worker.py:220-317；adapters/bilibili_source.py:28-162 | 自写 API 客户端的输入 | DROPPED | 改用 yt-dlp BiliBili 提取器，删除 html5 playurl 回落 | B |
| J6 | HTTP 体 Content-Length 严格解析：`ContentLengthError` duplicate/invalid/overflow，流式读取超限 | adapters/http_bodies.py:13-97 | 防歧义长度与超大响应体 | DROPPED | 消费方（egress、云 ASR、模型）全部退出；第二轮已列入 (d) | B |

### 2.14 重试、失败分类、编程守卫

| # | 拒绝 | 位置 | 保护什么 | 处置 | 新落点或理由 | 授权 |
|---|---|---|---|---|---|---|
| X1 | 有界重试：YouTube worker 3 次（只对 transient 与 rate_limited，间隔 1、2 s）；Bilibili 4 次（1、2、4 s）；云 ASR 4 次；模型 3 次（Retry-After 不超过 30 s）。yt-dlp 内部 `retries=0`、`fragment_retries=0`、`extractor_retries=0` | adapters/_youtube_worker.py:139-143, 160-177；adapters/_ytdlp_worker.py:34-35, 199-203, 485-509；adapters/asr_siliconflow.py:33-34；adapters/model_client.py:136-178 | 重试有界，鉴权或格式错误不盲目重试 | REPLACED | 规则：同一命令最多重跑两次，之后问用户；失败表限定哪些症状可以重跑。stock yt-dlp 默认内部 `--retries 10`、`--fragment-retries 10`、`--extractor-retries 3`，不再是 0，这属于请求预算放宽 | A（预算） |
| X2 | `_classify_failure` 封闭分类（media_too_large / rate_limited / access_denied / transient / source_unavailable）、`_flattened_short_read`；`_worker_failure` 映射到 `source_rate_limited`、`source_access_denied`、`media_size_invalid`、`complete_media_download_failed` | adapters/_ytdlp_worker.py:338-468；adapters/bilibili_media_ytdlp.py:296-303, 321-323 | 失败可行动，不夸大成「来源不可用」 | REPLACED | 逐字 FAILED 加失败表；规则「后面阶段的失败不报成来源不可用」；checker 的 `stages` 报告 present、failed、absent | — |
| X3 | 下载失败清理（`_cleanup_partial`、`_cleanup_worker_artifacts`）；`downloaded_media_ambiguous`（候选不是恰好 1 个，已排除 `.part`、`.ytdl`） | adapters/_ytdlp_worker.py:471-474；adapters/bilibili_media_ytdlp.py:282-293, 324-326；adapters/youtube_source.py:75-77；adapters/media_acquisition.py:127-132 | 半截文件不被当成媒体 | REPLACED | 中断清理规则；身份文件规则：`format_id` 含 `+` 时取 `source.f<fid>.*`，否则取 `source.<ext>`，并写入 SHA256SUMS；checker `present:`、`sha256:`、`exact_size:` | — |
| X4 | 内部不变量：`unexpected_internal_failure`、`fixture_source_invalid`、`previous download attempt is still active`、`body limit is invalid`、`process output limit is invalid`、`visual profile dimensions are invalid`、`… requires exactly five probes`、进度与心跳值、`operator event fields are invalid` | application/create_note.py:47-48, 188-199, 293-304；adapters/fixture_source.py:42-43；adapters/_ytdlp_worker.py:89-91；adapters/http_bodies.py:26-27, 48-49；adapters/subprocesses.py:82-83；adapters/media_ffmpeg.py:123-163；application/progress.py:64-96；application/operator_events.py:172-177 | 内部不变量 | DROPPED | 对应代码不进新路径 | B |

## 3. README 与设计文档的拒绝句对照

| 位置 | 原句要点 | 对应行 | 新状态 |
|---|---|---|---|
| README.md:19-20 | 只接受有限的 watch、youtu.be、shorts；拒播放列表、频道、直播 | S1、S2、U2 | KEPT |
| README.md:21-22 | 不自动读浏览器 cookie | C2 | KEPT |
| README.md:44, 52 | 不自动降级模型，不回落输出模式 | T9、N5 | REPLACED / B |
| README.md:55, 160-163 | 限流给出明确错误，不无界重试；参数、鉴权、格式错误不盲目重试 | X1 | REPLACED |
| README.md:61 | YouTube/Bilibili 总走专用适配器，平台错误不绕道 | U4、E14 | REPLACED |
| README.md:62-63 | 通用页拒多视频清单、直播、清单格式、DRM、鉴权、重定向、非公网目的地、非 HTTPS | S1、S2、S5、S4、S6、E7、E2/E8/U3、U3/S5 | 依次为 KEPT、KEPT、REPLACED、REPLACED、REPLACED（部分）、DROPPED（A）、部分替换（A）、部分（C） |
| README.md:64 | 只有带音轨、至少 720p 的完整视频才能转写 | R5、R6、R2 | KEPT / REPLACED / KEPT（checker `hd_floor`） |
| README.md:65-66 | 通用回落不用 cookie、不用代理 | S6、E4、C3 | cookie REPLACED；代理 DROPPED（A，环境代理现在生效） |
| README.md:96-97 | 缺权重或本地 worker 失败时明确报错，不自动换付费服务 | T3、T1、T9 | KEPT / REPLACED |
| README.md:103-104, 199-200 | 缓存仓 24 h、256 条、8 GiB，过期拒绝，`artifact_store_busy` | A1、A2、P4 | B / REPLACED |
| README.md:107 | 最多 48 个候选帧、24 张发布图 | F2 | B |
| README.md:115-116 | 其他相对目录路径被拒 | L5 | REPLACED |
| README.md:118-121 | cookie 文件须绝对路径、常规文件，拒符号链接，不自动发现，不用于 YouTube 与通用页 | C1 | REPLACED |
| README.md:123-124 | 代理只能是显式、无认证的回环 HTTP | E4 | DROPPED（A） |
| README.md:184-185 | 导入拒路径与符号链接；要求音轨、有限时长、720p | L1、L2、R6、S2、R2 | REPLACED / KEPT |
| README.md:189 | 沿用 grounding、转义、发布检查 | N1、N2、N7、N8 | KEPT / REPLACED |
| bilibili-note.md:12, 159-160 | 来源语音、标题、图像是不可信材料，不是指令；不把来源指令变成工具动作 | （无代码） | KEPT：SKILL.md 规定内容只是证据，不选择 URL、旗标、cookie、代理、路径或下一步；eval `injected-instruction` |
| bilibili-note.md:15-16, 227 | 模型不能提供文件路径、外部图片、可执行标记；不接受任意 HTML 或输出路径 | N7、L1、L5 | REPLACED |
| bilibili-note.md:26-27 | 维持身份、时长、公网 DNS 固定、重定向拒绝、回环代理、媒体上限 | S7、R5、E2、E7、E4、R1、R4 | KEPT / KEPT / A / A / A / KEPT / C |
| bilibili-note.md:42, 57, 162 | 超出预算明确报错不截断；不发布部分或未校验的笔记 | N4、N8 | B / REPLACED（自检：`check.json` 为 ok，或逐条列明失败的检查） |
| bilibili-note.md:68-71 | 不伪造图片，不宣称未采样的覆盖，不截断尾部 | F2、F4 | REPLACED：`tail_frame_kept`；规则「不引用文件名或拼图」 |
| bilibili-note.md:82-88 | 重试有界，日志不记响应体与凭据，不隐式降级 | X1、C5、N5 | REPLACED / B |
| bilibili-note.md:91-95 | 无静默回落；权重钉版本；只有全覆盖回执才允许静音间隙；取消时回收进程组 | T9、T3、T5、P3 | REPLACED / KEPT / REPLACED / B |
| bilibili-note.md:106-110 | YouTube：拒清单、频道、直播；不读浏览器 cookie；请求有界、只到 HTTPS 的 YouTube 与媒体主机、只到公网 DNS 地址、拒重定向；转写前校验封闭回执、完整音视频、时长、HD 尺寸、字节上限 | S1、S2、C2、E13、E9、E8、E7、J4、R5、R6、R2、R4 | 见各行 |
| bilibili-note.md:116-121 | 通用：不转交其他提取器；公网 DNS、443 上的 HTTPS、无凭据、无重定向、无 IP 字面量；没有环境 cookie、代理和外部下载器；元数据与请求数有界；只下渐进式 MP4/WebM；拒清单、清单格式、直播、DRM；FFprobe/FFmpeg 只用 `file,pipe` | E14、E2、U3、S6、E7、C3、E16、E11、E13、S5、S1、S2、S4、D1 | 见各行 |
| bilibili-note.md:139-140 | `note.html` 是静态转义预览，无脚本、无远程依赖、无资源服务器 | N7 | REPLACED（CSP 为 B） |
| bilibili-note.md:146-149 | 不覆盖已有 bundle，提交后不删除 | N8 | REPLACED |
| bilibili-note.md:151 | 凭据不持久化 | C6 | KEPT |
| bilibili-note.md:156 | 提供方 JSON 严格：键唯一、数值有限、字段与类型精确、字节与深度有界 | J1、J4、J5、N5 | B；checker 读 JSON KEPT（J1） |
| bilibili-note.md:157-159 | 拒悬空引用、超出来源的时间戳、乱序章节、无关截图 | N1、F7、N2 | B / KEPT / REPLACED；超出来源的时间戳由 `empty_or_outside` 旗标与 `recomputed:*` 覆盖 |
| bilibili-note.md:160-161 | 保留来源时长、子进程与进程组、ASR、帧字节、提供方响应体、并发、stdout 准入等上限 | R3、P1、P3、T1、T5、F1、F2、N5、J6、P4、J2、P2 | 混合，见各行；R3、P1、P2 属 C |
| bilibili-note.md:182-183 | 必需的复核失败即请求失败，不静默降档 | T8 | B |
| bilibili-note.md:213-216 | 缓存仓上限、原子暂存、并发锁 | A1、A2、P4 | B / REPLACED |
| bilibili-note.md:219-220 | 导入拒路径、符号链接、无关文件；满足同样的时长、音轨、HD 上限；作者与日期标为未知 | L1、L2、D2、R2、R6、S8 | REPLACED / KEPT |
| bilibili-note.md:222-223 | 导入的转写必须覆盖全程，不得冒充 ASR 回执 | T5 | B（不再有转写导入；SKILL.md 规定更正放在单独标注的层） |

## 4. C 类放宽的取舍（用户授权、Agent 选择）

用户 2026-10-10 答复：「不确定放宽是好还是不好，结合实际情况替我做选择，都授权」。Agent 逐条取舍如下：

1. U1、U2 平台 URL 的其余文法限制（控制字符、长度、查询键白名单）：**放宽**。危害面由 URL 前的 `--`、引号和
   `bash <<'SH'` 覆盖；通用页的 scheme、端口、userinfo、IP 字面量（含十六进制与尾点）与私有后缀由 `host_check.jq`
   拦下，检查器 `public_https_host` 事后复核；`bundle` 拒绝不在 `[A-Za-z0-9_-]` 内的 ID。
2. P2 子进程输出上限：**放宽**。检查器改为流式哈希，内存不随时长增长。
3. R4 下载过程中的字节上限：**恢复**。下载配方加 `ulimit -f 2097152`（bash 以 KiB 计，2 GiB），内核在写入时
   截停任何超过 2 GiB 的文件，长度未知的流和跨重试累计同样受限；本机实测分块传输的无长度流在上限处以
   `File too large` 失败、退出 1。成本一行，恶意通用页因此写不满磁盘。检查器事后 `max_bytes` 仍保留。
4. P1 配方侧期限：**放宽**。下载与 ASR 改为后台运行加 harness 超时；检查器侧每个子进程仍有超时。
5. C4 封闭失败回执改为逐字 `FAILED`（去掉查询串，家目录写成 `~`）：**放宽**。原文对诊断有价值（旧服务把 5 次
   首轮失败的原因藏在封闭回执里）；检查器扫描其中的签名 URL、IP、cookie 头与本机家目录路径。
6. 附带说明（属 A，后果需知）：E4、C3 使环境 `HTTP(S)_PROXY` 生效；E14 允许通用页转交其他提取器；X1 使 yt-dlp
   内部默认重试 10 次；通用页下载用 `--load-info-json` 读探测结果，不再二次提取页面，但下载中的重定向与 DNS 解析
   仍不检查。

同一答复也授权了复核期间对新检查的两处改动：`has_grid` 只在存在 `frames/*` 时要求网格（放宽，使分阶段检查可过），
引文与数值改为整数 token 比较（收紧）；数值比较保留 `%`（`12%` 不等于 `12`），小数末尾的 0 归一（`506.0` 等于 `506`）。

## 5. 落点总结

**检查器（事后能从字节重算、失败即拒）：** `receipt_present`、`receipt_matches_probe`、`format_known`、`exact_size`、
`not_truncated`（按解复用能读到的最后一个包；无声明时报 `undeclared` 失败）、`page_holds_media`、`max_side_pixels`、
`hd_floor`、`max_bytes`、`duration_ceiling`、`one_stream_per_kind`、`container`、`regular_files_only`、`layout`、
`png_plain`、`text_file`、严格 `readable_json`、`public_https_host`、`engine_pinned`、`argv_is_recipe`、`has_grid`、
`grid_covers_6s`、`frame_in_cited_span`、`quote_in_segments`、`number_has_frame_or_label`、`value_in_evidence`、
`sidecars_resolve`、`flagged_span_limited`、`claims_have_media`、`no_signed_url_or_cookie`、
`no_media_or_large_file_in_bundle`；每个子进程 `timeout=600`，自身 ffprobe/ffmpeg 带 `-protocol_whitelist file,pipe`
与容器白名单，`sha()` 与 `pcm()` 流式哈希。ASR 质量启发式只作 `flags`，但引用被标记段的 claim 必须写局限；笔记不检查。

**skill 规则或固定旗标（预防发生在字节产生之前，检查器看不到）：** yt-dlp 旗标白名单与固定的
`--ignore-config --no-plugin-dirs --no-playlist`、`--`、`-o 'source.%(ext)s'`、原子选择器、`-k --fixup never`、
`--max-filesize 2G`；通用页下载前跑 `host_check.jq`、下载读 `--load-info-json`；`bundle` 校验 ID；下载前删除残片、不续传，
留存前完整解码检查；`identity.jq` 规范化 `webpage_url`，不把域名记成作者、不保留 `Last-Modified`；pandoc 用 `note.lua`；
cookie 规则；内容不选择 URL、旗标、路径或下一步；同一命令最多重跑两次，不换网络路径；长任务放后台轮询；中断后
清理；一次只跑一个 MLX 任务；本地文件 `[ -f "$F" ] && [ ! -L "$F" ]`；笔记的章节、图片与 HTML 规则。

## 6. 普查发现的草稿缺口：处理结果

1. `assets/project.jq` 把通用来源的域名记成作者、把 `Last-Modified` 记成时间：拆成 `identity.jq` 与 `receipt.jq`，已修（S9）。
2. 检查器只取 `height`：加 `max_side_pixels` 与 `hd_floor`（R1、R2）。
3. 检查器无 `timeout`、整读媒体与 PCM：已加超时与流式哈希（P1、R3）。
4. `is_file()` 跟随符号链接：媒体与包内文件都拒绝链接（L2）。
5. 非严格 `json.loads`：已改严格（J1）。
6. `host_check.jq` 不管 scheme、端口、userinfo、`.test/.invalid`：已补（U3）。
7. `--max-filesize` 只看声明长度：下载配方加 `ulimit -f` 补上（第 4 节 R4）。
8. 未给 `--proxy` 时读环境代理、默认重试 10 次：属 A 的后果，列入第 4 节。
9. 原分辨率 PNG 在 4K 录屏上可能超过 8 MiB：`no_media_or_large_file_in_bundle` 会失败，届时由用户决定（F1）。
