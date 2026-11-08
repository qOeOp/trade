# Live 模块化与统一源码：设计评审记录

2026-11-08；对应[正式设计](live-modularization-single-source-20261108.zh.md)、[证据矩阵](live-modularization-native-evidence-20261108.zh.md)和[原生保护能力审查](live-modularization-native-protection-20261108.zh.md)。本记录只描述设计与离线核对，不代表实施、部署或真实运行完成。

## 评审方式

按用户要求，先冻结候选，再由两位独立 agent 分别评审架构与 Nautilus 能力；两者不交流结论。首轮发现经作者修订后，同一组修订文件再次交给两位独立复审。原稿、失败探针与评审原件保留在 `/tmp/trade-live-unification-design-20261108/`。

- 架构评审：`/root/formal_design_arch_review`，模块所有权、依赖、锁、迁移、单源码合同。
- 原生能力评审：`/root/formal_design_native_review`，rc7 配置/Python 桥接/核心调用链、文档和原生测试，防止重复实现已有能力。
- 基线：产品 `1a0482263dd1e71781ca6306a456f0137cc76dbb`；Nautilus `v2.0.0rc7`、官方 commit `55c0e82053142bce3a5cba4de4221d3929c2d3bc`。

## 首轮发现与处理

| 发现 | 修订决定 | 状态 |
| --- | --- | --- |
| NATIVE-01：漏查 Python Catalog 配置入口 | 实验确认 `BacktestEngineConfig(catalogs=...)`；撤回新增 historical_bars 构造参数，三模式均用 native request/callback | v2 两份复审确认设计层关闭 |
| ARCH-P1-A：预热时钟与晚到缓冲未定 | 明确 T、完整覆盖、80根时间集合、T+30s 截止、首根交易 bar；删除追赶缓冲 | v2 两份复审确认设计层关闭 |
| ARCH-P1-B / CONTRACT-02：pending 入场没有源可观察终态合同 | 保留全轮 fail-stop，列出成功/失败/取消/STOP/断线/晚到结果；不伪造订单事件 | v2 两份复审确认设计层关闭 |
| ARCH-P2-C：普通 re-export 不能代理可变全局赋值 | R1 全部读写迁移到单一 owner，保留函数 shim，补动态类解析与连续运行归属回归 | v2 两份复审确认设计层关闭 |
| CONTRACT-03：先选手写独立保护、partial 协议不完整 | 撤回自有保护优先顺序；核实 native manager/emulator 能力；明确 U1 候选、venue/产品限制、实证与追加评审门 | 待原生选型，不能开始 U2 |

## 验证与边界

本轮实际通过：现产品9项原生构造测试、4项原生部分成交保护测试；两个最小 Catalog/精确预热探针。另两个 Catalog 请求区间覆盖不足探针失败，原件保留。补充的 native manager/emulator/Sandbox 测试本轮只读源码，不计为执行通过。没有运行新架构或完整正式源三模式验收。

没有修改产品、策略源、检查、Nautilus 版本、真实账户或历史验收结果，没有新增持久字段，没有连接交易所、读取凭据或操作 Docker。保护选型不能为通过测试改标准；框架未查清不视作不存在。

## 冻结稿与最终复审

v1 原稿 hash：`54cbb7fb073cb16e1efad4c2d2dcd333b54daf0b37454703b0e653a87afbb7a8`；v1 证据 hash：`f32c7f108319be41aba29c823dca4aa984f9cfc1478477a305a99cf92dfdfafe`。两份原评审均未通过直接进入 U2，发现没有被覆盖删除。

v2 两份独立复审已完成并核对如下候选：

| 文件 | SHA256 |
| --- | --- |
| `design-v2.md` | `cd1150a81b9f69de4e018a1e5861c5271a738dde3dede2978758aa4fdcf5b34b` |
| `evidence-v2.md`（当前证据矩阵） | `f7368cd955f044485bd7c337a23518469149cc097b153bf1d9814474cbd47fcc` |
| `protection-v2.md`（当前保护能力审查） | `137641a3119a6f70e7c6b889f998370a22d55e652454a1eb05c891b73fa86ce0` |

- 架构复审原件：`review-architecture-v2.md`。通过 R1–R4 与 U1 设计准入；原 P1-A、P1-B、P2-C 关闭；不批准 U2/U3。
- Native 复审原件：`review-native-v2.md`。未发现阻断 R/U1 的新增能力误判；Catalog 设计错误已解决，异步合同明确；保护选型缺口仍保留，不批准 U2/U3。

出版 v3 只澄清策略身份：同值业务参数与每 run 的 native 身份、账户、runtime/input 绑定区分；OMS/GTD/保护语义不能任意变化。顶部同步明确设计准入范围。证据矩阵和保护审查没有变化。

当前主文 `design-v3.md` SHA256：`f3bd1b7b0b400039b3e569c6592a226649b0f31bead064d3c2c6542a36cf0b6a`。两位均已独立核对该窄差异，原结论保持：R/U1 可推进，U2/U3 不得跳过前置门。原件分别为 `review-architecture-v3.md` 与 `review-native-v3.md`。

## 可以推进什么

1. **R：模块化重构设计可实施。** 首个变更提取公共原生构造/边界，迁移可变全局读写与动态类归属；不夹带新交易行为。
2. **U1：统一源码的原生验证可实施。** 已冻结历史/时间/fail-stop 合同；优先用原生 fixture 验证保护候选 B，查清命令检查路径和真实数据需求。
3. **U2：正式源码迁移尚未获得准入。** 必须把 native mixed 配置、部分成交/退出事件表、STOP_MARKET 修改边界、ticks 输入和每类自动命令检查路径变成实证，再追加设计复审。若不满足，先记录框架/venue 的具体能力缺口，不直接新增自有机制。

这是一份可推进模块化并约束统一源码选型的正式架构设计，**不是完整统一策略执行规格全部已经验证的声明**。GTD 调查不阻塞前两项；一次入场测试也不替代之后单策略连续运行的正常产品验收。
