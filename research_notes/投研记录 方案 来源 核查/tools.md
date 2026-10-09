# 开源实验记录工具核查：MLflow Tracking 与 DVC Experiments（2026-10-08）

## 两种工具到底提供哪些可复用能力？

### Takeaway

MLflow Tracking 擅长对大量 **run** 做结构化记录、检索和产物读回；DVC Experiments 擅长以 Git 基线保存实验工作区、比较文件化指标及复现声明过依赖的流水线。二者的“父子”关系都不能直接当作投研的假设继承或合法经济对照。

### Cited Findings

| 能力 | MLflow Tracking | DVC Experiments |
| --- | --- | --- |
| 基本实体与关系 | `experiment` 分组 `run`；run 有 ID、时间、状态、参数、指标、标签和产物。`start_run(nested=True)` 或 `parent_run_id` 可建立父子 run，官方示例用于一轮调参下的多次 trial。[Tracking](https://mlflow.org/docs/latest/ml/tracking/)；[Python API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.html)；[子运行示例](https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/) | 实验为以当前 Git `HEAD` 为基线的自定义 Git refs，保存工作区变化；默认只在本地，不随普通 Git push 共享。表格可显示同一基线下的实验。[概览](https://doc.dvc.org/user-guide/experiment-management)；[比较](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments) |
| 参数、指标、证据 | 手动 API 记录参数、逐步指标、标签、数据集输入和单个／目录产物；可把原生 Nautilus 报告作为文件产物接入，但需要调用方显式记录。[Tracking API](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)；[Dataset API](https://mlflow.org/docs/latest/dataset/) | 从 YAML／JSON／CSV 等文件追踪和比较参数、指标、图表；大文件可由 DVC 缓存及 remote 保管，`.dvc`、`dvc.lock` 可记录文件哈希和流水线依赖。[概览](https://doc.dvc.org/user-guide/experiment-management)；[dvc.yaml 结构](https://doc.dvc.org/user-guide/project-structure/dvcyaml-files)；[远端存储](https://doc.dvc.org/user-guide/data-management/remote-storage) |
| Git 与精确源码 | 常规 run 可记录 `mlflow.source.git.commit`，但官方系统标签表只把它定义为 Git commit；这不足以表示同一提交上未提交文件的实际字节。MLflow Projects 可从指定 Git commit 运行，是另一个可选执行路径。[系统标签](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)；[Projects](https://mlflow.org/docs/latest/ml/projects/) | 实验 ref 保存跟踪范围内的代码／配置变化及其 Git 基线，比单独记 `HEAD` 更接近实际工作区；但官方明确：只有 Git 或 DVC 跟踪的文件进入实验，未跟踪文件无法恢复。[概览](https://doc.dvc.org/user-guide/experiment-management)；[运行](https://doc.dvc.org/user-guide/experiment-management/running-experiments) |
| 存储与查询 | 元数据 backend 与大文件 artifact store 分离。当前 server 默认 SQLite，也可指定文件 backend 或 PostgreSQL／MySQL；artifact store 可本地或对象存储。UI/API 可按参数、指标、标签、数据集、run 元数据过滤并排序；搜索语法不支持 `OR`。[Backend stores](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/)；[Tracking Server](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/)；[Search Runs](https://mlflow.org/docs/latest/ml/search/search-runs/) | 不需要实验元数据数据库／常驻服务；`dvc exp show` 可列参数、指标、依赖，`--all-commits` 跨基线，`--csv` 或 Python API 可导出；DVC remote 与 Git remote 分别处理大文件及实验 refs 的共享。[DVC 用户指南](https://doc.dvc.org/user-guide)；[比较](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments)；[远端存储](https://doc.dvc.org/user-guide/data-management/remote-storage) |
| 复现与接入成本 | Tracking API 本身记录事实；若要可执行复现，需另外封存源码／环境／输入，或把运行组织为 MLflow Project。接入现有脚本可先只加 API 记录，后续要运行共享 UI 才需要管理 server、backend 和 artifact store。[Tracking](https://mlflow.org/docs/latest/ml/tracking/)；[Projects](https://mlflow.org/docs/latest/ml/projects/)；[Tracking Server](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/) | 若用 `dvc exp run`，需声明 `dvc.yaml` 的命令、依赖、输出；变动依赖触发流水线重跑，还可排队／隔离。若不建流水线，可用 DVCLive 保存实验。要长期共享，还需显式 `dvc exp push` 与 `dvc push`；DVC 自己说明不具备高级执行监控、错误处理、恢复能力。[运行](https://doc.dvc.org/user-guide/experiment-management/running-experiments)；[概览](https://doc.dvc.org/user-guide/experiment-management)；[比较](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments)；[用户指南](https://doc.dvc.org/user-guide) |

### Inferences

- 对此项目的“数百次尝试后仍能按问题、机制、失败层级和证据等级找回研究”需求，MLflow 的查询与产物 UI 更贴近**运行索引**；DVC 更贴近**文件化实验快照和数据版本**。这是依据官方实体、搜索和 Git ref 模型作出的适配判断，不是实测吞吐／运维结论。
- 如果当前只要规范记录、Git 可审阅、少量 Agent 交接，先用 Git 中的结构化 manifest／Markdown、原生报告的不可变位置和摘要检索，是更小的系统边界。日后可把 run 事实投影到 MLflow；不要为了采用 DVC 而平行重建现有 Nautilus 回放脚本为另一套强制流水线。
- `run` 的父子或 DVC 的 Git 基线只表示执行组织／源码祖先。产品仍需单独保存 `hypothesis_parent`、`code_parent`、`control_run`、`fixes_run` 等**带类型的关系**；不能从工具默认关系推断研究意图。

### Gaps

- 未在此轮安装或试跑 MLflow／DVC，因此没有本仓库 Python 3.14 兼容性、数百 MB Nautilus 报告上传时间、SQLite 并发性能或 DVC 缓存占用的实测结论。
- 官方文档没有给出“从策略假设链自动判定独立资格”的现成契约；这必须由产品自身定义与执行。

## 如何映射到本项目、哪些职责不能交给工具？

### Takeaway

工具可承担存储与检索的机械部分；投研的因果叙述、运行时源码真实性、原生经济事实、可比性和独立资格都需要明确的项目契约。此阶段不宜因“选了工具”就新增交易或研究决策模块。

### Cited Findings

- MLflow 的官方父子 run 示例表达“调参事件 → 各 trial”，不是假设修正图；虽然标签和 run notes 可记录任意文本，它们的意义由写入方约定。[子运行示例](https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/)；[系统标签与备注](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)
- MLflow 的 dataset 输入可以保存 name、digest、source 等元数据；官方的 metadata-only dataset 示例明确可只记引用、不复制大数据。这适合索引 Catalog 身份，但 digest／source 的正确性和实际交易窗口覆盖仍须由调用方验证。[Dataset tracking](https://mlflow.org/docs/latest/dataset/)
- DVC 的 pipeline DAG 表示阶段依赖及输出，实验 ref 表示 Git 基线／工作区变化；它们没有官方内建的“假设延伸”“失败修复”“冻结对照”字段。若需要这些意义，应作为项目自己的记录键保存。[dvc.yaml 结构](https://doc.dvc.org/user-guide/project-structure/dvcyaml-files)；[实验概览](https://doc.dvc.org/user-guide/experiment-management)
- MLflow 和 DVC 均支持删除／移除实验记录；MLflow 的 run 标签／备注可更新，DVC 的 `exp remove` 可移除实验。因此单纯使用其中一个存储，并不能自动获得本项目要求的不可改写审计记录与保留期；须另有不可变回执、哈希与保管规则。[MLflow Python API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.html)；[DVC 比较与移除](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments)
- MLflow 的常规记录 API 是手动挂钩，自动记录主要列举 Scikit-learn、XGBoost、PyTorch 等集成；官方资料未列 Nautilus Trader 为自动记录集成。因此本项目的订单完整性、资金费、费用和账户结果必须由原生报告审计后写入，不能依赖自动记录推断。[Tracking API](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)；[Tracking](https://mlflow.org/docs/latest/ml/tracking/)

### Inferences

| 选项 | 此项目的合适用途 | 决策 |
| --- | --- | --- |
| Git + 结构化 manifest + 受管原生报告 | 冻结尝试、假设／源码／经济对照关系；保留原生事实地址和哈希 | **现在的基线**，先用样例验证检索及接管；没有独立服务成本。 |
| MLflow Tracking | 当跨 Agent 查询 run、筛选数百次结果、打开大报告成为实际瓶颈时，做只读／单向投影或轻量记录层 | **优先 PoC 候选**；显式写入项目字段，仍保留 Git 中的不可变研究契约。 |
| DVC Experiments | 需要将行情输入／大产物纳入 Git 相关版本管理，且现有流程愿意采用 `dvc.yaml` 或 DVCLive 时 | **按数据／文件复现需求再评估**；不作为默认的研究因果索引。 |

### Gaps

- 尚未核对本项目现有 Catalog 存储及报告目录的保留策略能否直接满足长期证据地址；选 MLflow 或 DVC 前需本地原型读回一个失败运行和一个配对回放。
- 未找到任一工具能自动证明“已暴露样本上的改善”具有独立前向效力；资格治理仍是另一个产品决策和证据边界。
