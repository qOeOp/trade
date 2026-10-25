# Dolt 2.4.2 历史视图定义语义核验

2026-10-25。验证开始前已同步远程 main，执行 Git `41f9cea2d02ef667e099c5d13d863ed9a37aaf82`；本次文档分支也从该 main 建立。仅在 `/tmp` 独立数据库中搭建合成夹具，未连接活动研究库、市场库或备份。

**J.2.9.2 的简单历史视图语义与现有读取入口已取得 Dolt 2.4.2 隔离验证：修订库同时固定当时定义和数据，视图 `AS OF` 使用当前定义计算旧数据。当前产品入口正确，无需修改产品。** 这是限定版本与场景的工程证据，不代表全部视图、报告路径或完整研究流程验收通过。

## 固定版本与隔离范围

| 项目 | 身份与范围 |
| --- | --- |
| 原生版本 | Dolt 2.4.2，darwin-arm64 |
| 二进制 SHA-256 | `02c603512e617ee165e485036ae63958fe1561d3b94251a9cdf6aa3418369310` |
| 独立服务与库 | `/tmp/trade-dolt-view-history-20261025/s`；`test_viewhistory`；kind=isolated，backup=null |
| 配置隔离 | `TRADE_LEDGER_HOME` 指向上述工作目录的 profiles；服务自己的 `DOLT_ROOT_PATH`、socket、数据及账号配置均在该临时目录 |
| 夹具入口 | 既有 `ledger.db.init` 建立隔离测试库；管理员连接只用于搭建合成底表和视图；提交使用原生 DOLT_ADD／DOLT_COMMIT，未跳过现有提交验证组 |
| 产品读取入口 | 真实 reader 账号，经 [`ledger.db.read_as_of`](https://github.com/qOeOp/trade/blob/41f9cea2d02ef667e099c5d13d863ed9a37aaf82/ledger/db.py#L673)；未 mock 版本、查询结果或权限 |

未修改产品、数据库结构定义、skill、拒绝或审计规则；未发布任何研究试验、策略或判断。所有夹具写入均限于独立临时库，不是活动账本操作。最终临时服务正常停止，夹具及核验材料保留在 `/tmp`。

## 分离视图变化与数据变化

夹具底表 `history_probe(id, amount)`，视图 `v_history_probe(id, observed)`。三个顺序提交分别建立基线、只改视图定义、只改底表数据：

| 提交 | 底表 amount | 当时视图 observed 表达式 | 当时结果 |
| --- | ---: | --- | ---: |
| A `b8a2j3te7og6qs6f4vkjfbnjl5498c9j` | 10 | amount | 10 |
| B `nhnan4tm4c18lultcsc91m4f6ebj79qa` | 10 | amount * 10 | 100 |
| C `d5f3jnrk67d8g3jmqcn5nnl9ur88ev6r` | 20 | amount * 10 | 200 |

这些是合成夹具的临时提交，不是研究账本或市场提交。逐一查询底表 `AS OF` 和 `dolt_schemas AS OF`，确认 A／B 底表相同、B／C 视图定义相同，避免同时改定义和数据掩盖差异。

## 修订库与 AS OF 的读数

在 C 为当前头时，当前视图结果为 200：

| 历史提交 | `v_history_probe AS OF <commit>` | 原生 `database/<commit>` 修订库 | 产品 `read_as_of` |
| --- | ---: | ---: | ---: |
| A | 100 | 10 | 10 |
| B | 100 | 100 | 100 |
| C | 200 | 200 | 200 |

A 的区别最直接：视图 `AS OF A` 取到旧 amount=10，却按当前的 amount*10 返回 100；修订库 A 保留旧表达式 amount，返回当时的 10。底表 `AS OF` 可以核对历史行，但不能由此推断视图 `AS OF` 同时固定了历史定义。

## 现有入口与持久性核对

- 3 个提交 × 2 种产品模式（普通／流式）× 2 个阶段（重启前／后），共 **12 个对照组合全部通过**。`readonly_sql=False` 在现有入口只切换为流式读取，不改变 reader 账号或权限。
- 每个组合核对 `DATABASE()`、`DOLT_HASHOF('HEAD')`、`resolved_commit` 和 `db.head_commit`，均指向目标提交；查询结果与原生修订库逐值相同，`SHOW CREATE VIEW` 对应当时定义。
- 两条在 A 时打开的产品连接，在 main 推进到 B／C 后仍返回 10，连接固定提交保持 A。服务重启后重新建立连接，历史结果与定义仍一致；不是声称连接跨重启存活。
- 共记录 **90 次 SQL 执行，无查询错误**。重启前后 `dolt_status` 均为空。
- 已有固定提交读取测试和引用／schema 拒绝测试 **2 项通过，无跳过，0.887 秒**；没有修改测试或放宽检查。本次没有运行全量测试。

既有测试命令：

```sh
RESEARCH_DOLT_BINARY=/tmp/trade-dolt-2.4.2.ItujDp/dolt-darwin-arm64/bin/dolt uv run --frozen python -m unittest tests.ledger.test_db.LedgerBaseTests.test_read_as_of_pins_an_exact_commit_and_reads_its_state tests.ledger.test_db.LedgerBaseTests.test_read_as_of_refusals -v
```

## 证据位置与未覆盖边界

工作材料位于 `/tmp/trade-dolt-view-history-20261025/`：`probe.py`、`results.json`、`queries.json`、探针与已有测试输出、`report.zh.md`。`delivery-manifest.json` 记录这 8 份文件的 SHA-256；原始 SQL、日志、数据库及临时凭据不纳入 Git。核心材料指纹：

| 文件 | SHA-256 |
| --- | --- |
| probe.py | `09f1b45783df3a3476190755dfd2bb2f1d1034d37b50a1584ca4000c45ddaa89` |
| results.json | `e597ea6f0e27cff9215c82b89617a2777d3bf4ebdc0c96cd79143c2f65510595` |
| queries.json | `1e899f95b162e59fe5498305619557e49e64416bc98e638ed3799e440d893719` |

本次只覆盖单层合成视图、独立底表数据变化及现有读取入口的上述行为；未全面验证嵌套视图、跨库依赖、其他 schema 演进、全部产品视图和所有报告路径。它补齐了“Dolt 2.4.2 未验证”的特定缺口，不关闭 J.2.9.1 的所有结构读取路径口径一致性缺口，也不代替完整研究流程验收。
