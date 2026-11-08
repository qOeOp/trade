# R1 发布前：恢复抽取模块的源码身份覆盖

2026-11-08；仅实施提案，尚未修改任何检查。关联草稿 PR #2480，候选 `cc56fccbe7654401dfdb5906db74da03b8901f25`。两份独立实施评审均确认该项阻断合并；其余 R1 搬迁未发现行为错误。原件为 `/tmp/trade-live-modularization-r1-evidence-20261108/review-code-v1.md` 与 `review-native-implementation-v1.md`。

## 当前问题与授权范围

拆分前，策略构造、cache/clock/callback边界、失败记录和fill factory在 `engine/run.py`，受 runner hash 校验。拆分后，现v7只核对旧五文件，未核对新 `engine/strategy.py` / `engine/fill.py` 的实际字节。镜像digest和发布构建输入配对仍在，但不能代替镜像代码与声明Git revision的逐文件核对。临时副本探针已证明：修改两新文件不会改变现metadata，修改runner则会。

拟只修复产品源码身份检查及其测试：

1. 新构建在既有 `source_files_sha256` / `source_file_paths` map 增加 `strategy_source_sha256` 和 `fill_source_sha256`，分别对应上述两文件；不改策略构造contract、不更改源文件、不迁移研究candidate。
2. 产品保留旧v7五文件清单，并增加新v7七文件清单。probe只允许其中一个完整固定集合，不接受子集、路径替换或任意额外路径。不能直接覆盖唯一v7清单，导致旧固定镜像无法读取。
3. `require_main_build` 必须从已核实main revision的 `engine/config.py`，只读解析唯一静态字面量 `RUNTIME_SOURCE_PATHS`，并要求它等于上述两份已审固定清单之一。绝不执行取回的Python；动态表达式、多次赋值、未知清单、缺文件均拒绝。不得从probe反向决定要检查哪些文件。
4. 新revision要求七项时，报旧五项也拒绝，即使旧五项hash正确；旧revision仍按原五项核对。直接调用 `require_main_build` 也检查完整布局，然后照旧逐文件核对Git字节，audit/lock/主线来源要求保留。
5. 旧运行、报表和历史原件不补写、不迁移；新检查影响后续源码身份验证，不改变GTD、资金、订单、持仓或策略收益判据。不新增数据库列或layout-version字段。

这是恢复原来被移动代码的证明范围，而不是为通过测试放宽交易验收。它仍改变产品允许的layout集合并增加拒绝缺项/降级的检查，因此实施前须按AGENTS获得明确授权。本次授权只涉及代码及离线测试，不合并、不部署、不启动Docker实测或真实连接。

不改变检查的替代：保留当前草稿不发布，继续原生能力验证；或撤销这次跨文件提取。不能维持当前抽取后遗漏的覆盖直接上线。

## 独立字段审查决定

架构 reviewer 在完整代码审查后独立同意两项map条目为最小恢复方案：

| 项目 | 结论 |
| --- | --- |
| 消费者 | runtime probe布局检查与 `require_main_build` 的实际字节对main证明 |
| 独立事实 | 所选固定镜像内两个实际执行模块的字节指纹 |
| 为何现字段不够 | runner import文本不含模块主体；config可绑定期望清单但不能代表实际模块字节；image digest固定镜像但不能替代该检查的Git来源证明 |
| 最小存储 | 两张已有对应map内各增加两个条目；不另建状态、账本或重复“已通过”字段 |
| 兼容 | 旧revision五项原件保持，新revision必须七项，不能降级 |

这份字段必要性审查不是检查变更授权。实施若引出其它存储字段须另行审查。

## 隔离验证计划

- 旧revision/五项与新revision/七项分别接受，旧原件字节保持。
- 新revision/旧五项、漏任一新增项、错误hash、调包路径、未知额外项均拒绝；直接入口与正常probe链均覆盖。
- 修改临时strategy/fill副本使metadata改变，并使对应main-build核对拒绝。
- 静态清单解析只接受预定字面量；动态、多次赋值、缺失、未知布局都不执行、不降级。
- 现全套测试、Ruff、Mypy及独立复审；保留失败原件。
- 修复验收后再安排CI固定镜像的paired CLI replay，按既有因果时钟、订单保护、费用/资金费/账户经济标准比较。本提案不把那项尚未执行的验收算成通过，也不扩大主机/连接授权。
