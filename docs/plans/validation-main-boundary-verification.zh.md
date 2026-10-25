# J.2.4.4 样本外 main 环境与代码边界核验

2026-10-25。工程核验执行 Git `4607cc3bc0bd3af8f756481f4ac1a83fc2161ddf`，开始前同步远程 main；本次文档另同步至 `94929b3dde86ca61205a46082b22f133ce9d631d`，引用原实测结果，未重新建库、拉镜像或运行该组工程测试。

**核心准入边界已取得隔离工程证据，覆盖场景内未发现需要修产品的准入缺陷。** 当前 `rc7` 与历史 `rc3` 两组真实镜像探针接入真实 Dolt 绑定事务，拒绝回滚及一次性绑定通过；市场、研究基线和 TSA 使用夹具，不代表真实行情回放、样本外封存或完整报告交付验收。J.2.4.4 继续保留待验证及具体证据缺口。

## 镜像、源码与原生探针

| 用途 | 镜像摘要 | 构建提交／Nautilus |
| --- | --- | --- |
| 核验时解析的 main 镜像及第二组绑定 | `sha256:9e3c257f71f998fa5bb37c4ca687e7c89f7eb1ba0b6df4024f0496ffb29ae0b4` | `cbf2d03429ca03bac2e91ca07c276c534cf414a3`／`2.0.0rc7` |
| 原缓存历史 main 镜像及第一组绑定 | `sha256:9ab421a995fb3c32c40d46acc8cf04b00a728dd4fa1b015df3f1bb4b295b5be9` | `5d1ebea4efc9996a796246140f44b5b3df33b3bc`／`2.0.0rc3` |
| 非 main 拒绝对照：PR #1737 镜像 | `sha256:219cf761f9375c183d6abc2cf44f584bfb552ec276937253b04e36b5101e6358` | `c6262f171f3850dadf156145eea22f3f3824c298`，不属于核对时的 main 历史 |

均为 `ghcr.io/qoeop/trade-runtime`、`linux/arm64`、`replay-contract@v7`。分别核对成功的 CI 构建：[main rc7](https://github.com/qOeOp/trade/actions/runs/40192369268)、[历史 main](https://github.com/qOeOp/trade/actions/runs/40171988871)、[PR](https://github.com/qOeOp/trade/actions/runs/40189268998)。

通过既有 `image.resolve`、`image.inspect_runtime` 读取真实镜像摘要、标签及容器内 `engine.run --describe` 回执；探针禁网、只读，没有执行策略或打开市场数据。真实 `require_main_build` 核对仓库、main 归属和运行器各源码、审计器及依赖锁的字节。

历史 main 镜像通过符合既有规则：要求构建提交在 main 历史上且字节匹配，不要求恰好是最新镜像。本次分别记录版本，不把 rc3 当作当前 rc7，也不收紧为“只能用最新镜像”。

## 八种代码新鲜度对照

两组各用独立 `/tmp` bare Git 远端和克隆，调用原生 `require_fresh`，未替换其 Git 命令或返回值。

| 场景 | 结果 |
| --- | --- |
| HEAD 等于远端 main | 通过 |
| HEAD 含 main，存在已跟踪／未跟踪修改 | 通过 |
| HEAD 含 main，另有本地提交 | 通过 |
| HEAD 落后于远端新 main | STALE_CHECKOUT |
| HEAD 与远端新 main 分叉、不含新提交 | STALE_CHECKOUT |
| 新 main 对应克隆 | 通过 |
| 路径不是 Git 工作树 | STALE_CHECKOUT |
| 远端不可核实 | STALE_CHECKOUT |

当前只检查 HEAD 是否包含远端 main 最新提交，不检查未提交文件；本次没有改为要求工作树干净。临时 Git 远端用于核验真实 Git 逻辑，不代表已验证公共远端竞态或网络故障。

## 真实 Dolt 绑定及回滚

两组都用原生 Dolt 2.4.2、独立库 `test_mainboundary`，kind=isolated、backup=null：历史组 `/tmp/lg-32so4uoz/`，rc7 组 `/tmp/lg-dueib80p/`。创建未来一分钟窗口，既有离线 LocalAuthority 签署 RFC 3161 回执，真实 OpenSSL 按临时测试根验证；等窗口真实结束后再合法绑定，没有伪造时间或放宽窗口检查。

实际调用 `trials.open_trial` → `validation_binder` → `validation_bind`，使用真实 `require_fresh` 和 `require_main_build`，没有将其替换为成功结果，也没有跳过提交验证。

| 对照 | 结果 |
| --- | --- |
| 回放入口遇落后代码 | 行情导出前 STALE_CHECKOUT，夹具导出计数不变 |
| 绑定阶段遇落后代码 | STALE_CHECKOUT，事务回滚 |
| 真实 PR 镜像 | RUNTIME_NOT_MAIN，事务回滚 |
| 七类哈希异常 | config、runner、load、report、fingerprint 源码、audit 源码、uv.lock 分别不符时，全部 RUNTIME_NOT_MAIN 并回滚 |
| 合法 main 镜像 | 每组只新增一个 validation 试验和一个绑定 |
| 重复绑定 | REGISTRATION_CONSUMED，保留原绑定，无额外试验或绑定 |

哈希异常只修改原生探针回执的工作副本，原回执、镜像、源码及检查不变。每次拒绝前后核对 head、ledger_head.seq、试验／证据／登记／绑定／运行行数、最大已存试验 ID、目标绑定和 dolt_status，观察状态完全相同。成功前登记未消费；成功后重复绑定保留原绑定。

每组 **35 个脚本检查点通过**，共两组；跨版本重复场景不等于 70 项独立单元测试。每组包含八种代码场景、十个成功前拒绝、一次成功和一次成功后的重复拒绝。

- 历史组：trial 12，合成提交 `754n7b7iaei0k4i8a1pt4e0hmgbm437o`。
- rc7 组：trial 12，合成提交 `s95s11pidml331lmup89hd991i36de2p`。
- 开始凭证保存对应镜像摘要及 `runtime_identity.build_revision`；失败插入可留下自增 ID 空隙，实际每组只新增一条验证试验。
- 成功后是已绑定、未执行策略的临时试验；运行表没有新增完成的样本外运行，不能写成样本外回放成功。

## 既有测试、接口文案与材料

另运行 8 项既有测试，**8 项通过、无跳过，25.128 秒**：`FreshCheckoutTests` 2 项、`MainBuildTests` 3 项、`ValidationTests` 的身份匹配和一次绑定 2 项、`SealedReplayTests` 的导出前新鲜度 1 项。既有单测含镜像/main 检查替身，新增临时对照另用真实镜像及原生 main 检查补充。本轮文档没有重跑这些测试；未运行全量测试、技能评测或策略收益评测。

API 文案同步按现有实现校准两点：构建版本来自镜像标签，身份未携带字段时函数读取镜像标签；版本保存在开始凭证的 `runtime_identity.build_revision`，没有独立的 `image_revision` 存储列。`require_main_build` 本身只读并返回版本，不写账本。没有修改检查逻辑、参数、schema 或增加存储列。

工作材料位于 `/tmp/trade-validation-main-boundary-20261025/`，`delivery-manifest.json` 记录 40 份文件 SHA-256，排除临时 Git 库、TSA 密钥及 Dolt 凭据。原始 SQL/试验、策略、探针、数据库和日志不纳入 Git。关键指纹：

| 文件 | SHA-256 |
| --- | --- |
| boundary-result.json | `f3d53ea7fdd23b502b938bbe41ccf2a74d57e1c1d3a613a3ac805b4124052a2c` |
| current-image-binding/boundary-result.json | `95367c2bd445f41e188e3b363f955fe2700777d8cc37fdbcaabb3f99a17f9ad4` |
| images-result.json | `1fcc25a2d1b1499b52c12001c93ea4e10a1c038f789ad9e9f24beee87a11d666` |
| current-image-result.json | `27b31697e1f06111e0584fc4a0cd803cff056062347e7880f11d1d49c25300fe` |
| tests.stderr | `bf4e8b2ff6e233bf65b0130c2de747320294a265ea04a8cff6c1b2de5a31965e` |

## 保留的缺口与留存边界

市场、候选／研究基线和登记时资格使用既有 World 夹具，研究账户条款取自真实镜像探针；基线本身不是原生市场回放。TSA 使用临时测试 CA，本地响应函数替代网络发送，不是公共机构凭证交付。真实部分包括镜像、探针、Git、main 归属、源码/锁字节、Dolt 事务和本地 RFC 3161 验证。

仍缺真实行情导出、Nautilus 策略回放、样本外封存、经济读数及完整报告；公共 TSA、真实远端竞态、真实网络超时及所有拒绝分支也未全面验证。结果限于记录的摘要、平台与窗口，不外推所有镜像、市场或未来 main。

两组临时 Dolt 服务已停止，探针容器退出，夹具保留在 `/tmp`；没有打开活动研究库、市场库或备份，没有真实研究发布或交易连接。原生 main 标签解析拉取新镜像后，旧摘要引用一度不可读，已按原摘要重新拉取并确认镜像 ID 与原件相同；原有 main、PR #1737、PR #1722 摘要最终均可读，未删除、prune 或 gc。暂时不可读的原回执与后续恢复回执均保留。

首次镜像描述脚本遗漏必填市场参数，失败日志保留在 image-attempt-01；修正的是临时脚本，没有改产品。文档继续保留“待验证”，本次补充核心准入的隔离实测，不把它提升为完整真实样本外验收。
