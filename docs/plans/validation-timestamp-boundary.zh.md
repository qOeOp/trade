# 正式样本外时间戳与重试凭证来源

2026-10-25，用户逐项确认：保留正式样本外登记的 RFC 3161 公共时间戳，保留原有严格窗口检查；修正证明范围与重试报告展示，不新增账本字段、拒绝检查或时间戳服务设施。

## 决定与边界

- 登记先提交，再发送登记诞生提交的哈希摘要取得外部签名凭证。它证明登记至迟在凭证时间已经存在，不证明方案唯一、数据未暴露、窗口未复用或策略有效。依据为 [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161.html)。
- 正式样本外绑定继续要求最初登记的凭证可验证，且 genTime 严格早于窗口起点。普通开发回放不因此增加时间戳要求。
- 取证失败保留登记，可在窗口开始前通过既有 `ledger witness` 补取。错过期限不能用服务器时间或倒填凭证补救；另选未来窗口重新登记。已有凭证离线验证；外部服务可用性、根证书信任与长期密码学维护仍有其依赖，未新增备用服务、自动切换或长期存证平台。

## 缺陷与最小修正

绑定检查原已沿 `retry_of` 使用最初登记的凭证，但 `report.validation_report` 读取当前重试登记的凭证。因重试发生在窗口结束后，本次凭证可能晚于窗口，甚至因网络故障缺失；报告由此不能准确说明实际准入依据。

- 将已有原始登记追溯函数命名为 `original_registration`，供登记、绑定、报告与整体复核共用；不改变追溯规则或准入条件。
- 报告的 `witness` 改为最初登记的凭证，增加读时派生的 `registration_id` 与 `commit_hash`，标明凭证所属登记和诞生提交。查询登记自身的 `registration.retry_of` 保留，便于追踪重试链。
- 原始凭证缺失或无效仍显示 `verified=false`、`stamped_at=null` 和 `UNWITNESSED`，保留其身份。`verified` 仅表示凭证验签成功，不是时间准入裁决。
- 没有 schema 变更；两项身份均从已有登记关系和 Dolt 提交历史推导，不存第二份事实。

## 文档

- 更新中英文页面（英文页保留既有待译提示）、报告返回结构和中文悬浮索引；移除本章与总清单的时间戳待定项。
- 修正“时间戳同时排除窗口重用等情况”的过度表述；其他机制负责自己的检查。
- 记录隔离测试与真实公共凭证离线样本的证据范围，不将其描述为真实样本外回放或公共服务在线可用性验证。

## 报告修正阶段的验证

- 定向测试两项已通过，使用隔离 Dolt 2.4.2 与本地测试时间戳机构，未请求公共服务：连续两次重试分别取得晚于窗口的凭证、取证失败，均能按最初凭证绑定且报告展示一致；普通登记及无凭证报告保留身份。日志 `/tmp/trade-timestamp-targeted-tests.log`。
- `RESEARCH_DOLT_BINARY=/tmp/trade-dolt-2.4.2.ItujDp/dolt-darwin-arm64/bin/dolt uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：510 项通过，无跳过，238.184 秒，日志 `/tmp/trade-timestamp-full-tests.log`。包含重试原始凭证失效时报告明确显示不可验证、按历史账本版本读取，以及既有窗口保留、无凭证拒绝、公共凭证离线验签与错误摘要／签名／nonce／根证书拒绝测试。
- 首轮全量测试中，新增登记窗口排在既有“最后窗口”之后，导致原有窗口保留测试触发正常拒绝。调整测试数据排列，使原有最后窗口仍为最后窗口；未改变该测试的断言或产品拒绝条件，随后全量重跑通过。
- `uv run --frozen ruff check .`：通过；`uv run --frozen mypy cli engine ledger market qualification registration replay report runtime services/research-graph/research_graph`：77 个源码文件通过。
- 产品包 `compileall` 与 `python -m engine.run --help`：通过。
- `npm run check:i18n --prefix docs-site`：47 组双语章节通过；`npm run build --prefix docs-site`：通过，日志 `/tmp/trade-timestamp-docs-build.log`；`npm run check:routes --prefix docs-site`：98 条期望／导出路由通过，94 个本地化页面有导航父级。
- 中英文 8 个静态导出页面的时间戳政策、返回身份、原始凭证解释、既有锚点及待定移除均核对通过；生成的索引、图谱与源文件一致。中英文的本次正文改动相同，保留英文页已有翻译差异。
- `git diff --check`：通过。
- 未操作活动研究账本或市场库；未改引擎，无需生成新回放镜像，本次不声明原生成交或经济结果的新验证。

## 整体复核修正（用户已单独授权）

`report/review.py:_validation_findings` 原逐条读取每次登记自身的凭证，并以其窗口判定 `WITNESS_MISSING` / `WITNESS_LATE`。合法重试发生在窗口后、或重试自身取证失败而原始凭证有效时，会产生与实际绑定依据不一致的发现。

用户在完成报告修正后明确授权“一并修正”。整体复核现沿既有 `retry_of` 使用最初登记的凭证和窗口，与绑定、报告共用追溯函数。原始凭证缺失或无效仍报 `WITNESS_MISSING`，恰在或晚于原始窗口起点仍报 `WITNESS_LATE`；没有新增判定类别。每条发现保留当前受影响登记的 `record_id`，`commit` 指向原始登记诞生提交，`detail` 说明原始登记身份。不因重试自己的晚签或缺失单独报告上述两种异常。

- 扩展既有多跳重试用例，通过读账号调用完整 `review_all`（跳过运行逐项读取，仍执行登记和时间戳审计），验证合法的晚签、缺签重试及历史版本无误报。
- 模拟原始凭证缺失、验签拒绝、时间恰等于窗口起点及晚一微秒，逐项断言原始登记和两次重试均产生对应审计发现，并指向原始提交。
- 修改前同一回归测试失败，直接复现合法重试的 `WITNESS_LATE` 误报；日志 `/tmp/trade-timestamp-audit-red.log`。本轮修正的验证结果如下。

### 整体复核修正后的验证

- 定向运行多跳重试的报告／整体复核用例与 `tests.report.test_review.TamperTests`：6 项通过，无跳过，27.674 秒；日志 `/tmp/trade-timestamp-audit-targeted.log`。
- 按 AGENTS.md 运行全量 Python 套件，显式使用隔离 Dolt 2.4.2：510 项通过，无跳过，241.564 秒；日志 `/tmp/trade-timestamp-audit-full-tests.log`。
- Ruff 全仓检查通过，Mypy 的 77 个源码文件通过；日志 `/tmp/trade-timestamp-audit-mypy.log`。产品包 compileall、git diff --check 通过。
- 双语章节检查 47 组通过；文档构建通过，日志 `/tmp/trade-timestamp-audit-docs-build.log`；路由检查 98 条通过，94 个本地化页面有导航父级。
- 中英文 8 个既有导出页面核对通过，并额外核对整体复核的原始凭证依据、严格时间边界及发现身份说明。生成索引与图谱匹配源文件，本轮双语正文改动一致。
- 未请求公共时间戳服务，未操作活动研究账本或市场库。没有引擎变更，本轮不需要新回放镜像，也不声明新增原生经济结果验证。
