# 回放镜像：换镜像不再整线搬运行（2026-11-11）

用户 11-11 定「这次一起解决」：把"换镜像就要搬运行"放进这次重构（未结清单 A4）。初稿是在 `trial` 上新增 `replay_identity` 列。独立子代理评审后（第 6 节），改为拆出只装回放代码的镜像，账本不动。

## 1. 问题

- 研究里，运行的可比性、源码审查的适用范围、是否落后，都以镜像摘要为身份。位置都在 #2599 上：
  - `registration/comparability.py:18` 的 `IDENTITY`；
  - `registration/precheck.py` 的审查查找与 `exposure_exempt`（经试验关联到镜像）；
  - `report/status.py:686` 的 `runs_behind_image`；
  - `research_registration.image_ref` 外键。
  线上已过运行只要不在当前 main 镜像上就算落后，要 `replay reproduce --image` 逐个重放，才能再被比较或推荐。
- 镜像摘要比回放行为变得频繁：
  - 一个镜像同时服务回放、Paper 和 Live。它装了全部 `engine/*.py`（34 个文件）、整份 `uv.lock`、Paper 用的 redis，还带每次提交的 revision 标签（`engine/runtime/Dockerfile`、`.github/workflows/runtime-image.yml`）。
  - 回放实际执行的只是 `engine.run`、`engine.audit` 的导入闭包，再加 `engine.compare`（算指纹）和 `engine/__init__.py`。
  - 10-25 以来 main 约构建了 59 个镜像，其中约 40 个碰到回放闭包或 `uv.lock`。其余约三分之一只改了 Paper、Live 或工作流，却让整条线落后。
- 不该夸大：11-04 那次 182 个运行的迁移，起因是 Nautilus rc3→rc7、v6→v7 和加载器改动，都在闭包或锁文件里，这次的改法也省不掉。改法省掉的只是 Paper、Live 改动带来的搬运。
- 顺带的缺陷：`RUNTIME_SOURCE_PATHS`（`engine/config.py:42`，v8 还有 `runtime/image.py` 的 `LAYOUTS[...]["source_paths"]`）漏了 `klines.py`、`native_csv.py`、`live_errors.py`。三者都在回放闭包里，改它们会改变回放，主构建的源码证明却看不出来。

## 2. 目标与不做的事

- 目标：只改了回放不执行的东西时，回放所用镜像的摘要不变。旧运行照常可比，源码审查照常有效，不用搬。
- 回放执行的代码或依赖变了，仍逐个复现，不用探针集证明等价。探针只能证明它覆盖到的策略不变：11-04 有 2 个运行只因 Nautilus `EfficiencyRatio` 的数值变了而不一致，探针没用到这个指标就发现不了。
- 不改账本结构、市场身份、读数重封（L10）和验证。验证在绑定时要求当前 main 的检查过的构建（`require_fresh` 加 `require_main_build`），这一点不变。

## 3. 设计：只装回放代码的镜像

- **拆镜像。**
  - 回放镜像：基础镜像 + uv + `uv sync --frozen --no-dev` + `engine/__init__.py` + `RUNTIME_SOURCE_PATHS` 列出的文件 + `engine/audit.py`。它沿用 `ghcr.io/qoeop/trade-runtime`，研究的 `resolve`、`require_main_build` 不用改仓库名。
  - Paper 和 Live 用另一个执行镜像，它从回放镜像构建，再加其余 `engine/*.py` 和 redis。
- **只在回放输入变了时才构建。**
  - 回放镜像的 main 构建由路径过滤触发：闭包文件、`engine/__init__.py`、`engine/audit.py`、`uv.lock`、`pyproject.toml`、回放 Dockerfile、它自己的工作流。
  - 别的改动不触发构建，`:main` 就停在原来的摘要上，不需要人工改标签。
  - 镜像的 revision 标签是构建它的那次提交，它仍在 main 上，所以 `require_main_build` 仍按那次提交的 Git 内容逐字节核对，信任边界不变。
- **闭包完整由构建和测试双重保证。**
  - 回放镜像里只有列出的文件。漏一个文件，回放会因导入失败而拒绝，不会悄悄漏算。
  - 一个测试从入口 `engine.run`、`engine.audit`、`engine.compare` 静态算出导入闭包，要求它与 `RUNTIME_SOURCE_PATHS`、v8 的 `LAYOUTS` 源码路径、回放 Dockerfile 的 COPY 列表、工作流的路径过滤四者一致。
  - 策略源码由 `engine/load.py` 动态执行，只能导入标准库和 Nautilus（`_module_allowed`），两者都在基础镜像和锁文件里。
- **平台不变。** `:main` 仍是 arm64/amd64 两平台索引，存的仍是索引摘要，两平台的运行照旧可比。

## 4. 检查的变化

- 不放松任何拒绝：可比性、源码审查、落后判断、登记外键和验证都照旧按镜像摘要，代码不改。
- 收紧一处（需要用户授权）：主构建的源码证明多核对 `klines.py`、`native_csv.py`、`live_errors.py`、`engine/__init__.py` 四个文件。这既是修第 1 节的缺陷，也是回放镜像能跑起来的前提。

## 5. 比较过的方案

| 方案 | 结论 |
|---|---|
| 初稿：在 `trial` 加 `replay_identity` 列，可比性等改用它 | 不采用。评审指出三点：①身份由镜像里的代码自己算，PR 构建能改算法冒充 main 的身份，要防就得在主机上按 Git 重算，等于再造一遍 `require_main_build`；②登记侧没有这个身份，比较对登记会失效，要再加 `runtime_image` 表；③要放松三处拒绝、收紧平台区分，并且必须在建库前落地 |
| `runtime_contract` 加 CI 探针门 | 不采用：探针漏得掉 `EfficiencyRatio` 这类变化 |
| 只装回放代码的镜像（本文） | 采用：账本、信任边界、拒绝都不动；代价是多一个镜像要构建和部署 |

## 6. 评审与决定

- **独立评审（11-11，子代理，读了 #2599 d720e98ec、#2595 40f020fbc 和 main 上的工作流）：** 结论是"改后采用"。它对初稿提出两处阻断（信任边界、登记侧身份）、三处中等问题（漏掉的消费者、哈希不全、平台收紧未列出），并提出拆镜像这个替代方案。本文改用了该方案，初稿的问题因此不再适用。
- **用户：** 11-11 授权第 4 节的收紧（"Authorize"）：主构建的源码证明多核对那 4 个文件。

## 7. 实施落点

| 部分 | 分支 | 负责 |
|---|---|---|
| 回放 Dockerfile、执行镜像、两个工作流、闭包测试、`RUNTIME_SOURCE_PATHS` 与 v8 `LAYOUTS` 补全 | #2595（v8，草稿） | R1 |
| Paper、Live 改用执行镜像：`runtime/image.py` 的模块入口、`deploy/` 的镜像钉、`deploy/runtime_inputs.py` | #2595 | R1 |
| `changes.md` 里"换镜像后搬运行"的说法改为"回放镜像变了才搬" | 第 4 阶段 | 第 4 阶段 |

账本不动，不受"破坏性 PR 集中合"约束。但最好在新账本开研究前落地，免得首批运行在旧的合一镜像上，之后还要搬一次。
