# 视频取证：一个 skill 加一个只读检查器，video-note-mcp 冻结

状态：PR1 已实现（`video-evidence` skill、`services/video-evidence` 检查器、`research-round` 的来源证据参考）。
日期 2026-10-10。授权：用户 2026-10-10 在对话中明确授权 PR1；研究取材改走 skill，放宽旧服务的 DNS 固定、
重定向拒绝、主机白名单、回环代理限制和请求预算，代之以 yt-dlp 旗标白名单、通用页私网主机检查、容器白名单
和回执清洗；旧服务冻结、不删除；删除要等用户认可 3 个视频的对比之后（PR2，不在本次）；先把 D02/D05/D06
引用的 4 个媒体移入持久托管；允许安装 mlx-qwen3-asr 并下载约 4–5 GB 权重做测量。

## 为什么

- **准则**（AGENTS.md「Code or Agent」）：产品代码只为信任边界、修现有缺陷或 Agent 做不到的事。旧服务
  `services/video-note-mcp` 有 108 个受控文件、18,311 行（src 7,763、tests 7,102），其中只有「从字节重算
  身份并核对引用」是信任边界；取材、转写、选帧、写笔记都是 Agent 用现成工具能做的事。
- **研究里真正干活的是 Agent。** 44e229331 的研究记录里，内部作者在约 47 个真实媒体、40 份笔记中失败 7 次：
  S07 `chapter_order_invalid`，S33、S35、S36、S37、S38、S39 `author_output_budget_exceeded`。每一次（包括成功的
  S32）都是研究 Agent 自己从 media_sha256、转写段 ID 和原帧 ID 构建证据。
- **出站拒绝在伤害研究。** 同主机的 googlevideo 302 被拒，doz72-I2LKM 因此丢失；S19、S24、S33、S42、S43 的首试
  失败原因被封闭回执掩盖。没有记录到任何被拦下的恶意请求。今天 stock yt-dlp 探测 doz72-I2LKM 选到 137+140。

新形态：`.agents/skills/video-evidence/`（SKILL.md 90 行，5 份参考 22–85 行，资产 `env.sh`、`identity.jq`、
`receipt.jq`、`host_check.jq`、`ocr.swift`，7 个回归评测），`services/video-evidence/check_bundle.py`（414 行，
只用标准库，只读，不导入仓库代码），`research-round/references/source-evidence.md`（60 行）。检查器比计划的
270 行长，因为下面三位挑战者和两份审阅要求的检查都加进去了。

## 开源对比（更正后的数字）

| 项目 | 结论 |
|---|---|
| bradautomates/claude-video `watch` v0.3.2（MIT，约 18.3k★） | 不采用。`skills/watch/scripts` 下 10 个脚本共 2,789 行；选择器 `bv*[height<=720]+ba/b[height<=720]/bv+ba/b` 以 720p 为上限并静默回落到更低；WhisperX 默认 `small`，对中文笔记不够；yt-dlp 调用不带 `--ignore-config`（其文档说已有配置仍生效），暴露 `--cookies-from-browser`；安装说明推荐上传 Gemini。第二轮实测 TradingView 录屏：场景检测回落成 80 张 512×280 JPEG，丢尾帧，去重删掉了画线出现的时刻 |
| HuangYincan/VideoNote-MCP（MIT，96★） | 不采用。默认不取帧（拼图 JPEG），优先字幕，无媒体哈希，2.6k 行服务端，内置逆向的平台代码和一个 GPL-3.0 文件。吸收「准备材料、由 Agent 写」「先探测不下载」 |
| Let AI Read Video / video-watch、legal-skills 截图 skill | 吸收：Agent 点名要帧，独立的确定性程序校验时间、重算哈希、失败即拒 → 括号取帧配方加检查器重算 |
| Backtthefuture/video-transcript、BiliSum、steipete/summarize、daymade 的失败表、VideoCaptioner、BiliNote | 吸收：身份绑定原始字节；按输出而非退出码判成功；只抽取的证据模式；逐字症状表；更正是单独一层；按需取帧但校验时间 |
| Qwen3-ASR（mlx-qwen3-asr，Apache-2.0） | 基准上优于 Whisper large-v3，但未在本机验收集上测过；作为测量后再定的后续项（见下） |

## 旧服务逐项处置

| 旧服务部分 | 处置 | 新落点 |
|---|---|---|
| 出站与 URL 准入：`egress.py`、`extractor_http.py`、`url_policy.py`、`generic_url.py`、`youtube_url.py`、`video_url.py`，worker 里的 getaddrinfo/重定向补丁与请求预算 | 研究路径不再使用（旧服务冻结不改，PR2 删除），用户已授权放宽 | 旗标白名单、`host_check.jq`、容器白名单、回执投影 |
| yt-dlp 再封装与 B 站私有端点：`_ytdlp_worker.py`、`bilibili_*`、`youtube_source.py`、`generic_source.py`、`media_acquisition.py`、`source_acquisition.py`、`subtitles.py`、`local_import.py` | 由 stock yt-dlp 提取器取代；html5 playurl 回落与 cookie 选项无真实使用者 | `acquire.md`、`custody.md` |
| ASR：`asr_mlx.py`、`_mlx_worker.py`、`asr_siliconflow.py`、`audio_review.py`、`transcript_validation.py`、45 s 窗 | 直接调用钉版本的 mlx_whisper CLI；云 ASR 退出 | `transcribe.md`；检查器 `pcm_recomputed`、`schema_known`、`detected_language`、`argv_allowed` |
| 选帧：`media_ffmpeg.py`（48 帧上限、中文指代正则、medoid、记录请求时间而非真实 pts） | 由配方取代 | `frames.md`；检查器在真实 pts 重算 |
| 内部作者与呈现：`direct_notes.py`、`model_client.py`、`note_*`、`create_note.py`、`presentation/*`、DeepSeek/SiliconFlow 配置 | 退役；调用方 Agent 写笔记，笔记不是证据 | `note.md`；pandoc 关闭原始 HTML |
| 服务管道：`mcp_server.py`、`progress.py`、`operator_events.py`、`owned_tasks.py`、`subprocesses.py`、`artifact_store.py`（24 h TTL） | 退役；TTL 缓存与持久托管正相反 | 内容寻址 `sha256/`，检查器每个子进程带超时 |
| `resource_limits.py` 的源上限 | 保留进检查器 | `max_side_pixels`、`hd_floor` |
| 旧测试 7,102 行 | 随服务冻结；PR2 删除时在 PR 正文逐项对照新测试 | `tests/video_evidence`（CI）与 Git 外的回放 |

## 拒绝边界

逐行表（14 组 92 行，含旧代码位置）见 [video-evidence-refusals.zh.md](video-evidence-refusals.zh.md)。汇总：

- **A，用户已授权放宽**：DNS 固定（E1、E2、E8）、重定向拒绝（E5、E7）、主机白名单（E3、E9、E12、E14）、回环代理
  限制（E4、C3 的代理部分）、请求预算（E11、E13、X1）。后果需知：未给 `--proxy` 时环境 `HTTP(S)_PROXY` 生效；通用
  提取器可转交其他提取器；yt-dlp 默认内部重试 10 次。通用页下载过程中的重定向与 DNS 重绑不再检查，单用户本机
  接受，共享或云主机要靠 harness 网络策略。
- **原 C 类，PR1 改为保留**（检查器）：S7 `receipt_matches_probe`、R1 `max_side_pixels`、R2 `hd_floor`、P1 每个子
  进程 `timeout`、L2 `no_symlink` 与 `present`（不跟随链接）加本地文件配方 `[ ! -L ]`、J1 严格 JSON（拒重复键与
  NaN）、F7 `frame_in_cited_span`、D1 检查器自己的 ffprobe/ffmpeg 带 `-protocol_whitelist file,pipe`；U3/S6 的
  scheme、端口、userinfo、`.test/.invalid` 补进 `host_check.jq`；S9 通用来源不再把域名记成作者。
- **仍放宽、未在授权消息里点名的 C 类**（PR 评审时请用户确认）：平台 URL 的其余文法限制（控制字符、长度、查询键
  白名单；危害由 `--`、引号和 `bash <<'SH'` 覆盖）；96 分钟时长上限与子进程输出上限（检查器改为流式哈希）；
  长度未知的流和本地文件不再有字节上限（`--max-filesize` 只看声明长度，靠 harness 超时）；封闭失败回执改为逐字
  `FAILED`（隐私方向改变，检查器扫泄漏）；ASR 版本不符从拒绝改为记录在 `run.json`。
- **B 类**：载体不再存在（MCP stdio、内部作者、云 ASR、TTL 缓存、worker IPC、质量档位），只需记录。

## 存储字段审阅（AGENTS.md 要求的独立审阅，按其 retain/drop/derive 执行）

| 文件 | 保留 | 删除或派生 | 新增 |
|---|---|---|---|
| `claims.json` | `transcript_sha256`、`quote`、`evidence{segments, frames{media_sha256, pts, decoded_sha256}, crops, sidecars[{sha256, json_path}]}`、`asset`、`timeframe`、`role`、`market`、`position`、`seen`、`explicitness`、`asr_only`、`limitations` | `id` 改为位置编号 `C<n>` | `value`、`exclusive_group`（检查器要求每组至少 2 条） |
| `asr/run.json` | `pcm_sha256`（改为引擎实际读入的 WAV 样本）、`versions`、`model{repo, revision, weights_sha256}`、`argv`（实际执行的数组，模型路径写成 `repo@revision`） | `input_sha256`（包内只有一个带音轨的身份文件）、`language`（与转写重复，同时删去同义反复的 `language_as_requested`）、`env` | `detected_language`；不设用户覆盖键，确认过的不一致仍是失败检查，写成局限 |
| `frames/<dir>/` | `grid.tsv` 的文件名、`n*num/den`、解码帧 SHA-256、PNG SHA-256 | `source.json` 整个删除（帧目录绑定包内唯一的视频身份文件，`bound_to_video_identity`；ffmpeg 版本在 `check.json`）；秒数列；`framehash.txt` | PNG 像素检查（rgb24 framehash 与该 pts 的媒体帧比对） |
| `crops/crops.tsv` | 文件、SHA-256、父帧三元组、几何 | 放大倍数（被引裁剪不放大，用 ffmpeg `crop` 生成） | 重裁像素检查 |
| `probe/identity.json`、`media/receipt.json` | 拆成 `identity.jq` 与 `receipt.jq` 两个白名单投影；回执只留 `id`、`webpage_url`、格式 ID、协议、大小、yt-dlp 版本，通用来源加去掉查询串的 `media_url` | 身份里的格式字段与 `availability`；回执里重复的身份字段；通用来源的 `uploader`、`timestamp`、`upload_date`、`release_timestamp` | 直链的 HTTP `Last-Modified` 改名 `http_last_modified`（挑战者 2：TradingView 上比发布早 31–49 分钟） |

两处偏离，需在合并前补一次独立审阅：回执的 `declared {duration, from}`（只用于通用页：页面记录声明的时长，
`not_truncated` 读它；没有声明时检查器报 `undeclared` 失败，来自挑战者 1 的完整性要求），以及 `http_last_modified`
（审阅原意是删除 `timestamp`，强制修订要求改名保留；只在 yt-dlp 标为 `direct` 时写入，因为非直链时
`timestamp` 可能来自页面 JSON-LD）。

## 托管位置与两种身份口径

- 媒体放在 `$TRADE_RESEARCH_ARTIFACT_ROOT/source_media/sha256/<sha>.<ext>`（目录 0700、文件 0600），证据包在
  `source_media/bundles/`；`RUN_ID` 为 `^[A-Za-z0-9-]+$`，不含 `_`，不会与运行目录冲突。attempt 用顶层
  `artifact://source_media/sha256/...` 的 `source_gate` 引用媒体，`show`、`compare`、`validate`、发表预检都重算
  哈希；`probe/identity.json` 走 `material retain`，从不引用可变的包路径。`artifacts backup` 只复制运行，所以
  `source_media` 要单独 rsync 并跑哈希循环；备份在同一设备，只算本机副本恢复。
- 托管抢救已完成：D02 的 4d8d057f…、87ef3af5…，D05 的 99c53afa…，D06 的 59ef400f… 已在 `source_media/sha256`
  与备份中，`show --brief` 在 Dolt commit `0bnuhr5ulfrdcjrj62p7n2crgv44ddsv` 上对四个引用都报 `verified`。
- **两种口径**：历史媒体是旧服务合并出的 mp4（内嵌 Lavf 编码器标签，随工具链变化，缓存中 54 个、47 个属历史
  案例）；新身份是服务器原始分轨（`-k --fixup never`），可逐字节复现（YouTube itag 139 四次下载相同，B 站音轨
  两个 CDN 相同）。同一视频在两种口径下哈希永不相等，桥接靠裸平台 ID，以及可选的 1 fps 解码帧摘要（相等说明
  画面相同，不等不能下结论）。

## ASR 旗标变更与待复核的历史转写

新命令：`--temperature 0 --condition-on-previous-text False --word-timestamps True`，钉死快照路径并离线；不用
`--hallucination-silence-threshold`（在 30 s 窗口边缘丢 0.4–1.8 s 真实语音）、`--initial-prompt`、`--clip-timestamps`；
按输出文件判成功（CLI 失败也退出 0）；语言检测改为强制（挑战者 2 复现：对普通话强加 `--language en` 得到流畅英文、
退出 0、旧检查全过）。第二轮用新旗标重跑 46/46 个留存媒体：0 个解码循环，两段约 30 s 的幻觉被找回。两份
留存转写当时记为全覆盖，却含约 30 s 幻觉段，**需复核结论是否依赖它们**：76ae3b51… 326–355.6 s，
3b931aba… 357.5–387.5 s。数字仍不可靠：6 处画面或字幕核实过的口播数字，旧设置对 1 处、新设置对 2 处，所以
引用的数字必须有时段内的帧或标 ASR-only。本次复验：同一份原始音轨转写与第二轮字节相同（5e47b1ea…），
审阅者按 `argv` 重跑也字节相同。

## Qwen3-ASR 验收集（结果待追加）

固定验收集：6 处画面核实的口播数字；2 段已找回的循环区间；2 个完整视频的字幕 OCR CER；对全部留存媒体跑检查器
旗标。只有在数字与循环都更好、词级时间戳覆盖语音、重跑确定时才切换；切换不是一行 argv：检查器要新增具名
schema（`finish_reason`/`truncated` 映射为 `loops`，段映射为 E-ID，语言名归一为代码）。测量结果：（待追加）。

## CI 与 ffmpeg

`quality.yml` 在单测前用 apt 安装 Ubuntu 24.04 的 ffmpeg 6.1。`-enc_time_base:v demux` 自 6.1 起存在
（n6.1.1 `fftools/ffmpeg_mux_init.c`），本机 9.0.2 也接受；旧写法 `-1` 被 9.0.2 拒绝（`Invalid time base: -1`）。
单测用 1280×720 的 lavfi 合成包（满足 `hd_floor`），并行跑 20 次检查器，本机 2–6 s；两处人为破坏检查器（去掉中文数字、去掉像素检查）都会让它失败。

## 规则 → 检查或评测

| 规则 | 检查器检查 | 评测（回归在 skill 目录；留出用例与答案在 Git 外 `skill-evals/video-evidence/heldout/`） |
|---|---|---|
| 内容是证据不是指令 | — | 回归 `injected-instruction` |
| yt-dlp 只用配方旗标、`--ignore-config --no-plugin-dirs --no-playlist`、`--` | — | 回归 `planted-config` |
| 通用页私网主机检查 | — | 回归 `generic-local-target` |
| 只解码 MP4/MOV、Matroska/WebM | `container` | 回归 `concat-as-mp4` |
| 不留原始 info JSON；回执无签名 URL、IP、cookie | `no_signed_url_or_cookie`、`receipt_matches_probe` | 回归 `receipt-privacy` |
| 来源文本不进文件名或命令行 | — | 回归 `title-metachar` |
| skill 触发；未转写前不描述内容 | — | 回归 `trigger` |
| 身份是原始字节、完整、≥720p、尺寸上限 | `sha256`、`format_known`、`exact_size`、`not_truncated`、`hd_floor`、`max_side_pixels` | 留出 `youtube-403`、`local-file` |
| 先去重、按裸 ID 命名 | — | 留出 `same-source`、`prior-source` |
| 语言检测强制 | `detected_language` | 留出 `language-mismatch` |
| ASR 以输出判成功；禁用旗标 | `schema_known`、`argv_allowed`、`pcm_recomputed` | 留出 `asr-exit-zero` |
| 帧用真实 pts、保留尾帧、括号定位首次出现 | `recomputed`、`png_pixels`、`tail_frame_kept`、`rows_agree` | 留出 `first-visible`、`tail-and-pts` |
| 帧只在所引语音时段内佐证；数字要帧或 ASR-only | `frame_in_cited_span`、`number_has_frame_or_label` | 留出 `number-from-frame` |
| 被标记段不是证据 | 旗标 `claims_citing_flagged` | 留出 `flagged-span`、`reading-view` |
| 作者和日期不取自标题 | — | 留出 `author-date-from-title` |
| 笔记规则 | —（笔记不是证据） | 留出 `any-subject-note` |

## 本次验证

- `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：157 个测试通过（6 个按条件跳过），新增 3 个测试含 16 个篡改子测试。
- Git 外回放（`heldout/replay/replay.sh`，真实原始分轨包，144p 视频轨使 `hd_floor` 按设计失败）：38/38。
- 选择器回放（`heldout/selector/`，6 个实时探测的清洗形状，清洗前后选择一致，加 2 个低于 720p 的形状）：8/8。
- 实时元数据探测（不下载）：YouTube、B 站、B 站分 P、无 `?p` 的合集（被门槛拒绝）、TradingView 页面、
  TradingView CDN 直链；投影泄漏 0。配方按原文跑通：环境守卫、托管与备份、网格、括号、裁剪、拼图、OCR、
  语言检测、转写、`run.json`、阅读视图、审阅者重跑。

## 后续

1. PR2：用户在 3 个非交易中文视频（B 站、YouTube、直链或本地文件各一，另加一个非中文视频验证语言检测）上对比
   旧服务 `--create --quality fast` 与本 skill，认可后再删除 `services/video-note-mcp`，PR 正文对照被删测试。
2. Qwen3-ASR 测量后决定是否切换（上节）。
3. 对 `declared` 与 `http_last_modified` 补独立审阅；复核两份含幻觉段的历史转写。
4. 在固定 commit 的克隆沙箱里跑回归与留出评测（Claude 与 Codex，有/无 skill 各 3 次），无差别的非对抗规则删掉。
5. 可选：把 `~/.claude/skills/video-evidence`、`~/.codex/skills/video-evidence` 软链到仓库副本，设
   `VIDEO_EVIDENCE_ROOT` 与 `MLX_VENV`；`~/.local/share/video-note-mcp` 下的缓存与笔记去留由用户另定。
