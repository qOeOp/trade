# R1：公共策略边界提取与验证记录

2026-11-08。产品基线 `a00b4f1b8748e8b858423c8e85a270985e0c1931`，独立 worktree `/tmp/trade-live-modularization-r1-20261108`，分支 `codex/live-modularization-r1-20261108`。主工作区的另一会话正在修改 UI，本批没有操作那些文件。

本批对应[正式设计](live-modularization-single-source-20261108.zh.md) R1：`engine.strategy` 持有原公共 native 分配、构造失败边界、callback/cache/clock guard、subscription声明、进程内source与失败记录。`engine.fill` 只是原 native fill-model 工厂的提取。Paper/Live/恢复会话不再导入 Replay runner。Replay 动态类仍注册于 `engine.run`，`StrategyInputs`和原函数入口保持；可变全局不在旧模块假转发，全部内部读写迁到一个 owner。

16个提取后的类/函数经 AST 对比确认主体保持（只正规化 `_Subscriptions` 改名与共同构造函数的mode factory默认值；默认值仍在旧 Replay 入口）。没有更换任何拒绝条件、reason、失败计数上限、Paper hold或交易执行顺序。既有测试只调整 owner/import/mock路径，不放宽断言。新增三项测试检查：全新解释器中Paper/Live不载入Replay、连续两轮失败文件及源归属、共用cache拒绝记录。

## R1 提取阶段检查

- 159项相关回归通过；包括原生构造、loader、Paper、恢复、Live入场和连接。
- Ruff 全仓通过；Mypy 123文件通过。
- 完整标准命令 `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：1448项，1439通过、9跳过，耗时343s；跳过项是本地缺少固定版本 Caddy / OAuth2 Proxy 二进制的集成测试。两份独立实施评审已完成：迁移主体未发现行为差异；均提出下述源码身份覆盖P1，阻断发布。
- 首次完整运行额外套临时网络sandbox，阻止了Dolt Unix socket/ps及控制服务本地socket，报告208 errors/2 failures；其中一项是漏迁移的 DATA_CALLBACKS 测试导入，已修复。保留原始失败日志，按仓库标准命令重跑，未改测试标准或产品配置。
- 尚未完成CI固定镜像的reference/candidate成对CLI replay；不能用本地通过或AST等价宣称parity。U1原生观察见[独立实验报告](live-modularization-native-validation-20261108.zh.md)。

## 源码身份覆盖修复

首轮独立评审发现：`deploy.runtime_inputs.project`/Dockerfile覆盖新engine文件，但v7源码map只有原config/run/load/report/compare，加单独audit/lock；提取代码已不在runner逐字节hash中。构建输入配对和image digest不能代替逐文件来源证明。原失败证据和评审保留。

用户随后明确授权[源码身份提案](live-modularization-r1-source-identity-proposal-20261108.zh.md)。修复候选 `fea0b3bff6d784fae8ed32a0fcc9eae9ef390ba6` 为新构建补入strategy/fill哈希；保留旧v7完整五文件清单。主线校验先确认可信Git revision，再静态读取该revision的唯一字面量清单，要求inspection完整一致并核对Git字节。不能用旧五项绕过新revision的七项要求，直接入口也执行这些检查。旧记录与旧镜像不迁移，不执行取回的Python。

这只恢复被抽取代码的身份覆盖，未改交易验收标准。固定镜像成对回放尚未完成，不能据本地验证宣称parity。R2–R4不在此批，正式源迁移U2也未开始。

## 评审结果与下一步

两位reviewer独立复核了冻结候选 `cc56fccbe7654401dfdb5906db74da03b8901f25`。代码评审还确认fill_model逐AST等价；原生评审核对六组原始JSON/log，未将模拟venue能力误称Binance。两者均要求先修复源码map缺口、再完成固定镜像成对验收；源码map修复已按用户授权实施，复审闭合见下文。具体最小修复及独立字段审查见[源码身份提案](live-modularization-r1-source-identity-proposal-20261108.zh.md)。候选已提交草稿PR #2480，未合并、未部署。

## 授权后源码身份修复验证

- 固定代码候选 `fea0b3bff6d784fae8ed32a0fcc9eae9ef390ba6`。
- 标准完整unittest：1454项，1445通过、9跳过，337.733s；跳过仍为本地缺少固定Caddy/OAuth2 Proxy。日志 `identity-full-tests.log`。
- Ruff 全仓通过；Mypy 123文件通过。新增6项测试使用隔离Git历史、临时源码副本与mock probe，不运行Docker或连接交易所。
- CI runtime/IDE双平台构建及gate通过。quality首次在下载固定ffmpeg时HTTP 504，原样重跑在下载固定Dolt时HTTP 504，均未执行测试。失败日志保留为 `identity-ci-first-failure.log` / `identity-ci-retry-failure.log`；未更改固定版本、校验或测试条件。
- 全套测试完成后，两位reviewer独立复审固定代码，均确认原P1关闭、无新增代码阻断。原件为 `review-source-identity-code-v1.md` 与 `review-source-identity-native-v1.md`，位于 `/tmp/trade-live-modularization-r1-evidence-20261108/`。
- 第二位reviewer另核对实际base与candidate config字面量分别为五项/七项；六个R1核心原生模块自首轮冻结候选无新增diff。复审没有把源码身份修复、本地测试或镜像构建当成paired replay通过。
