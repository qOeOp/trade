# 发布服务与原生运行时配对

## 问题与授权

`53f7dfd26b15` 的发布记录曾将包含新 Live 检查的服务与来自 `c0359` 的旧运行时配对。
旧发布器只在目标提交自身构建 runtime 或上一次 runtime 为空时选择镜像；非空旧值会跨过
中间的 `engine/` 修改继续沿用。提交祖先关系不能证明运行时包含服务所要求的代码。

用户于 2026-11-07 明确授权收紧发布和部署配对检查：完整构建输入相同，保留原有全部 CI
资格条件，没有合格镜像时不发布，部署端拒绝保留的错误组合。历史记录不改写。

## 独立事实与唯一比较实现

不新增存储字段。目标 source revision、已测试 artifact 中的不可变镜像 digest、实际 OCI
revision 标签、Git tree 的 path/mode/blob 已经提供事实。输入投影只在一次资格评估中按
不可变提交缓存。发布器与安装在主机上的控制程序共用 `deploy/runtime_inputs.py`。
这修复发布信任边界，不接管 Nautilus 的订单、账户或执行状态。

投影读取完整 Git tree，不使用可能截断的提交差异。CI 拒绝 truncated tree，并将读取的
Dockerfile 原始内容重新计算 Git blob identity；主机通过 `git ls-tree -r -z` 和原始
`git show` 读取相同事实。投影包括：

- 固定路径 `engine/runtime/Dockerfile`；其中基础镜像必须引用 digest。
- 每个本地 `COPY` 的全部 tracked 文件、文件模式和 blob identity，包括新增、删除、通配符
  匹配目录的所有后代。当前主要是 `engine/*.py`、`pyproject.toml`、`uv.lock`。
- 已存在的根和 Dockerfile 专用 `.dockerignore`，以及 runtime workflow、路径判定 action/script、
  原生验证入口、manifest 发布脚本和投影实现自身。这些是构建或资格定义，不等于镜像内的文件。

当前解释器只支持现有 Dockerfile 使用的有限输入语法；新增 parser syntax/escape directive、
续行、动态/JSON COPY、外部 build context、ADD、ONBUILD、RUN mount、symlink 或 submodule
等输入形式会拒绝，须先扩展并测试输入合同。它不是通用 Dockerfile 解释器，也不主张追踪
验证入口的任意 Python 依赖闭包。`.dockerignore` 不用于删减投影，因此保守包含被忽略的
tracked 输入可能引起重新构建，但不会漏掉变化。

## 发布与使用

每次有资格的服务候选都从分页历史重新查找 runtime。候选必须是该服务提交的祖先，来自
本仓库 main push，仍是该源码最新的 runtime run/attempt，且该源码原有的所有 workflow 和
最新非发布器 checks 都符合既有成功条件。然后比较完整输入并读取该次已测试不可变 artifact。
某个 runtime workflow 成功不能覆盖同一源码上 cancelled 的 IDE workflow。

无合格匹配时追加 image/service/runtime 均为空的 withheld 记录。较早的 runtime 完成事件可以
重新评估频道上较新的服务提交，但不能回退 source；频道 CAS 冲突后重读全部资格事实。
历史记录保留。现有 artifact 保存期是 30 天，资格 artifact 过期后不能无限沿用旧 runtime；
需要新的成功构建或可验证的成功重跑，不能据 mutable tag 猜测旧资格。

`deploy.images` 从实际镜像配置验证 revision、来源、平台和 manifest 后，再验证 runtime
相对目标服务的输入。Paper 控制器也在实际 pull 和 OCI 标签验证后、创建候选和写切换事务前
检查相同条件；错误组合不会触及当前控制器、路由或策略。Web-only 切换不拉取 runtime，
没有额外的主机配对检查；它消费 CI 的共同发布记录。已经运行的策略仍使用原固定镜像。

## 安装与验证

新的 bootstrap installers 安装共享 helper。已有主机的控制代码不会随 main 自动更新；
需要从已审查版本更新 `deploy/runtime_inputs.py`、`deploy/release.py` 和
`deploy/paper_release.py`。更新期间持有主机原有 release lock，在下一 tick 前完成文件替换；
不重新运行首次接管的 installer，不重建 Paper/Live 策略或修改交易账户。发布修复合并到
main 与主机控制代码更新是两个不同的验收点。

独立审查发现并修复了两个输入遗漏：通配符命中目录、Docker parser directive 的合法空格和
escape 变体。回归包括过时非空 runtime、增加/删除/模式变化、服务专属变更复用、取消/失败
资格、分页、晚到 callback、CAS 重试，以及真实 Git 历史和部署前拒绝错误组合。
测试结果由对应 PR 记录；这份设计不把模拟或代码检查当成真实 Live 成交验收。
