# 有效配置哈希要不要存：字段审阅

> 2026-10-20 补记：用户已授权连同 `runtime_inspection` 参数删掉它那条恒真的拒绝（其有效配置须等于开始回执所记，否则 EXECUTION_IDENTITY）。实现按本文 (b) 做，同时删了这个参数；输入身份那一半核对和 EXECUTION_IDENTITY 拒绝码保留。下文「先不删，单独提出来问」是审阅当时的建议，已由这次授权结清。

2026-10-20。第三阶段审阅后，`ledger.ingest_run` 的失败原因只剩一项不出自封存：有效配置哈希（effective_config_sha256）仍取自调用方传入的 `runtime_inspection`，只要求它的配置等于开始回执所记。实现方的说法是封存里没有这个哈希，要补上就得把哈希存进回执。按 AGENTS.md 加存储字段前先做独立审阅，结论记在这里。依据 origin/main 7c252753d。

## 谁在用

全仓只有一处用到：`ingest_run` → `problems.capture_problems` → `summary_problems`。它拿这个值和封存原生摘要 `reports/summary.json` 里的 effective_config_sha256 比，不等就记 CONFIG_MISMATCH。运行行、封存结果、可比资格（`config_key`）、复现、复核（status、review）、样本外验证都不读这个哈希，它们读回执或登记包里的配置本身，去掉主机路径后再比。账本表里没有存它的列。设计页 ingest_run 第 8 条也写明有效配置已在开始回执与执行封存里，运行行不重复存。

## 它是不是独立的事实

不是。哈希是配置的函数：`engine.config.config_sha256` 去掉 market_root、universe_path，再算规范 JSON（sort_keys、紧凑分隔符、ensure_ascii=False）的 SHA-256。

- 开始回执 input-coverage.json 存的 effective_config，就是探针 `--describe` 原样输出的那份（`replay.input_coverage` 直接写入，没有改名）。已封存，在 trial-N-execution-start 里。
- 探针 `runtime.image.inspect_runtime` 已经在宿主上按同一规则重算，算出的值不等于探针报的哈希就拒绝（RUNTIME_MISMATCH）。所以调用方传进来的哈希，本来就等于回执里那份配置的哈希。
- 镜像在运行时自己算出的哈希已封存在摘要里，这才是唯一独立的观察，而且它已经存着。
- 实测（scratchpad 里的 fieldreview/probe.py）：探针输出经 JSON 往返、写成回执再读回，宿主重算的哈希等于引擎算的；换主机路径，哈希不变。配置里只有字符串、整数、布尔和列表，没有浮点，往返不丢精度。

## 考虑过的做法

| 做法 | 结论 |
|---|---|
| (a) 在开始回执 execution.json 或覆盖回执里加 effective_config_sha256 | 不采用。存的仍是调用方给的值，又和同一回执里的配置互为副本，还多出一条哈希与配置是否相符的核对。违反账本只存回放给不回来的东西、不存可派生值的规则 |
| (b) 入账时从封存的回执配置重算哈希，再和封存摘要的哈希比 | 采用。不加字段；CONFIG_MISMATCH 两边的值都来自封存 |
| (c) 运行行不需要哈希，可比用 config_key | 前半句对，(b) 也不存它。但只靠 config_key 就没法核对摘要：摘要只带哈希，不带配置。要是把这项核对删掉，就是放宽审计检查，需要用户授权 |

## 建议的改动

1. 在 ledger 里加一个宿主侧函数，和 `engine.config.config_sha256` 规则一致：去掉 `("market_root", "universe_path")`，对剩下的部分算 `sha256(db.canonical_json(...))`。可以放在 `ledger/problems.py` 里（ledger 只引用 ledger 自己，不能引用 engine）。`runtime/image.py` 第 200–204 行的内联重算改为调用这个函数，规则只在宿主写一处。镜像里保留引擎自己那一份。
2. 在 `ledger/trials.py` 的 `ingest_run` 里：
   - 把 `capture_problems(..., runtime_inspection.get("effective_config_sha256"))` 改成传入重算的哈希 `config_sha256(receipt["effective_config"])`。回执配置不是对象时，按现有的 EXECUTION_IDENTITY 拒绝。
   - 核对 K 线分钟数时，`bar` 改从 `receipt["effective_config"]["execution_bar_minutes"]` 读。
   - 删掉没人用的 `effective_config` 参数（函数文档自己写着不存），一起改 `replay/entry.py:442` 和测试里的调用。
3. 测试：`tests/replay/world.py` 和 `test_entry.py` 里的探针替身现在用常量 `CONFIG_SHA = "f"*64`，要改成按配置真算，否则通过的用例会变成 CONFIG_MISMATCH。再加一条用例：探针替身给一个错的哈希，入账结果不受影响；摘要哈希不等于回执配置的哈希时，记 CONFIG_MISMATCH。
4. 文档：在 design-code-ledger 的 ingest_run 参数表里，把 runtime_inspection 的说明改掉（现在写着运行契约与依赖锁哈希由它派生，这已经不对），注明配置哈希由开始回执的配置重算。

改完以后，`runtime_inspection` 只剩一个用处：它的配置要等于回执所记，否则 EXECUTION_IDENTITY。唯一的调用方 `replay.seal` 传进来的就是写回执用的那个对象，所以这条核对恒真。要不要连参数带这条拒绝一起删，属于改拒绝检查，AGENTS.md 规定要先问用户。所以这次先不删，单独提出来问。

## 风险

- 规则漂移：以后的运行契约要是改了哈希规则，或者多了一个主机路径键，宿主重算就会和摘要对不上，所有运行都记 CONFIG_MISMATCH。这是失败即拒绝，问题看得见。而且探针那一步已经用同一规则核过，漂移在开新试验之前就会被拒绝，不会等到入账才发现。规则变化应当随运行契约升版。
- 判据边界：CONFIG_MISMATCH 的条件没变（摘要哈希 ≠ 本次配置的哈希），变的只是期望值从哪来：从调用方给的改成从封存派生。这是在补现有的缺口，让实现符合设计页「失败原因由本函数从原始执行封存算出」，不是放宽检查。主会话要是认为这算收紧检查，就按 AGENTS.md 先报用户。
- `config_key` 去主机路径的规则是按 `*_root`/`*_path` 后缀匹配，引擎用的是固定列表，现在两者结果一样。新函数要用固定列表，跟引擎一致，不要复用 `config_key`。
