# IDE 状态栏：市场导入服务的健康

2026-11-01 起（#2039、#2040）compose 服务 `market-import`（`market follow --symbols BTCUSDT ETHUSDT SOLUSDT`）
无人值守地导入行情：K 线和 metrics 每天，quotes 和 aggTrades 每月，然后推到 DoltHub。它是否健康，今天只能靠
`docker compose ps market-import` 和容器里的状态文件看到。

用户问 IDE 要不要一个市场数据页或覆盖热力图。结论是不要：研究会话读覆盖靠 `market coverage`（`research-start`
按路线报缺口），IDE 的 Agent 窗口也有 `market_coverage` 工具。缺的只有一件事：服务停了或落后时有人看得见。
所以只加一个状态栏小项。本文是动手前的方案。

## 为什么是代码

AGENTS.md 只为信任边界、缺陷修复或 Agent 做不到的事加产品代码。这里是给唯一用户看的界面：没有它，用户得自己
跑 `docker compose ps`，Agent 在用户不开会话时也不会去看。它不写任何东西、不加存储字段、不改拒绝或审计检查。

## 数据来源

- 只读服务写的状态文件：`trade-market-import` 卷里的 `market-import/status.json`（服务容器内是
  `/tmp/market-import/status.json`）。它的结构由 `market/follow.py` 的 `run_round` 和 `follow` 写出：
  `at`、`last_closed_day`、`running_since`（一轮开始时标记）、`next_round`、`round_refusal`、`published`、
  `publish_refusal`、`publish_failing_since`，以及 `kinds.{bars,metrics,quotes,trades}.{合约}` 下的 `state`
  （`caught_up`、`waiting`、`lagging`、`stopped`、`unknown`）、`through`（bars）、`missing_from`/`missing_days`
  （metrics）、`next_month`、`skipped`（quotes、trades）、`refusal`、`retry`、`rows`、`commits`。
- 文件由 `write_status` 先写 `.part` 再 `os.replace`，读到的总是一份完整的状态。
- IDE 不调 Docker，不读市场库，不导入 `market` 包。

## 改动

### 1. 部署（compose，需单独授权，见文末）

`deploy/compose.yaml` 的 `ide` 服务：

- 加一条卷：`trade-market-import:/run/trade/market-import:ro`（整卷只读；卷里还有归档缓存，都是公开的
  Binance 数据，IDE 只读状态文件）。不用 `volume.subpath`：子目录要到 `market-import` 第一轮后才存在，
  先建 `ide` 时挂载会失败。
- `command` 加 `--market-import=/run/trade/market-import/market-import/status.json`。

`deploy/README.md` 的 ide 一条补一句。

### 2. 服务端（`ide/research_graph/serve.py`，仍只用标准库）

- `serve` 加可选参数 `--market-import=PATH`（`cli.py` 透传）。不给时没有这条路径，页面不显示这一项，
  与 `--agent`、`--paper` 一致（本机 `ide.py serve` 默认没有）。
- `GET /api/market-import`：每次请求读一次文件（几 KB），过同样的 Host 和跨站检查，不加 CORS 头，
  `Cache-Control: no-store`。回答：
  - 200 `{"read_at": …, "stale": bool, "status": <文件原样>}`。`stale` 与 `market.follow.check()` 同一条规则：
    `read_at - at > 26 h`。26 h 在 serve 里写成常量并注明出处 `market.follow.STALE`，因为 serve 不导入产品包；
    测试里对照 `market.follow.STALE` 断言两者相等，规则改了测试会提醒。
  - 503 `MARKET_IMPORT_UNAVAILABLE`：文件不存在或读不了（服务还没跑完第一轮，或卷没挂上）。
  - 503 `MARKET_IMPORT_UNREADABLE`：不是 JSON 对象，或 `at` 不是 ISO 时间。
  - 没配 `--market-import` 时 404 `NOT_FOUND`。
- 不缓存、不轮询：文件很小，读取由页面触发。

### 3. 页面（`ide/web`）

**状态栏一项**（右侧，`UpdateStatus` 之前），页面每 60 s 取一次。文字按以下先后取第一条成立的：

| 条件 | 文字 | 颜色 |
|---|---|---|
| 503 | `Market: no status` | 失败色图标 |
| `stale` | `Market: no round for 31 h` | 失败色图标 |
| 有 `stopped` | `Market: stopped — CODE`（多个不同代码时 `CODE +2`） | 失败色图标 |
| `publish_failing_since` 早于 26 h | `Market: publish refused — CODE` | 失败色图标 |
| 有 `unknown` | `Market: unknown — CODE`（`round_refusal` 的代码） | 失败色图标 |
| 有 `lagging` | `Market: lagging 2026-09`（最早的落后月份或日期） | `misses` 色图标 |
| 有 `waiting` | `Market: waiting 2026-10 (archive not out)`（最早的等待月份或日期） | 静音 |
| 都 `caught_up` | `Market: caught up` | 静音 |

有 `running_since` 时后缀 ` · importing`（和更新状态一样的转圈图标，减少动态时是静止图标）。图标着色、文字仍是
状态栏的静音色，与 `UpdateStatus` 的失败样式一致。跳过的月份不算不健康（与 `check()` 一致），只在表里出现。

**点击打开一个弹出面板**（现有 `PopoverWidget` 的样式，`DataTable`）：

- 顶部一行：`Last round <at> · next <next_round>`，在跑时 `running since …`；`round_refusal`、
  `publish_refusal` 有则各一行（代码加消息）；`published` 的推送结果有则显示提交短号。
- 表：每行一个 kind × 合约（bars 只有一行 `scope`），列为 Kind、Contract、State、Next / through
  （quotes、trades 用 `next_month`；bars 用 `through`；metrics 用 `missing_from` 和 `missing_days`）、
  Skipped（月份列表）、Refusal（`refusal` 的代码；只有 `retry` 时写代码并标 `retrying`；消息放提示里）。
- 所有值取自状态文件，页面不推算任何状态。时间按 UTC 显示。

## 测试

- `tests/research_graph/test_serve.py`：没配参数 404；文件缺失 503；坏 JSON 503；新鲜的 `stale=false`；
  `at` 早 27 h 的 `stale=true`；错误 Host 403；无 CORS 头；常量等于 `market.follow.STALE`。
- 页面：状态栏文字的取法写成纯函数，放进 `ide/web/scripts/*.test.mjs` 的现有测试方式，覆盖上表每一行。
- `npm run check`、unittest、ruff、mypy；亮暗两套截图（用伪造的状态文件跑本机 `ide.py serve`），独立子代理
  审美评审后再交付。

## 不做

- 不做市场数据页、覆盖热力图，不在 IDE 里重启服务或触发导入。
- 不把健康状态写进账本或市场库。

## 需要用户授权的部分

1. 本方案。
2. **部署配置改动**（单独问）：`ide` 服务挂载 `trade-market-import` 卷（只读）并加 `--market-import` 参数。
   现在 `ide` 看不到这个卷；改后它能读该卷全部内容（状态文件和公开归档缓存），不能写。不改的办法：IDE 无从
   知道状态，只能继续用 `docker compose ps`。
3. 合并后重建 `ide` 服务（`docker compose up -d --no-deps ide`）只在用户发话后做。

用户 2026-11-02 回复「同意」，批准本方案和第 2 项的挂载。第 3 项（重建 `ide`）仍等用户发话。
