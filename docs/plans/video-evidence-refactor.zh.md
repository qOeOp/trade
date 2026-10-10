# 视频取证：一个 skill 加一个只读检查器，video-note-mcp 冻结

状态：PR1 已实现（`video-evidence` skill、`services/video-evidence` 检查器、`research-round` 的来源证据参考），并按 2026-10-10 的四份复核（实测验收、新旧对比、对抗安全、合规）修订，见文末「复核」。
日期 2026-10-10。授权：用户 2026-10-10 在对话中明确授权 PR1；研究取材改走 skill，放宽旧服务的 DNS 固定、
重定向拒绝、主机白名单、回环代理限制和请求预算，代之以 yt-dlp 旗标白名单、通用页私网主机检查、容器白名单
和回执清洗；旧服务冻结、不删除；删除要等用户认可 3 个视频的对比之后（PR2，不在本次）；先把 D02/D05/D06
引用的 4 个媒体移入持久托管；允许安装 mlx-qwen3-asr 并下载约 4–5 GB 权重做测量。

## 为什么

- **准则**（AGENTS.md「Code or Agent」）：产品代码只为信任边界、修现有缺陷或 Agent 做不到的事。旧服务
  `services/video-note-mcp` 在本 PR 前有 108 个受控文件、18,306 行（src 7,763、tests 7,102），其中只有「从字节重算
  身份并核对引用」是信任边界；取材、转写、选帧、写笔记都是 Agent 用现成工具能做的事。
- **研究里真正干活的是 Agent。** 44e229331 的研究记录里，内部作者在约 47 个真实媒体、40 份笔记中失败 7 次：
  S07 `chapter_order_invalid`，S33、S35、S36、S37、S38、S39 `author_output_budget_exceeded`。每一次（包括成功的
  S32）都是研究 Agent 自己从 media_sha256、转写段 ID 和原帧 ID 构建证据。
- **出站拒绝在伤害研究。** 同主机的 googlevideo 302 被拒，doz72-I2LKM 因此丢失；S19、S24、S33、S42、S43 的首试
  失败原因被封闭回执掩盖。没有记录到任何被拦下的恶意请求。今天 stock yt-dlp 探测 doz72-I2LKM 选到 137+140。

新形态：`.agents/skills/video-evidence/`（SKILL.md 90 行，5 份参考 26–85 行，资产 `env.sh`、`identity.jq`、
`receipt.jq`、`host_check.jq`、`page_record.py`、`note.lua`、`ocr.swift`，8 个回归评测），
`services/video-evidence/check_bundle.py`（605 行、非空 534 行，只用标准库，只读，不导入仓库代码），
`research-round/references/source-evidence.md`（60 行）。检查器远超计划的 270 行与合规审阅给的约 300 行：三位挑战者、
两份审阅与 2026-10-10 安全复核要求的检查都在里面（版式白名单、PNG 结构、argv 模板、引文与数值绑定、网格覆盖、
泄漏扫描等）。用户 2026-10-10 接受约 600 行的预算；可移出的只有 ASR 旗标启发式（约 20 行），但被标记段现在决定
`flagged_span_limited`，所以留在检查器里。

## 开源对比（更正后的数字）

| 项目 | 结论 |
|---|---|
| bradautomates/claude-video `watch` v0.3.2（MIT，约 18.3k★） | 不采用。`skills/watch/scripts` 下 11 个文件，其中 10 个 Python 脚本共 2,789 行，另有 `build-skill.sh`；选择器 `bv*[height<=720]+ba/b[height<=720]/bv+ba/b` 以 720p 为上限并静默回落到更低；WhisperX 默认 `small`，对中文笔记不够；yt-dlp 调用不带 `--ignore-config`（其文档说已有配置仍生效），暴露 `--cookies-from-browser`；安装说明推荐上传 Gemini。第二轮实测 TradingView 录屏：场景检测回落成 80 张 512×280 JPEG，丢尾帧，去重删掉了画线出现的时刻 |
| HuangYincan/VideoNote-MCP（MIT，96★） | 不采用。默认不取帧（拼图 JPEG），优先字幕，无媒体哈希，2.6k 行服务端，内置逆向的平台代码和一个 GPL-3.0 文件。吸收「准备材料、由 Agent 写」「先探测不下载」 |
| Let AI Read Video / video-watch、legal-skills 截图 skill | 吸收：Agent 点名要帧，独立的确定性程序校验时间、重算哈希、失败即拒 → 括号取帧配方加检查器重算 |
| Backtthefuture/video-transcript、BiliSum、steipete/summarize、daymade 的失败表、VideoCaptioner、BiliNote | 吸收：身份绑定原始字节；按输出而非退出码判成功；只抽取的证据模式；逐字症状表；更正是单独一层；按需取帧但校验时间 |
| Qwen3-ASR（mlx-qwen3-asr，Apache-2.0） | 本机验收集上数字更准，但 0.4.4 会静默丢语音，暂不切换（见文末「Qwen3-ASR 实测」） |

## 旧服务逐项处置

| 旧服务部分 | 处置 | 新落点 |
|---|---|---|
| 出站与 URL 准入：`egress.py`、`extractor_http.py`、`url_policy.py`、`generic_url.py`、`youtube_url.py`、`video_url.py`，worker 里的 getaddrinfo/重定向补丁与请求预算 | 研究路径不再使用（旧服务冻结不改，PR2 删除），用户已授权放宽 | 旗标白名单、`host_check.jq`、容器白名单、回执投影 |
| yt-dlp 再封装与 B 站私有端点：`_ytdlp_worker.py`、`bilibili_*`、`youtube_source.py`、`generic_source.py`、`media_acquisition.py`、`source_acquisition.py`、`subtitles.py`、`local_import.py` | 由 stock yt-dlp 提取器取代；html5 playurl 回落与 cookie 选项无真实使用者 | `acquire.md`、`custody.md` |
| ASR：`asr_mlx.py`、`_mlx_worker.py`、`asr_siliconflow.py`、`audio_review.py`、`transcript_validation.py`、45 s 窗 | 直接调用钉版本的 mlx_whisper CLI；云 ASR 退出 | `transcribe.md`；检查器 `pcm_recomputed`、`schema_known`、`detected_language`、`argv_is_recipe`、`engine_pinned` |
| 选帧：`media_ffmpeg.py`（48 帧上限、中文指代正则、medoid、记录请求时间而非真实 pts） | 由配方取代 | `frames.md`；检查器在真实 pts 重算 |
| 内部作者与呈现：`direct_notes.py`、`model_client.py`、`note_*`、`create_note.py`、`presentation/*`、DeepSeek/SiliconFlow 配置 | 退役；调用方 Agent 写笔记，笔记不是证据 | `note.md`；pandoc 关闭原始 HTML 与 YAML 元数据 |
| 服务管道：`mcp_server.py`、`progress.py`、`operator_events.py`、`owned_tasks.py`、`subprocesses.py`、`artifact_store.py`（24 h TTL） | 退役；TTL 缓存与持久托管正相反 | 内容寻址 `sha256/`，检查器每个子进程带超时 |
| `resource_limits.py` 的源上限 | 保留进检查器 | `max_side_pixels`、`hd_floor` |
| 旧测试 7,102 行 | 随服务冻结；PR2 删除时在 PR 正文逐项对照新测试 | `tests/video_evidence`（CI）与 Git 外的回放 |

## 拒绝边界

逐行表（14 组 92 行，含旧代码位置）见 [video-evidence-refusals.zh.md](video-evidence-refusals.zh.md)。汇总：

- **A，用户已授权放宽**：DNS 固定（E1、E2、E8）、重定向拒绝（E5、E7）、主机白名单（E3、E9、E12、E14）、回环代理
  限制（E4、C3 的代理部分）、请求预算（E11、E13、X1）。后果需知：未给 `--proxy` 时环境 `HTTP(S)_PROXY` 生效；通用
  提取器可转交其他提取器；yt-dlp 默认内部重试 10 次。通用页下载改用 `--load-info-json` 读探测结果，不再二次提取
  页面；下载中的重定向与 DNS 解析仍不检查，单用户本机接受，共享或云主机要靠 harness 网络策略。
- **原 C 类，保留**（检查器）：S7 `receipt_matches_probe` 与 `receipt_present`、R1 `max_side_pixels`、R2 `hd_floor`、
  R3 `duration_ceiling`（96 分钟，复核后恢复）、R4 的事后 `max_bytes`（2 GiB）、T2 `engine_pinned`（复核后恢复）、
  P1 每个子进程 `timeout`、L2 `regular_files_only` 与 `present`（不跟随链接、不读 FIFO）加本地文件配方 `[ ! -L ]`、
  J1 严格 JSON（拒重复键、NaN 与溢出的数）、F7 `frame_in_cited_span`、D1 检查器所有输入带 `-protocol_whitelist
  file,pipe` 与容器白名单；U3/S6 的 scheme、端口、userinfo、IP 字面量（含十六进制与尾点）、`.test/.invalid` 在
  `host_check.jq`，检查器 `public_https_host` 事后复核；S9 通用来源不把域名记成作者。
- **未在首次授权里点名的 C 类**（用户 2026-10-10 全部授权、委托取舍，见拒绝表第 4 节）：放宽 U1、U2 平台 URL 的
  其余文法限制、P2 子进程输出上限、P1 配方侧期限、C4 逐字 `FAILED`（检查器扫签名 URL、IP、cookie 头与家目录路径）；
  R4 下载过程中的字节上限以 `ulimit -f` 恢复。
- **B 类**：载体不再存在（MCP stdio、内部作者、云 ASR、TTL 缓存、worker IPC、质量档位），只需记录。

## 存储字段审阅（AGENTS.md 要求的独立审阅，按其 retain/drop/derive 执行）

| 文件 | 保留 | 删除或派生 | 新增 |
|---|---|---|---|
| `claims.json` | `transcript_sha256`、`quote`、`evidence{segments, frames{media_sha256, pts, decoded_sha256}, crops, sidecars[{sha256, json_path}]}`、`asset`、`timeframe`、`role`、`market`、`position`、`seen`、`explicitness`、`asr_only`、`limitations` | `id` 改为位置编号 `C<n>` | `value`、`exclusive_group`（检查器要求每组至少 2 条） |
| `asr/run.json` | `pcm_sha256`（引擎实际读入的 WAV 样本）、`versions`、`model{repo, revision, weights_sha256}`、`argv`（实际执行的数组，模型路径写成 `repo@revision`） | `input_sha256`、`language`、`language_as_requested`、`env` | `detected_language`；不设用户覆盖键 |
| `frames/<dir>/` | `grid.tsv` 的文件名、`n*num/den`、解码帧 SHA-256、PNG SHA-256 | `source.json`（帧目录绑定包内唯一的视频身份文件）；秒数列；`framehash.txt` | PNG 像素检查 |
| `crops/crops.tsv` | 文件、SHA-256、父帧三元组、几何 | 放大倍数 | 重裁像素检查 |
| `probe/identity.json`、`media/receipt.json`、`probe/page.json` | 两个白名单投影；回执留 `id`、`format_id`、协议、大小、yt-dlp 版本与 `requested_formats`（按 `format_id` 从 `.formats` 取，yt-dlp 写出的 info JSON 不含 `requested_formats`），通用来源加 `media_url`；`page.json` 是页面里持有媒体 URL 的那条记录 | 身份的格式字段与 `availability`；回执的 `webpage_url`（与身份重复，`receipt_matches_probe` 只比 `id`）；通用来源的 `uploader`、`timestamp`、`upload_date`、`release_timestamp`；身份的 `webpage_url` 规范化（YouTube `watch?v=`，B 站只留 `?p=`，其余去查询串、片段与 `;params`）；`media_url` 去查询串、片段与 `;params`，路径段含 `=` 或 `~` 时只留主机；`page.json` 里的 URL 去查询串 | 无 |

两处偏离已在复核中收回，本 PR 不再新增需要审阅的存储字段：`http_last_modified` 删除（回到审阅原意：HTTP
Last-Modified 不是发布时间，也没有使用者）；回执的 `declared {duration, from}` 删除，改为派生：检查器在
`probe/page.json` 里找持有 `media_url` 的对象，读其 `duration` 或 `video_duration`（秒或 ISO 8601），并要求页面
记录确实持有该 URL（`page_holds_media`），时长不再由 Agent 手写。`page.json` 由 `assets/page_record.py` 产出。
`check.json` 的 `ffmpeg` 字符串追加 `ffmpeg`、`ffprobe` 可执行文件的 SHA-256 前缀（检查器输出，可重算，不是新键）。

## 托管位置与两种身份口径

- 媒体放在 `$TRADE_RESEARCH_ARTIFACT_ROOT/source_media/sha256/<sha>.<ext>`（目录 0700、文件 0600），证据包在
  `source_media/bundles/`；`RUN_ID` 为 `^[A-Za-z0-9-]+$`，不含 `_`，不会与运行目录冲突。attempt 用顶层
  `artifact://source_media/sha256/...` 的 `source_gate` 引用媒体：`show`、`validate` 重算哈希（不符即失败），发表
  预检只报告缺失或不符，`compare` 只读运行的 audit 引用；`_check_ref` 整个读入文件，媒体可达 2 GiB。
  `probe/identity.json` 走 `material retain`，从不引用可变的包路径。`artifacts backup` 只复制运行，所以
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
退出 0、旧检查全过）。检查器 `argv_is_recipe` 只接受配方的 argv（复核发现 argparse 接受缩写，`--initial-p` 能绕过
原来的黑名单），审阅者按配方重建 argv 并重跑两个 30 s 语言窗口，不再重跑 `run.json` 里记录的 argv。第二轮用新旗标
重跑 46/46 个留存媒体：0 个解码循环，两段约 30 s 的幻觉被找回。两份留存转写当时记为全覆盖，却含约 30 s 幻觉段，
**需复核结论是否依赖它们**：76ae3b51… 326–355.6 s，3b931aba… 357.5–387.5 s。数字仍不可靠：6 处画面或字幕核实过的
口播数字，旧设置对 1 处、新设置对 2 处，所以引用的数字必须有时段内的帧、页面 sidecar 或标 ASR-only。

## Qwen3-ASR 验收集与结论

固定验收集：6 处画面核实的口播数字；2 段已找回的循环区间；2 个完整视频的字幕 OCR CER；对全部留存媒体跑检查器
旗标。切换条件：数字与循环都更好、词级时间戳覆盖语音、重跑确定；切换要在检查器新增具名 schema。

测量结果、阻断原因与切换条件见文末「Qwen3-ASR 实测（2026-10-10）」：**暂不切换**。

## CI 与 ffmpeg

`quality.yml` 在单测前用 apt 安装 ffmpeg；作业跑在 `ubuntu-latest`（当前 24.04，ffmpeg 6.1），需要 ≥ 6.1：
`-enc_time_base:v demux` 自 n6.1.1 起存在，本机 9.0.2 也接受；旧写法 `-1` 被 9.0.2 拒绝。单测用 13 s、1280×720 的
lavfi 合成包，并行跑约 65 次检查器（5 个测试、56 个具名篡改子测试加 3 个分阶段通过子测试，本机约 7 s）；同一套测试对本 PR 第一版检查器
运行时，5 个测试中 4 个失败（篡改测试在 FIFO 用例上超时中止）。

## 规则 → 检查或评测

回归评测在 skill 目录；留出用例与答案在 Git 外 `skill-evals/video-evidence/heldout/`。没有检查或用例的规则标
「授权边界」：它约束的是 Agent 是否向用户要授权，只能由对抗用例观察。

| 规则 | 检查器检查 | 评测或用例 |
|---|---|---|
| 内容是证据不是指令 | — | 回归 `injected-instruction` |
| yt-dlp 只用配方旗标、`--ignore-config --no-plugin-dirs`、`--no-playlist`（分 P 列表用 `--yes-playlist`）、`--` | — | 回归 `planted-config` |
| 通用页私网主机检查 | `public_https_host`（事后） | 回归 `generic-local-target` |
| 只解码 MP4/MOV、Matroska/WebM；每类一条流 | `container`、`one_stream_per_kind` | 回归 `concat-as-mp4` |
| 不留原始 info JSON 与页面 HTML；保留文件无签名 URL、IP、家目录、cookie | `no_signed_url_or_cookie`、`receipt_present`、`receipt_matches_probe` | 回归 `receipt-privacy` |
| 来源文本不进文件名、路径或命令行；ID 只取 `[A-Za-z0-9_-]` | `layout`（包内路径白名单） | 回归 `title-metachar`、`dash-id`；`bundle` 在 env.sh 拒绝 |
| skill 触发；未转写前不描述内容 | — | 回归 `trigger` |
| 身份是原始字节、完整、≥720p、尺寸与时长上限 | `sha256`、`format_known`、`exact_size`、`not_truncated`（按最后一个包）、`page_holds_media`、`hd_floor`、`max_side_pixels`、`max_bytes`、`duration_ceiling` | 留出 `youtube-403`、`local-file` |
| 不续传残片；留存前完整解码 | `not_truncated`、`tail_frame_kept`（事后） | custody 配方解码检查；本次对损坏的 B 站分轨实测拒收 |
| 先去重、按裸 ID 命名 | — | 留出 `same-source`、`prior-source` |
| 语言检测强制 | `detected_language`（只查 `run.json` 与转写一致） | 留出 `language-mismatch`；审阅者重跑语言窗口 |
| ASR 以输出判成功；只用配方 argv；钉引擎 | `schema_known`、`argv_is_recipe`、`engine_pinned`、`pcm_recomputed` | 留出 `asr-exit-zero` |
| 不改原始转写，更正另起一层 | 审阅者重跑字节比对 | 审阅者步骤 3 |
| 帧用真实 pts、网格步长 ≤6 s、保留尾帧、括号定位首次出现 | `has_grid`、`grid_covers_6s`、`recomputed`、`png_pixels`、`tail_frame_kept`、`rows_agree` | 留出 `first-visible`、`tail-and-pts` |
| 帧只在所引语音时段内佐证；数字要帧、sidecar 或 ASR-only；引文是连续段原文 | `frame_in_cited_span`、`number_has_frame_or_label`、`value_in_evidence`、`quote_in_segments` | 留出 `number-from-frame` |
| 页面结构化数据优先于像素 | `sidecars_resolve`（只认 `probe/page.json`） | — |
| 被标记段不是证据 | `flagged_span_limited` | 留出 `flagged-span`、`reading-view` |
| 作者和日期不取自标题 | — | 留出 `author-date-from-title` |
| 分阶段构建、失败留 `FAILED`、不重做已完成阶段 | `no_incomplete_stage`、`stages` 输出 | — |
| ROOT 不在 Git 或临时目录，媒体 0600 | — | env.sh 拒绝 |
| 保留清单：不留媒体、未引用帧、拼图、笔记 | `layout`、`png_plain`、`no_media_or_large_file_in_bundle` | — |
| 审阅者从 `origin/main` 跑检查器 | `checker_git_blob` 输出 | 审阅者步骤 2 |
| 最多重跑两次、不换网络路径、不升级工具、cookie 只来自用户 | — | 授权边界：`planted-config` 只覆盖旗标，其余待留出对抗用例 |
| 笔记规则；HTML 不读本地文件 | —（笔记不是证据） | 留出 `any-subject-note`；`note.lua` 本次实测 |

## 本次验证（PR1 首版）

- `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：157 个运行，151 个通过，6 个按条件跳过；
  新增 3 个测试含 16 个篡改子测试。
- Git 外回放（`heldout/replay/replay.sh`，真实原始分轨包，144p 视频轨使 `hd_floor` 按设计失败）：38/38。
- 选择器回放（`heldout/selector/`，6 个实时探测的清洗形状加 2 个低于 720p 的形状）：8/8。
- 实时元数据探测（不下载）与配方原文复跑：见首版 PR 说明。

## 复核（2026-10-10）

四份复核：一名只按 skill 操作的新操作者实测验收、新旧对比、对抗安全审查、合规审查。所有发现已逐条修复或说明，
产物都在 Git 外 `~/.local/share/trade/skill-evals/video-evidence/`。

**实测验收（按 skill 原文，修复前）**，每源结果与修复后复查：

| 来源 | 修复前 | 修复后复查 |
|---|---|---|
| (1) YouTube EtIAqiguRHs（137+140） | 全部阶段完成；`ok:false` 只因 `format_known` ×2（`receipt.jq` 读不到 yt-dlp 已删的 `requested_formats`） | 用新 `receipt.jq` 投影实时元数据：`ok:true`，两段 `exact_size` 22,918,414 与 4,924,029 字节相符 |
| (2) YouTube doz72-I2LKM（旧服务因 302 拒绝丢失） | 26 s 下载完成；同上只差 `format_known` | 同上：`ok:true`，59,818,485 与 8,693,839 字节相符 |
| (3) B 站 BV1j6um69EJn | 下载 3 次都被 CDN 截断（`bytes read, more expected`），写入 `media/FAILED`；`ok:true` 却无媒体 | 失败表新增 CDN 截断一行（删残片、等待、最多重跑两次、再问网络路径）；文档写明 `ok` 只表示一致、不表示完整 |
| (4) 无 `?p` 的分 P 合集 BV1bK411W797 | 门槛拒绝；`?p=2` 通过；列表步骤因 `--no-playlist` 返回空 | 列表改用 `--yes-playlist --flat-playlist`，实测列出 23 个 `?p=N` |
| (5) TradingView 页面 | `ok:true`；页面记录声明 547.0 s，实际 553.55 s | 新检查器从 `page.json` 派生时长：`ok:true`；`page_record.py` 实测取出同一记录 |
| (6) CDN 直链 mp4（与 5 同字节） | `not_truncated` 报 `undeclared` | 用引用它的页面的记录作 `page.json`：`ok:true` |

泄漏：修复前在 `probe/`、`media/`、`asr/run.json`、`FAILED`、`claims.json` 中，skill 自带模式、视频 CDN 主机名、
IPv4、本机路径均为 0 次，带查询串的只有公开页面 URL（`watch?v=`、`?p=2`）；新检查器扩大后的扫描在复查的 4 个包
（含约 100 KB 的 TradingView 页面记录）上仍为 0。确定性：5 个包的检查器重跑逐字节相同；重新获取 (1) 两个分轨
SHA-256 相同；独立转写逐字节相同；修订后的转写配方在 (1) 的音轨上复现 277d6e45…，按新审阅者步骤（配方 argv、
重跑语言窗口）语言一致、转写逐字节相同。恢复演练：每包只拷 13–14 个保留文件到空目录，`--restored` 结论与完整包
一致，未引用 PNG 记入 `png_not_retained`。

**新旧对比**（供用户审阅，不选胜者）：`~/.local/share/trade/skill-evals/video-evidence/comparison-20261010/index.md`
（另有 `index.html`）。旧服务 8 次运行只产出 2 份笔记（都是 Commons 直链）；YouTube 因拒绝 googlevideo 302 确定性
失败；新 skill 对每个取得媒体的视频都产出了带帧链接的笔记。两边 ASR 都会错人名；旧笔记悄悄改正部分 ASR 错误、
也保留了画面可见的错字，并有无依据的补充；新笔记逐处标注字幕与 ASR 的差异，但依赖 Agent 多取帧核对。
本次修复的对比发现：`receipt.jq`（同上）、`note.html` 写进包会超过 8 MiB（改为写到包外 `$ROOT/notes/`）、续传
得到同大小的损坏分轨（检查器改用最后一个包判断完整性，配方留存前完整解码，实测拒收该文件）、失败表缺 CDN 截断、
直链缺页面数据与 ISO 8601 时长（`page_record.py` 与检查器派生）。

**安全复核**：21 个恶意检查器样本修复前 19 个 `ok:true`，修复后全部失败、标题样本仍通过；双视频轨样本失败于
`one_stream_per_kind`。三个阻断项：来源 ID 变成路径使 `rm -rf` 删到 ROOT 外（`bundle` 只接受 `[A-Za-z0-9_-]`，
直链 ID 改为 URL 哈希）；ID 被 `git grep` 当成选项执行命令（改 `-F -e`、`--text=`、`--`，实测不再执行）；审阅者
重跑作者写的 argv（检查器要求配方 argv，审阅者按配方重建）。其余：引文与数值绑定、sidecar 解析、媒体经 PNG、
伪 JSON 或嵌套 `check.json` 进入 Dolt（版式白名单、`png_plain`、严格解析）、pandoc 读本地文件或发请求（`note.lua`；
首轮漏了 YAML 元数据块的 `css:`，二次复核修复，见下）、签名路径与分享参数（投影规范化、扩大泄漏扫描）、私网主机绕过（尾点、十六进制、制表符）、
`PATH` 上的 ffmpeg 替身（`ffmpeg` 输出记可执行文件哈希，审阅者固定 `PATH`）、FIFO 挂起（先检查文件类型）、
网格行越出目录、1e999 溢出。

**合规复核**：授权范围内；托管抢救属实。另修正：`compare` 不重算哈希、`retain_file` 拒的是仓库内路径、旧服务行数
与测试计数、CI 运行器措辞；规则表补全（上节）；默认 `MLX_VENV` 改到 `~/.local/share/video-evidence/mlx-venv`，已有的
`~/.local/share/bilibili-note-mcp/mlx-venv` 需用 `MLX_VENV` 指定（PR2 清理前不得删除它）。

**回归评测**（有 skill、每例 1 次，`claude plugin eval --ablation none`，结果在 `regression-evals-20261010/`）：
首轮 5/7 通过标准；按回执新结构改 `receipt-privacy` 的标准、把 skill 触发描述改为「任何 yt-dlp、ffmpeg 或 ASR
步骤（含给下载命名、截图）」后第二轮 6/7。`receipt-privacy` 在默认 haiku 评审下三票 FAIL，换 sonnet 评审 2/2 PASS；
`injected-instruction` 通过标准但 skill 未触发。新增回归 `dash-id`（以 `-` 开头的 ID 与编码路径的文件名），2/2 通过。
有/无 skill 的 3 次对照与 Codex 臂仍未跑。

**未解决**：

1. 已结：拒绝表第 4 节的 C 类由用户 2026-10-10 全部授权、委托取舍（R4 下载上限以 `ulimit -f` 恢复，其余放宽）；
   检查器约 600 行的预算用户已接受。
2. 已结：用户看过 6 个视频的新旧对比，同意 PR1 合并后由 PR2 删除旧服务。
3. Ubuntu ffmpeg 6.1 上的单测只能由 PR 的首次 CI 验证。
4. 两份含约 30 s 幻觉段的历史转写，需复核结论是否依赖它们。
5. 有/无 skill 的评测对照（Claude 与 Codex 各 3 次）与授权边界类对抗留出用例未做。
6. 起始时间不为 0 的媒体（例如个别 TS 或 MKV）上，括号取帧与检查器的 `-ss` 定位会偏，检查器以 `recomputed`
   失败（失败即拒，不会误通过）；本次实测的 14 个真实媒体起始时间都是 0。
7. PR2 在 PR1 合并后开。

## 后续

1. PR2：PR1 合并后删除 `services/video-note-mcp`（用户 2026-10-10 已同意），PR 正文对照被删测试。
2. 复核两份含幻觉段的历史转写；Qwen3-ASR 等上游提供关闭重复截断的选项后再测。
3. 在固定 commit 的克隆沙箱里跑回归与留出评测（Claude 与 Codex，有/无 skill 各 3 次），无差别的非对抗规则删掉。
4. 可选：把 `~/.claude/skills/video-evidence`、`~/.codex/skills/video-evidence` 软链到仓库副本，设
   `VIDEO_EVIDENCE_ROOT` 与 `MLX_VENV`；`~/.local/share/video-note-mcp` 下的缓存与笔记去留由用户另定。

## 二次复核（2026-10-10）

二次复核确认首轮修复成立（留出回放 38/38、选择器 8/8、安全样本 21/21），另有 3 个主要、5 个次要发现，已修：

- `has_grid` 回归：只在存在 `frames/*` 目录时要求 `frames/grid`，媒体或 ASR 阶段后的分阶段检查可以通过。
- `note.md` 的 YAML 元数据（`css:`）让 pandoc 嵌入本地文件、请求 URL：读入改为
  `-f markdown-raw_html-yaml_metadata_block`，`note.lua` 的 `Meta` 只留 `title`。恶意笔记实测（`css:` 本地绝对路径、
  `css: http://127.0.0.1:<port>/x.css`、标题内图片）：旧命令嵌入 1 次、请求 2 次；新命令 0 次嵌入、0 次请求，
  两道防线单独启用时也都是 0；包内帧仍正常嵌入。三次复核又发现元素属性（`data-src`、`poster`、
  `data-background-image`）同样会被 `--embed-resources` 嵌入或请求；`note.lua` 现清空所有元素的属性，全部恶意样例
  （属性、`css:`、标题图片、`style`）0 次嵌入、0 次请求。
- 引文与数值按子串匹配：`79.4` 里的 `9.4`、`price 7`、单个 `4` 都能通过。现按整数 token 比较（阿拉伯小数、中文数字串、
  英文数词；`%` 计入、小数末尾的 0 归一）；引文两端是数字时不得紧邻同段的数字或小数分隔符；值与引文的每个数字都须等于所引证据
  （逐段取 token）中的一个。
- 次要：探测门槛拒绝后删除 `W`（原始 JSON 含签名 URL），停止时只留 `FAILED`；重跑失败阶段前先报告 `FAILED` 再
  `rm -rf "$B/<stage>"`（`mv` 会嵌套）；审阅者重取页面只比 `media_url` 所在对象（URL、时长、`created_at`、作者）和所引
  `json_path`；cookie 值检查移入托管主块；续传说明改为「yt-dlp 自身重试用 `Range` 续传，留存前的解码检查拒收拼接文件」。

## Qwen3-ASR 实测（2026-10-10）

候选：mlx-qwen3-asr 0.4.4（mlx 0.32.3，与基线同），Qwen/Qwen3-ASR-1.7B 与 Qwen/Qwen3-ForcedAligner-0.6B 钉
revision、离线运行（无对齐器只有约 30 s 块级时间），权重约 6.5 GB，略超授权的约 4–5 GB。基线：第二轮 mlx_whisper
命令，10 个媒体重跑与第二轮输出逐字节相同。

| 检查 | Whisper | Qwen3-ASR |
|---|---|---|
| 6 处已核实的口播数字 | 2/6（旧 worker 1/6） | 4/6 |
| 另加 3 处字幕核对，共 9 处 | 3/9 | 5/9 |
| 两段已知循环区间 | 找回 | 找回，内容相同 |
| 字幕 CER：原始 / 去语气词 / 去语气词与数字 | 7.9% / 7.4% / 7.4% | 13.4% / 8.3% / 6.2% |
| 重跑一致（10 个文件） | 10/10 | 10/10 |
| 速度 / 峰值内存 | 12.6× 实时 / 15.8 GiB | 13.7× / 12.0 GiB；bf16 15.9× / 7.8 GiB |

Qwen 的错数有时是怪串（「七十多点四」），有 1 处把 Whisper 对的数字改错；两引擎在全部 125 个小数上分歧 6 次，
从未一致地错。字幕用阿拉伯数字、去语气词，Qwen 写中文数字、留语气词，所以原始 CER 偏高；去掉后差约 1 个点，接近噪声。

**阻断**：mlx-qwen3-asr 0.4.4 只要 7–10 个 token 的模式连续重复两次就停止解码该块；讲者为强调重复一句时，该约 30 s
块的其余语音丢失，只有 `finish_reason: repetition` 和随后的空隙可见。46 个媒体中 4 个各丢 4.5–10 s 真实语音，违反
「词级时间戳覆盖语音」。仅测试用、要求重复 3 次的补丁找回全部 4 段且不新增循环，但 0.4.4 没有这个选项，计划也
排除自己维护补丁。

**决定**：保留 Whisper（第二轮 mlx_whisper 命令），每个数字仍须帧核对；旧服务退役（PR2）不依赖 Qwen。

**切换条件**：上游版本把重复截断改为 ≥3 次或提供开关时，重跑本集；没有提前停止的块且数字不低于 4/6 才切换。
切换需要：检查器新的转写 schema（块的 `finish_reason`/`truncated`、逐字 segments、语言写作 `Chinese`；段 ID 用包内
字幕分组，并加「数字字符之间不断段」规则，约 15 个 cue 把一个数字拆进两个 ID；循环旗标改为块非 `eos`、被截断或块文本
压缩比 >2.4；数字检查用中文数字正则）、新的 `engine_pinned`/`argv_is_recipe` 钉版本与 argv、新的身份记录（包版本与
wheel SHA-256、mlx/mlx-metal 版本、两个模型的 repo、revision 与权重 SHA-256、dtype、完整命令、`HF_HUB_OFFLINE=1`、
ffmpeg 版本、audio.wav 的 SHA-256 与时长）；成功判定仍读输出文件（未知语言退出 0，混合输入退出 1 仍写出好文件）。

**位置**：venv `~/.local/share/trade/research-analysis-envs/qwen3-asr-venv`（带哈希锁文件）；权重在
`~/.cache/huggingface/hub/models--Qwen--Qwen3-ASR-1.7B` 与 `models--Qwen--Qwen3-ForcedAligner-0.6B`；结果、环境、
运行输出、对比报告、脚本与第二轮基线副本在 `~/.local/share/trade/skill-evals/video-evidence/qwen3-asr/`
（`results.json`、`env/`、`runs/`、`report/`、`tools/`、`fixtures/round2/`）。不切换时 venv、6.5 GB 权重与 758 MB 可重建
的 `inputs/` 音频可删，删不删由用户定。
