# 产品跨环境可移植性审阅

审阅对象为 Git `adba33f404525b0b91058d3d1d7ab06d1fa90547` 加当前工作区改良；这不是已发布版本。检查维护中的 Dolt API、原生回放、OCI、服务、配置、文档和测试，区分运行依赖、主机部署配置和固定历史来源。初审由三个独立子 Agent 分别检查台账运行时、回放/镜像和文档/服务；追加修复另作独立复核。未读取交易凭证或 cookie，未写入共享 Dolt。用户授权逐项修复后，使用隔离测试库和新镜像进行工程验证。

当前运行时 Python、Dockerfile 和 CI 未发现特定用户主目录、Homebrew 安装位置或本机 registry 作为执行默认值。以下保存原问题与修复证据；个人路径示例修正与运行行为修复分别验收。

用户截图中的 `--- a/...` / `+++ b/...` 携带 worktree 绝对位置，属于补丁的文件头定位信息。定向核对 `research/records/cli.py` 原文与 Git diff：源码没有这些头部或个人路径，Python AST 解析通过；Git diff 使用仓库相对位置。补丁展示中的地址不能作为源码存在本机运行依赖的证据，后续修改也使用仓库相对补丁路径。

## 核心发现与修复

| 优先级 | 原问题 | 当前修复与验收 |
|---|---|---|
| P1 | `retention.py` 的 `recipe_ref` / `verification_ref` 仅保留本机绝对路径与哈希，迁移数据库不能带走原件。 | 已修复新发布路径。v3 准入复用已有 material 原文字节与固定引用，同一事务保管配方、验证原件与发表凭据。真实 Dolt 回归覆盖原件删除后重试、异目录恢复、旧材料复用、固定引用、哈希失败无半个发布及改变原请求冲突。独立 `reconstruction_contract` 首尾冻结审阅通过；零新增表/业务字段。历史 v1/v2 不自动补字节；配方引用的依赖仍需实际保管。 |
| P2 | runner 接受无时区 ISO 参数，由宿主时区解释，可能改变窗口。 | 已修复。三个时间参数共用显式时区解析，加载数据前检查区间与五分钟边界，纳秒由整数运算得到。超过六位小数、fractional UTC offset 明确拒绝，避免 Python 静默截断。UTC/Tokyo 子进程结果一致；独立 `portability_candidate_review` 复核合法偏移及错误变体通过。修复后的固定 OCI 镜像完成原生配对验证，详见下文。 |
| P2 | ledger / retention / reviews 只排除 `/tmp`，artifacts 只排除平台临时根，持久化判断不一致。 | 已修复。各入口复用同一判定，解析符号链接后同时排除 `/tmp` 与平台临时根。回归覆盖自定义 TMPDIR、系统临时根、符号链接、正常持久目录、配置与 plan 写入前失败；保留原有 UID、权限和 artifact 根符号链接守卫。独立审阅通过，未增加权限降级或 Windows 兼容旁路。 |

上述三项实现缺口已修复。存量历史回填、第二台主机恢复及真实多轮 R&D 验收另列，不以代码回归通过代替这些证据。

## 已修正的低风险项

- `research/records/README.md` 的数据库根、review plan 和 artifact 根三个可复制示例改用展开后的 `$HOME`，删除对特定用户名的依赖；恢复说明明确另一台机器需要重配 binary / root / socket 路径。
- `docs-site/scripts/check-i18n.mjs` 由自身文件位置推导 repository root，去掉对启动 cwd 的依赖。从仓库根与 `docs-site` 两处执行，均通过四个双语章节检查。
- 同一 README 明确 POSIX 宿主依赖及 Linux OCI 两种架构的不同边界，并要求回放参数显式携带时区。说明支持范围不等于实现了 Windows 支持。
- `common.py` 的 JSON 读取、`artifacts.py` 的 JSON 写入、`ledger.py` 的配置与审阅计划写入显式使用 UTF-8。原行为在 ASCII locale / 关闭 Python UTF-8 模式时不能稳定读写中文；新增子进程回归覆盖这四个入口，相关 JSON / CLI / artifact 测试共 38 项通过。未改变原始证据字节、Schema、PID 或临时目录拒绝边界。

## 部署边界与次要改进

本机绝对 `binary/root`、Unix socket、PID 是部署配置；迁移后重建配置，保持 Dolt 版本和研究身份，不能原样复制 backend.json 后期待本机服务立即运行。`runtime.py:108` 和 `artifacts.py:77` 使用有效 UID/GID 与 POSIX 权限，`ledger.py` 使用 ps、信号和 Unix socket；当前没有原生 Windows 宿主实现或验收。本轮没有添加不安全的 UID 或权限降级。

固定历史 Git 取证需要 `research/records/history.json` 指定的 commit 在目标仓库存在。`history.py:73` 不自动 fetch 或换 revision，CI quality 使用 `fetch-depth: 0`。新环境恢复旧证据时要准备这些 Git 对象；单独的浅克隆、源码压缩包或 Dolt 备份不包含它们。现有 README 已声明这一边界。

输入 identity 中的 minute/daily 绝对目录是原始定位信息。`artifacts.py:134` 按调用者传入的新目录核对内容，不要求恢复到旧绝对位置；因此保留同一个冻结 identity、改变 CLI 输入目录可以迁移。重新生成 identity 文件会因为定位文字变化得到不同文件哈希，不能把新文件冒充原始 identity。

视频笔记服务的配置不一致也已修复：output 相对目录在创建前拒绝，artifact/import/output 展开开头的 `~` 后保留绝对路径与符号链接检查；MLX 只展开开头的 `~`，裸命令和 `./python3` 保持原解释器选择语义。README 明确进入 service 的工作目录，补充 `BILIBILI_NOTE_COOKIE_FILE` 的绝对普通文件要求和 `$HOME` 示例；没有读取 cookie 或添加自动凭据发现。50 项相关测试通过，修正独立审阅发现的 MLX 回归后又通过 14 项定向测试；Ruff、格式及 Mypy 检查通过。独立 `reconstruction_contract` 首尾核验六文件 SHA，通过最终候选；未调用真实 ASR 或联网 Bilibili。

## 应保留的固定路径与验证限制

当前蓝图与回放 README 通过迁移记录定位首次迁移合同，不再重复个人保管地址；迁移记录保留实际历史来源。`backtest/r1/receipts/parity-dolt-oci-h19a.json` 中 localhost registry 是冻结的历史镜像来源。它不是当前代码的默认路径。固定证据保持原字节与哈希，迁移时验证镜像和来源的实际可访问性，不能全库替换路径。

容器内 `/opt/trade`、`/inputs`、`/reports` 是镜像/挂载合同；MARK 缓存使用系统临时目录且可通过 `--mark-root` 覆盖，属于可重建输出。它们没有特定用户名依赖，不能与持久化证据混为一谈。

追加工程验证使用新构建的 `linux/arm64` OCI manifest `sha256:5785c9a11173c95f43b64a560b741c27f0ca91688c15cd61cf20b311aa647698`；探针核对镜像内实际 runner、时间辅助代码、锁文件和审计哈希。镜像归档、registry 字节、报告与配对结果保留在外部私有目录，未登记为新的策略研究证据。

BTC/ETH 固定源与输入对照 D105：888 orders、66 fills、19 positions、2,117 account rows、366 returns 一致；439 次 funding 合计 -33.26180486 USDT，最终权益 102098.92127801 USDT 一致，integrity / audit findings 均为空。该结果证明此次共享运行时修改在这份样本上的原生一致性，不替代 37 币策略资格验证。

其余证据包括路径扫描、双 cwd 文档检查、UTF-8 子进程、真实隔离 Dolt 回归与独立冻结审阅。没有在第二台物理主机或 Windows 完成恢复；主机部署配置和历史镜像来源仍须按恢复合同准备。
