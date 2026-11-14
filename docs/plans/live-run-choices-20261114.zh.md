# Live 页选择候选、合约与杠杆（2026-11-14）

依据：doctor 发现 20261114-20（`docs/plans/doctor/2026-11-14-live-not-installed.zh.md`）。用户 2026-11-14 批准（“按你说的三点做”）：候选、合约、杠杆在 Live 页选，与 Paper 同一候选校验；删除操作员源目录与 `purpose`；Live 自己的实盘检查（回放证据、运行时契约与 main 构建、市场条款、仅 USDT 合约、不跑池）不放宽。本记录只覆盖控制与页面（PR A）；主机声明与发布安装是另一个 PR。

## 规则

1. 候选是研究图里选中的版本（`strategy_id@revision`）。准备时 Live 控制在研究账本头部读它（`ledger.strategies.read_runnable`：`read_candidate` 加 `check_source`，与 Paper 复制源码时同一个函数），头部提交成为该运行的 `research_at`。不在头部或源码加载不了：`LIVE_SOURCE_MISSING`。
2. 合约在页面上输入，默认是该候选最近一次研究回放的合约（`ledger.paper.last_research_symbols`，Paper 也用它）。每个合约一个策略实例，规则不变。
3. 杠杆在页面上输入，默认 `3`（`engine.config.ACCOUNT_CONTRACT`）；回撤刹车与时长照旧。Live 运行容器内存固定为 `2g`，不再由操作员声明。
4. 合约的成员资格由市场目录按最新市场日派生（`market.universe.selection`，原 `paper/runs._membership` 移来，Paper 与 Live 共用）。派生不出：`LIVE_UNIVERSE`。
5. 派生出的成员文件写入 Live 根下的 `universes/<sha256>.json`，只写一次、按内容寻址；准备请求以 `universe_file` 与 `universe_sha256` 冻结它，准备时再拷进该运行的 `inputs/universe.json`（已有路径）。写入前先过一次 `admit_locked(root, inventory=False)`：Live 不接新操作时不往托管根写文件。
6. 页面新增两个只读 GET（经 IDE 的 `/api/live/*` 代理）：`/api/live/candidates/<id>/<rev>` 返回头部的候选（`research_at`、`source_sha256`、`entry_class`、`last_symbols`）；`/api/live/candidates/<id>/<rev>/evidence/<SYM,SYM>` 返回该候选在这些合约上的回放证据。证据按 (research_at, source_sha256, symbols) 在后台按需读取、缓存最近 32 个，读不到的 300 秒后再读；只用于显示，准备时照旧再读并拒绝。
7. `/api/live` 不再返回 `sources`，`defaults` 是上面的固定默认；运行视图不再有 `purpose`；通知里的运行名取自清单的候选。

## 存储字段

不新增存储字段，账本没有改动。`universes/<sha256>.json` 是 Live 私有根里的执行记录，不进账本、DoltHub 或 Git；它替代的是操作员声明里 `universe_file` 指向的手写文件，名字仍是准备请求与运行清单里已有的 `universe_file` 字段。准备请求的 `inputs` 少了 `source_id`，其余字段照旧。

## 改了哪些检查

- `LIVE_SOURCE_MISSING`：原来是“不在操作员源目录里”；现在是“头部没有这个候选，或源码过不了 `check_source`”。
- 收紧：Live 新增 `check_source`（原来只有 Paper 做）。
- `LIVE_IDENTITY_CHANGED`：不再比对操作员声明的哈希；准备、预检、启动与 `resolve` 比对的是请求冻结的哈希（准备时在同一提交读出）。
- `LIVE_REQUEST_CONFLICT`：重复的准备请求比对候选、合约与运行设置，不再比对 `source_id`。
- `resolve_prepare_path_locked` 不再要求 `source_id`。
- 新增触发：`LIVE_UNIVERSE`（市场派生不出成员资格，或已存在的同名文件内容不同）。
- `LIVE_SYMBOLS` 改在准备请求体检查时就拒绝空、重复、格式不对或不是列表的合约（`prepare_locked` 里同一检查保留）。
- 删除：`configuration.parse` 里对源目录的校验（源目录本身删除）。
- 不变：`LIVE_RESEARCH_COMMIT`、`LIVE_EVIDENCE_MISSING`、`LIVE_EVIDENCE_BALANCE`、运行时契约与 main 构建、市场条款、仅 USDT、不跑池、账户检查。

## 顺带修的缺陷

`ledger.paper.last_research_symbols` 查询不存在的 `trial.instruments` 列，Paper 的默认合约与不带合约的 Paper 启动因此失败；改为读 `trial_instrument`。

## 未解决

- 内存 `2g` 不随合约数变化；多合约运行若不够，需要按合约数定或回到可配置。
- 页面读到的候选与准备时读到的头部可能不同（中间有新提交）；准备以准备时的头部为准，页面显示的证据可能对应较早的头部，准备时会再读一遍。
