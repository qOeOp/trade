# 回放事实只存一份：逐项审阅

2026-10-20。授权：请求方转述，用户 2026-10-20 授权把新试验和新运行写入的重复存储去掉（doctor 的 U6，对应 A6）。`docs/plans/doctor/index.zh.md` 和第二次诊断记录里这一项仍写着“暂缓”，以用户本人的确认为准。依据 origin/main 76ad625b1。

按 AGENTS.md，改账本里存什么之前先做独立审阅。审阅由一个只读子代理完成：它没有参与实现，只读代码和测试，不写库。下文按项记它的结论和这次的实现。已存的行一律原样保留。

## 重复从哪里来

活动账本只读核查（`ledger sql`，按 sha256 分组 evidence 行），每个试验都有：

1. 策略源码存三份：`candidate.source`、开始回执的 `strategy.py`、捕获的 `source/strategy.py`。
2. 覆盖回执 `input-coverage.json` 存两份：开始回执一份，捕获一份。
3. `native.stdout.txt` 与 `reports/summary.json` 逐字节相同：`engine/report.py` 写完摘要又把它打印到标准输出。
4. `run.fingerprints` 与捕获里的 `fingerprint/fingerprint.json` 是同一份指纹。两者序列化方式不同，Dolt 按块去重也合并不了。
5. `run_sealed.report` 里的 `metrics_revision` 键与同一行的 `metrics_revision` 列重复。
6. 覆盖回执逐合约存 `funding.event_times_ms`，而这些时刻在钉住的市场提交里可以重新读出。

Dolt 会按内容去重，完全相同的字节几乎不多占盘，所以这件事的收益主要不在磁盘，而在两处：

- 捕获上限 `CAPTURE_LIMIT`（32 MB）按存进去的字节算。在全池回放的存储审计里（`ledger-storage-audit.zh.md`），覆盖回执 24.9 MB、标准输出 3.65 MB，单这两份副本就占掉约 28.6 MB。
- 读者要读、复核要核对的东西少了。每份副本都要和另一份保持一致。

## 逐项结论

| 项 | 结论 | 保留哪份 | 捕获怎么记 |
|---|---|---|---|
| 1 源码 | 采用 | 候选行；没有候选持有这个源码时，开始回执留一份 | `source/strategy.py` 一律只记哈希 |
| 2 覆盖回执 | 采用 | 开始回执 | `input-coverage.json` 一律只记哈希 |
| 3 标准输出 | 采用（改产出方） | `reports/summary.json` | 照常捕获标准输出，只是引擎不再回显摘要 |
| 4 指纹 | 采用 | `run.fingerprints` 列 | 预检以外，`fingerprint/fingerprint.json` 只记哈希 |
| 5 计量修订 | 采用 | `run_sealed.metrics_revision` 列 | 报告 JSON 里不再写这个键 |
| 6 资金费时刻 | 采用 | 钉住的市场提交 | 导出回执只存条数和首末时刻 |

六项都没有删成，也都不需要改 schema（`SCHEMA_VERSION` 不变），活动账本照常可读。只记哈希用的是捕获里已有的 `hashed` 状态，原生报告一直就是这样记的。读者对 `captured` 和 `hashed` 两种状态都按清单里的哈希核对，所以旧捕获（存字节）和新捕获（只存哈希）不需要兼容层，同一套读法都能读。

### 1. 源码

- 读者：开始回执的 `strategy.py` 在产品里没有读者，`read_capture` 只读 `execution.json` 和 `input-coverage.json`。捕获那份有两个读者：`read_capture` 核对它的哈希等于试验的源码哈希；`recover_capture` 做同样的核对。候选那份经 `strategies.read_candidate`（会核哈希）给回放、复现、导出和比较用。
- 各份证明什么：执行之前，`start_receipt` 核对源码字节等于试验行的 `source_sha256`。候选行只插不改，`source_sha256` 是生成列，所以执行前的源码已经由候选行加试验行证明。容器里实际加载的是什么，由运行器在镜像里按哈希核对，再把 `source_sha256` 写进摘要，入账时核对 SOURCE_MISMATCH。捕获那份只是宿主上只读挂载的文件，回放后再读一遍，它的字节证明不了哈希证明不了的东西。
- 按“有没有候选行”判断，不按用途判断：探索未发布的文件时，没有候选行，开始回执那份是唯一一份，必须留；复现试验虽然也是探索，但源码已经发布。所以 `start_receipt` 在同一事务里查候选表，有就不存字节。
- 捕获：`source/strategy.py` 对所有用途（预检也算）都只记哈希和长度。`read_capture` 和 `recover_capture` 改为核对清单里的哈希，强度不变；入账时 `_verified_files` 照旧对工作目录里的文件重算哈希。

### 2. 覆盖回执

- 捕获那份没有独立内容：封存时 `_require_coverage` 要求工作目录里的字节等于开始回执那份，否则 COVERAGE_MISMATCH。运行器和审计器都只读挂载它。所以封存之后，捕获那份按构造必然相同。
- 改为只记哈希，两个读者的核对保留，改成比哈希：`coverage.original_coverage` 核对清单哈希等于开始回执字节的哈希，然后用开始回执的字节；`metrics.load_run` 同样比哈希，不等就拒绝 EXECUTION_IDENTITY。旧捕获存着字节，清单哈希就是那些字节的哈希，比较结果和原来逐字节比较一样。

### 3. 标准输出

- 只有干净跑完时，标准输出才等于摘要。策略里的 `print()`、运行器在写摘要之前失败时的输出、Nautilus 的输出都走标准输出。产品里没有读者，只有 Agent 诊断时用 `evidence export` 读它。
- 所以不在封存时跳过它，也不加“与摘要相同”这种新状态（那样要么丢诊断输出，要么多一个存储概念），而是删掉 `engine/report.py` 里的 `print(payload)`。
- 引擎改动只能随新的 CI 镜像生效：旧镜像仍会回显，复现用的是试验自己的 `image_ref`，不受影响。复现比较的是报告的语义指纹，与标准输出无关。按 `engine/README.md` 做了配对原生回放，结果见下文“实测”。

### 4. 指纹

- 列的读者：`replay/reproduce.py`、`report/runs.py` 的 `verify_reproduction`、`report/review.py`（FINGERPRINT_MISSING）、`ledger/admin.py`（导出清单）、`metrics.load_run`、`qualification/availability.py`（活动计数）。捕获那份的读者：入账（`capture_problems`、`capture_fingerprint`），以及复现时读新探索试验的捕获。
- 留列不留捕获字节：AGENTS.md 把原生报告的指纹列为封存时一次算出、要存的读数；列如果清空，复核的 FINGERPRINT_MISSING 和不可用原因就会对每个新运行报错，等于改了审计检查。删列要改 schema，活动账本会读不了。
- 预检以外，`fingerprint/fingerprint.json` 和原生报告一样只记哈希和长度，字节留在工作目录：入账时从 `_verified_files` 读；复现从输出目录读；`verify_reproduction` 从给定目录读。三处都由 `problems.sealed` 先核对长度和哈希，再用字节，信任强度和原生报告相同。预检照旧存全部文件。
- 失去的只是无效运行和探索试验的指纹字节。无效运行的列本来就设计为 NULL，没有读者。

### 5. 计量修订

- 留列（主键的一部分）。`ledger.metrics` 不再把修订写进报告；`metrics.latest_sealed` 返回报告时，从该行的列补上修订，所以 `report/runs.py`、`qualification/availability.py` 等读者不用改，旧行里那个键被列值覆盖（两者相等）。未封存目录的报告（`directory_report`）自己取当前修订。
- 新入账的 `report_sha256` 会变；操作 ID 仍经 payload 里的 `metrics_revision` 绑定修订。

### 6. 资金费结算时刻

- 存储数据里没有读者：引擎只读片段计数，审计的生命周期检查读 `pieces`、`episode`、`last_bar_ns`，`ledger/coverage.py` 读 `pieces` 和 `instrument_id`。时刻可从钉住的提交重新读出（`market.read_funding`）；提交不可改，改历史会被 `market review` 发现；市场库重建后 K 线也没了，回执里的时刻也帮不了复现。
- `rows`、`first_ms`、`last_ms` 看不出窗口中间漏了一次结算。这个判断由 Agent 用按需计算的 `market coverage` 输出来做，所以那里保留时刻，只是存进账本的导出回执不再带。要在存储里放一个紧凑的替代，就是新增字段，需要另做审阅。
- 实现只改 `market/export.py`（`receipt_coverage` 在写回执前去掉时刻），`market/coverage.py` 不动，免得和 #1618 删三个占位字段的改动冲突。
- 代价：改 `market/` 会改变导出器哈希，回执形状变化会改变导出内容哈希，两者都在 `input_key` 里。所以本改动之前的运行，在新代码下复现会因输入身份不同被拒（REPRODUCTION_MISMATCH），旧对照与新候选不可比，现有导出缓存全部重导。#1618 改 `market/coverage.py` 也有同样的后果，两者应一起合并，让这次断裂只发生一次。这符合重构期不兼容旧数据的用户规则（2026-10-19）；活动账本的 `research status`、`replay report`、`ledger review` 仍可读（见 PR 的只读核对）。

## 实测

在一次性账本上分别用 origin/main 代码加 main 镜像、本改动代码加 PR 镜像，各跑一遍同一组流程：预检、源码审查、研究路线、登记、研究回放、复现。策略是 ema-cross-root@2，合约 BTCUSDT，窗口 2025-01-01 到 2026-10-01，交易从 2025-02-01 开始，市场提交 l1kfbo4b…。单位是逻辑字节。

| 试验 | 改前 | 改后 | 省下 |
|---|---|---|---|
| 研究试验：开始回执 + 捕获 | 342,176 | 32,871 | 309,305（90%） |
| 同一次运行的 run 行指纹 + 封存报告 | 164,558 | 164,494 | 64 |
| 复现（探索）试验：开始回执 + 捕获 | 342,325 | 33,008 | 309,317 |
| 预检试验：开始回执 + 捕获 | 264,179 | 226,196 | 37,983 |

研究试验省下的部分：

| 项 | 字节 |
|---|---|
| 捕获里的指纹 | 174,118 |
| 捕获里那份覆盖回执 | 57,850 |
| 开始回执里那份覆盖回执中的资金费时刻（1,914 条） | 51,720 |
| 两份源码 | 21,770 |
| 标准输出 | 3,756 |
| 清单变短 | 91 |

覆盖回执随合约数线性增长，全池回放省得更多。

配对原生回放（BTCUSDT，同一窗口，同一一次性账本，main 镜像 353d53de… 对 PR 镜像 352bc923…）：

- `engine.compare_reports` 判通过：订单、成交、持仓、账户、日收益、资金费调整的不匹配数都是 0，期末权益相同。
- 语义指纹文件逐字节相同。
- 两边审计都通过，只有记录报告字节哈希的 `file_sha256` 不同，因为报告里有随机 UUID。
- 摘要只有代码哈希和镜像身份两处不同。
- 标准输出从 3,756 字节（与摘要相同）变为 0 字节。

## 顺带发现、这次不做的重复

都是一份记录绑定另一份记录的小副本：

- 捕获清单的 `argv`、`runtime_identity` 抄自开始回执；
- `stages` 与 `process.json` 重复，封存时要求相等；
- 开始回执 `input_identity` 在同一回执的 `input-coverage.json` 里又出现一次；
- 输入身份的 `membership` 重复成员文件；
- `trial.instruments` 重复 `input_identity.symbols`；
- `run.audit` 的 `{ran, findings}` 抄自 `audit/audit.json`。最后这项和指纹一样，是 AGENTS.md 要求封存时存下的审计读数。

以后可另起一轮处理。
