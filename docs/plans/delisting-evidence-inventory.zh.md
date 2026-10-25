# 研究窗口下架结算证据盘点

2026-10-25。盘点窗口为 UTC `[2025-10-01, 2026-10-01)`，执行 Git 版本为 `9caa42445ecc5ba130c3528d9df5a996d63bed22`，固定市场快照为 `53tgna1pa02hb1t9v6r3h6pqh8d2e1s1`。此次文档分支另从最新远程 main 建立，不将后来的代码变动算作盘点时已执行的验证。

**本次官方公告核对到 50 个 USDT 本位永续终止事件，当前快照币池涉及 2 个；完整结算价／算法输入证据为 0，所核查账本快照中的正式生命周期包为 0，未认定结算验收通过。** 公告时钟已有可核对的官方原件，但不能因此写成已取得结算价、已接入原生回放或全池可运行。

## 当前快照与历史全池的范围

| 范围事实 | 本次读数 | 可支持的结论 |
| --- | ---: | --- |
| 固定快照的基础导入范围 | 30 合约工程 allowlist，22 笔导入消息一致 | 不是交易所全量合约导入 |
| 窗口内月度币池 | 去重 24 个，每月 22–23 个 | 只说明该固定快照的成员，不改写历史全池 |
| 文档历史全池 RSI 记录 | 208 个活跃合约、209 个片段 | 历史观察，不能冒充当前快照的覆盖验收 |
| 公告终止事件与当前币池交集 | 2 个 | BAKEUSDT、AI16ZUSDT |
| 公告终止事件在当前导入范围之外 | 48 个 | 行情、月度成员、重上市片段和回放可运行性未由本快照确认 |

最近试验样本 200／201／203 的窗口均为该年、仅含 BTCUSDT，202 为短窗；样本只用于确认盘点窗口。本次没有另选研究线、改币池、删币缩窗、变更市场提交或判断策略失败。历史全池的输入身份与当前快照的完整映射尚未查明，不能外推两者等价。

## 当前币池涉及的两项

| 合约 | 官方禁止新开仓 UTC | 官方结算／终止 UTC | 最终结算价 | 完整算法输入／独立复核 | 正式生命周期包 |
| --- | --- | --- | --- | --- | --- |
| [BAKEUSDT](https://www.binance.com/en/support/announcement/detail/82df1b55a0d84c288fa396d5a5cead48) | 2025-10-03T08:30:00+00:00 | 2025-10-03T09:00:00+00:00 | 本次未取得 | 未齐／未算 | 固定账本快照中缺失 |
| [AI16ZUSDT](https://www.binance.com/en/support/announcement/detail/db54931adb044aa3b9b7997d2128757c) | 2025-11-06T08:30:00+00:00 | 2025-11-06T09:00:00+00:00 | 本次未取得 | 未齐／未算 | 固定账本快照中缺失 |

上述时钟是公告明确给出的 UTC 时刻，未从最后一根行情推断。原始 CMS JSON 与 SHA 保留在 `/tmp`，尚未写入账本或生成正式 `lifecycle-<market_commit>` 包。AI16Z 的 1:6 换币比例不是合约结算价格，不作代填。

## 50 个终止事件的分组清单

仅按官方主结算条款的**事件时刻**落入半开窗口；不以公告发布日期代替。以下是本次核对到的事件，不认证目录外、已删除或历史版本中的其他事件已全部穷尽。

| 终止 UTC | 合约 | 数量 | 官方原文 |
| --- | --- | ---: | --- |
| 2025-10-03T09:00:00+00:00 | BAKEUSDT, HIFIUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/82df1b55a0d84c288fa396d5a5cead48) |
| 2025-10-20T09:00:00+00:00 | SLERFUSDT | 1 | [公告1](https://www.binance.com/en/support/announcement/detail/c045753243994cfcba6a22563389e910) |
| 2025-11-06T09:00:00+00:00 | AI16ZUSDT, KDAUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/db54931adb044aa3b9b7997d2128757c)、[公告2](https://www.binance.com/en/support/announcement/detail/ebe57975b8c34e928c7d3fdacfcef32a) |
| 2025-11-14T09:00:00+00:00 | 1000XUSDT, MYROUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/869c1c15564048e29ae6139578637cd4) |
| 2025-11-21T09:00:00+00:00 | FLMUSDT, PERPUSDT, XCNUSDT | 3 | [公告1](https://www.binance.com/en/support/announcement/detail/6392491d998b4cbaa6d4beee0fd898c6) |
| 2025-11-23T06:30:00+00:00 | PORT3USDT | 1 | [公告1](https://www.binance.com/en/support/announcement/detail/aa3cc74779bf456e8b100304905b9cc2) |
| 2025-11-28T09:00:00+00:00 | PONKEUSDT, QUICKUSDT, SWELLUSDT | 3 | [公告1](https://www.binance.com/en/support/announcement/detail/53998d26b57f47beb97811ec9f5e582b) |
| 2025-12-05T09:00:00+00:00 | MILKUSDT, SXPUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/746056ce732d43dda12c1e5ae1b7a059) |
| 2025-12-05T09:30:00+00:00 | OBOLUSDT, TOKENUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/746056ce732d43dda12c1e5ae1b7a059) |
| 2025-12-10T09:00:00+00:00 | FISUSDT, REIUSDT, SKATEUSDT, VOXELUSDT | 4 | [公告1](https://www.binance.com/en/support/announcement/detail/7621c0ff8a924305b6e8fe78ce2c7fcd) |
| 2025-12-11T12:15:00+00:00 | AIAUSDT | 1 | [公告1](https://www.binance.com/en/support/announcement/detail/20eee4109e06448992f0557bf798bb36) |
| 2026-01-21T09:00:00+00:00 | BIDUSDT, DMCUSDT, TANSSIUSDT, ZRCUSDT | 4 | [公告1](https://www.binance.com/en/support/announcement/detail/5798be852fb5449bb438dde4166126dc) |
| 2026-01-30T09:00:00+00:00 | 42USDT, COMMONUSDT, CUDISUSDT, EPTUSDT | 4 | [公告1](https://www.binance.com/en/support/announcement/detail/79211335d1de4f7589ad2d8780580970) |
| 2026-02-10T09:00:00+00:00 | RVVUSDT, YALAUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/9ac36fb4f2ad4bf2b3b27f9c9224739c) |
| 2026-03-17T09:00:00+00:00 | 1000WHYUSDT, BDXNUSDT, VFYUSDT | 3 | [公告1](https://www.binance.com/en/support/announcement/detail/f6ebc17e4dbd451b873d9ef25c801237) |
| 2026-04-08T09:00:00+00:00 | HIPPOUSDT, OLUSDT, PUFFERUSDT, RLSUSDT | 4 | [公告1](https://www.binance.com/en/support/announcement/detail/97b4f3a7d02a486c8d412ada2281b907) |
| 2026-04-28T09:00:00+00:00 | B3USDT, BOBUSDT, DEGENUSDT | 3 | [公告1](https://www.binance.com/en/support/announcement/detail/1d2b6970facd470dbba6a674e1595bd4) |
| 2026-04-28T10:00:00+00:00 | AIUSDT, VINEUSDT | 2 | [公告1](https://www.binance.com/en/support/announcement/detail/ba5d61807b474b0ca9f40250e7fa782c) |
| 2026-04-29T09:00:00+00:00 | DAMUSDT, IRUSDT, ZKJUSDT | 3 | [公告1](https://www.binance.com/en/support/announcement/detail/1d2b6970facd470dbba6a674e1595bd4) |
| 2026-06-28T09:00:00+00:00 | IPUSDT | 1 | [公告1](https://www.binance.com/en/support/announcement/detail/5702f93568604ea7bfd2f4233f054bd1) |
| 2026-07-24T06:30:00+00:00 | AERGOUSDT | 1 | [公告1](https://www.binance.com/en/support/announcement/detail/f0e3fc835b9545759e4279c64b200389) |

## 结算价、算法与正式证据包

- 官方 CMS 下架目录 161 的 9 页、444 条目录项全部取得且无重复，读取全部 444 篇原文，再补 AI16Z 换币公告，共 445 篇。50 个事件来自其中 20 篇终止公告；COIN-M、USDC 和窗口外事件另有排除清单。其他目录、删稿、历史版本不保证穷尽。
- 20 篇已审阅终止公告给出了时钟，未给出具体最终结算价格；本次未取得新的官方最终价格发布，不推断其他位置绝对没有发布。
- 公告引用的 [Delisting of Futures Contracts FAQ](https://www.binance.com/en/support/faq/detail/dd60dfbf654d4055aa6b217ea6d5ddba) 当前版本更新于 2026-02-11 17:43 UTC，描述最后 30 分钟每秒指数价的 1,800 个样本均值。仍缺具体合约结算时适用版本、完整秒级指数输入、边界／舍入细节及独立复核；当前 FAQ 是算法线索，不是每个历史合约适用性的认证。
- 已知缓存类型为 klines、markPriceKlines、aggTrades、fundingRate，市场表持有 1 分钟 LAST／MARK 等；未在既有证据中找到完整秒级指数输入。没有用分钟价格、最后报价、零值、插值或换币比例推算结算价，也没有新建结算器。
- 初始账本快照 `3r148khmamggsn9n4sq6p5uhodls89sl` 和盘点终了快照 `f9vlncqmods0mbp8ltj9vsa7kuv0fhnd` 均无 `lifecycle-*` 包，也未找到相关证据文件引用。所查 Trade 工作目录和选定 `/tmp` 目录未找到可读取的 lifecycle.json；旧备份、离线账本及其他路径未恢复或穷举，不将当前零结果外推为历史从未存在。
- 盘点期间研究账本有并发提交，最大试验从初始快照的 203 到终了快照的 206；初始提交仍可从新 head 到达，市场 head 未变。本次只以 reader 查询，没有回滚或改写并发记录，不能宣称账本 head 全程未变。上述读数只对应所列快照，不替代以后时点复查。

## 数据末端与运行结论的限制

BAKEUSDT 与 AI16ZUSDT 均有延续至 2026-10-18 的零成交量、常数 OHLC 行，最新非零成交量分别为 2025-10-03 08:59 UTC、2025-11-06 09:00 UTC。末端行不是继续交易或下架时刻的证据，更不是结算价。来源与经济影响本项未追查，未据此修数或改变历史运行资格。

本项能支持官方终止时钟与缺项核对，不能支持“已取得真实结算价”的原生有价结算，也未把任何区间标成完整可运行。缺价时提前清仓撤单的已定边界保留；具体回放仍须有绑定固定市场提交的正式生命周期包、完整其他输入及相应审计。48 个快照范围外事件、历史全池映射、正式包与结算证据缺口继续保留，不新增拒绝或审计规则，不自动移除合约或缩短窗口。

## 复核入口

工作副本位于 `/tmp/trade-delisting-evidence-inventory/`：`delisting-inventory.csv/json` 为 50 个事件，`current-universe-delistings.csv` 为当前币池两项，包含源 URL、文件、时钟及缺失状态；排除清单、导入范围、数据边界、固定快照和并发提交检查均保留。官方原始 JSON 在 `sources/`，491 个来源文件有指纹清单；完整交付清单为 538 个临时文件。源原件、逐项回执、CSV、脚本和研究数据不进入 Git，本文仅登记工程发现。

复核确认 50 个事件无重复、均落入指定半开窗口，2 个交集与月度币池一致，两个 CSV 分别为 50／2 行，官方成功响应与指纹一致；完整结算证据与固定快照正式包均为 0。主网页 HTTP 202 空体没有当作有效原件，后续官方公开 CMS JSON 成功取得。前置字段名和临时汇总问题的日志保留，未绕过产品检查。没有写账本、市场库或缓存，没有登记、原生回放、策略研究、价格代填或产品／依赖／规则变更。
