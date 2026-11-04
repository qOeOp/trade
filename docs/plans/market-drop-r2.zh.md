# 撤掉 R2，把合约条款放进研究账本（方案）

2026-11-04 用户问 R2 还有没有必要。这份方案回答这个问题，并列出要改的东西和需要授权的事项。代码还没有改。方案已经过独立审阅（§9），下面是按审阅改过的版本。

## 1. 现在 R2 里有什么

| 内容 | 大小 | 能否重新获得 | 谁读 |
|---|---|---|---|
| `instrument.parquet`（条款） | 4.9 KB，30 个合约，每个 2 次观测（10-19、10-26） | 不能：币安只给当前条款，没有历史归档 | 每次回放 |
| `universe_month`（合约池） | 328 KB，82 个文件 | 能：11-04 用空缓存重算 81 个已收盘月，逐字节相同（条款已先恢复） | 回放 |
| `binance_force_order`、`bybit_all_liquidation`、`liquidation_watch` | 约 10 MB | 不能，是已停止的记录器录的 | 只有 `market coverage` |

不需要 R2 的：合约池能重算。爆仓表回放不读，用户已决定研究时按需用 CryptoHFTData。

条款是例外。回放在截至日 D 读 D+1 结束前观测到的最新条款（`market/files.py`、`market/instrument.py`），`terms_observed_at` 也算进导出指纹。目录丢失后重新观测，只会得到今天的行：钉在旧截至日的运行报 `NO_TERMS`，再也复现和比较不了。导出回执只存了 `terms_source`、`terms_observed_at`、精度和 `quote_size`，没有最小变动单位和限额，所以无法从已有记录反推条款。

R2 还有两个缺点：桶不能匿名读（11-04 实测，不带签名的 S3 请求返回 400），其他用户取不到条款；多一把写密钥、一段发布代码和一个健康条件。

## 2. 目标

- 条款随研究账本走：克隆 DoltHub 的 `vincent/trade-research` 就有条款，不用任何密钥。
- 去掉 R2、它的密钥和发布代码。
- 一次运行用到的条款，在这次运行写进账本时就已经在账本里。没有运行用过的观测丢了也无所谓。

## 3. 存放方式

**不加表、不加列、不加新的证据包种类。** 每个试验已有开始记录 `trial-N-execution-start`（`execution.json`、`input-coverage.json`），在里面加一个文件 `instrument.parquet`，内容就是这次运行导出时市场目录里那个文件的字节。

- **不重复存：** `evidence_content` 按内容寻址，文件没变就只多一行 `evidence` 引用。
- **不能被冒充：** `trial-*` 这个名字已经保留，Agent 写不了。
- **和运行一一对应：** 写入和试验行在同一次写入里（`ledger/execution.py` 的 `start_receipt`）。`market_database` 在同一份记录里，恢复时能排除其他市场。
- **不改 `execution.json`：** 读取方按文件名取文件，新文件不影响已有的读取。

**怎么传进去：** 四个开试验的地方（`replay/entry.py` 三处，`replay/reproduce.py` 一处）都从 `market_inputs` 拿导出结果。`market_inputs` 导出后读出条款文件的字节放进结果，缓存命中时也读。`open_trial` 收不到这个文件就拒绝，这样不会有哪条路径漏写（这是收紧检查，见 §7）。

**已有的运行：** 不用补写。条款文件只追加，合并后的第一个试验带的文件就包含 1 到 523 号试验用过的所有行。这个试验存在之前，R2 不能删。

**为什么不让 `market-import` 写：** 那要给它账本写账号，市场服务和账本从此互相依赖。

**增长：** 文件变了才多存一份，约 5 到 10 KB。目前 16 天里追加过 1 次（10-26，当时的代码把内容相同的条款也追加了一次，现在的代码不会）。真实条款变化很少，按每周一次算，每年约 0.5 MB。

## 4. 恢复

新增一条命令 `market restore-terms --ledger <账本> --market <市场>`，在宿主上跑，持导入锁：

1. 读账本里所有 `market_database` 等于该市场名的 `trial-*-execution-start/instrument.parquet`。
2. 按主键（symbol、observed_at）取并集，和目录里已有的行合并，写回 `instrument.parquet`。
3. 主键相同但内容不同时拒绝（新增 `TERMS_DIFFER`）。

**取并集，不取“最新的”：** 如果目录丢失后先跑了导入，下一个试验带的文件就只有今天的行，最新的文件并不完整。并集不受影响。

**恢复手册的顺序是硬要求：** 克隆账本，`market restore-terms`，然后才启动 `market-import`。先导入的话，合约分类会按今天的 exchangeInfo 算，并写下 `universe_month`，事后合并条款也不会重算这些月份。`NO_TERMS` 的提示文字加一句恢复命令，拒绝条件不变。

## 5. 删除的东西

- **代码：** `market/publish.py`（182 行）、`tests/market/test_publish.py`（263 行）、`market publish` 命令、`files.UPLOADED`、`cli/main.py` 里写入后发布的分支。
- **`market follow`：** 发布这一步，状态里的 `published`、`publish_refusal`、`publish_failing_since`，健康检查里的发布条件，以及 `follow.py` 对 `REMOTE_UNSET` 的处理。
- **IDE：** `model/marketImport.ts` 的 `publishOverdue` 等，`components/MarketImportStatus.tsx` 的相应显示，`scripts/marketImport.test.mjs`。
- **测试：** `test_follow.py` 里发布相关的用例，`test_liquidations.py` 对 `files.UPLOADED` 的断言。
- **拒绝（只删市场部分）：** `refusals.py` 里市场的 `PUBLISH_FORBIDDEN`、`PUBLISH_FAILED`、`PUBLISH_DIVERGED`、`REMOTE_UNSET`。账本发布（`ledger/publish.py`）也用前两个名字，它们留着。
- **配置：** compose 里 `market-import` 的密钥挂载和 `upload`。
- **文字：** `AGENTS.md`、`README.md`、`market/README.md`、`market/__init__.py`、`deploy/README.md`、`docs-site/lib/product-architecture.ts`、蓝图中英两份（`platform-architecture`、`design-database-market`、`design-code-market`、`design-code-ledger`、`design-code-cli`、`design-code-report`、`ledger-runtime`）。

失去的东西：

- **合约池不再和远端比对。** 重算不一致时，目录还在就由 `UNIVERSE_CHANGED` 发现，目录丢失后由复现时的 `REPRODUCTION_MISMATCH` 发现。
- **爆仓表只剩本机一份。** 目录丢失后这段记录就没了，`market coverage` 报告无覆盖，也就是未知。
- **市场数据不再有公开副本。** `AGENTS.md` 里“全部公开”这句对市场目录不再成立。K 线等本来就来自币安公开归档。

## 6. 步骤

1. **PR 1：** `market_inputs` 带上条款字节，`open_trial` 写入并要求必须有，`market restore-terms`。
2. **第一个带条款的试验：** 在正式账本上 `replay reproduce` 一个最近的试验（如 521），这本来就是研究记录。确认账本里有这个文件，且行数等于目录里的条款行数。
3. **验证（隔离账本和隔离目录）：**
   - 空目录，不恢复条款：导入后复跑 521，预期 `NO_TERMS`（对照）。
   - 恢复后：`instrument.parquet` 的行和正式目录相同，521、460 `fingerprints_match: true`。
   - 再开一个试验：`evidence_content` 不多新内容。
4. **PR 2：** 删除 §5 的内容。第 3 步通过前不合并。
5. **部署：** 重建 `market-import`、`paper`、`ide`，到时候再问一次。
6. **用户执行：** 在 Cloudflare 删桶，删 `~/.config/trade/r2-market.json`。在第 5 步之后。

## 7. 需要用户授权

| 事项 | 现在 | 改后 |
|---|---|---|
| 试验开始记录里多存条款文件 | 账本不存市场数据 | 账本存条款文件，每个版本一份 |
| 收紧：开试验时必须带条款文件 | 无此要求 | 缺了就拒绝 |
| 新增拒绝 `TERMS_DIFFER` | 无 | 恢复时条款冲突则拒绝 |
| 删除市场的 `PUBLISH_FORBIDDEN`、`PUBLISH_FAILED`、`PUBLISH_DIVERGED`、`REMOTE_UNSET` | 发布时检查 | 不再发布 |
| 改 `AGENTS.md` 的数据存放规则 | 市场数据有公开 R2 副本 | 条款随账本公开，其余只在本地 |
| 在正式账本上写第 2 步的试验 | 无 | 多一个 explore 试验（只追加） |
| 删除 R2 桶和密钥 | 留着 | 用户执行 |

## 8. 不在这份方案里

- 爆仓表和 `market/liquidations.py` 是否也从本地删除：回放不读，可以单独决定。
- 成交、报价、metrics 的完整重下载核对。审阅提醒：报价按最新存储的最小变动单位重算，如果以后 BTC 这类合约的 tick 变了，重建的旧月份报价会和原来不同，已恢复的条款也挡不住。没有实测，现有的 521、460 也测不到这一点。

## 9. 独立审阅

2026-11-04 一个独立子 Agent 对照代码审了初稿。我核对了它的主要发现，都成立，已改进上文：

| 发现 | 处理 |
|---|---|
| “最新的包含全部行”不成立：先导入后，最新的文件只有今天的行 | 恢复取所有记录的并集 |
| 新包名没有保留，Agent 能写入伪造的包 | 改放进已保留的 `trial-*-execution-start` |
| 一次性写入第一个包、新证据包种类都是多余的 | 去掉，合并后第一个试验就带全部行 |
| 漏列 IDE、测试和文档里的使用方 | 列入 §5 |
| `PUBLISH_FORBIDDEN`、`PUBLISH_FAILED` 也是账本发布的拒绝 | 只删市场部分，加上 `REMOTE_UNSET` |
| 先导入的后果比合并能修的更严重 | 恢复顺序写成硬要求，在宿主上跑 |
| “五个调用”实为四处；要做到不漏写必须拒绝缺文件 | 改正，并列入 §7 |
| “16 天变了 2 次”不对：两次观测内容相同 | 改正 |

审阅核实无误的：条款是独立事实，已有记录反推不出来；丢失条款会报 `NO_TERMS`；`open_trial` 的事务、幂等和并发都没问题；现有读取方不会被新文件影响；回放镜像不依赖这些代码；skills 和 evals 里没有 R2 的使用方。

审阅没有核实的：合约池重算逐字节相同和 R2 不能匿名读（这两条是我 11-04 实测的）。
