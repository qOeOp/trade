# Remote Paper 亚洲服务器候选与部署分工（2026-11-06）

用户确认：研究留本地，DoltHub发布研究成果，云端承担展示和长期执行；选择亚洲机房后再确认采购。域名www.vibe-trading.info，GitHub指定账号登录，每月服务器/磁盘/固定IP预算500元以内，先Paper、Live后接。欧洲Netcup 32GB候选不再推荐，未开通或付费。现有101.132.235.122是用户的2GB服务器，本轮未改动其服务或DNS。

## 资源边界先于规格

| 工作 | 目标位置与归属 |
|---|---|
| 研究Agent、回测、历史行情批量导入、研究账本写入 | 本地电脑；沿用CLI发布研究成果到DoltHub |
| 已发布研究结果的展示 | 云端IDE；取得可验证的研究版本，只读展示，不在访问页面时触发研究回放 |
| Paper、后续Live的长期执行 | 云端控制服务与Nautilus；固定策略源码/配置/镜像，原生账户、订单、日志与一致恢复原件留在执行端持久盘 |

这是职责分离，不要求第一天购买三台服务器。IDE与少量Paper可先共用一台主机，研究任务不占执行端资源。运行中账户与日志从执行服务读取，DoltHub研究发布不充当实时交易状态通道；本地电脑关机或研究发布延迟不应中断已启动策略。后续Live凭据和账户原件不进入公开研究账本。

本地默认deploy/compose.yaml仍保留一体化研发环境；新的remote overlay已改为research只读镜像与独立paper执行数据库，关闭云端研究聊天Agent和批量market-import。IDE同步按钮通过CLI验证并快进配置好的DoltHub研究源，现有运行的源码/镜像/账户保持固定；不是浏览器逐次直接查询DoltHub SQL API。具体存储评审、权限与恢复边界见[数据路径分离实现](remote-paper-data-split.zh.md)。

本地仍是研究发布的写入方，Paper库不设置研究origin；没有新增SQL字段或第二活动研究账本，没有切换现有活动目录。Paper生命周期控制器仍因现有CLI管理员操作而保留特权，不把业务数据路径分离宣称为抵挡控制器被攻破的隔离。

## 修正内存判断

此前把40GiB账本cap与每条Paper的4GiB cap相加作为选型依据，估算过大：**cap不是预留内存，也不是实际用量**。paper/runs.py把4g标为uncalibrated example。81GiB历史market目录是磁盘，不是RAM；云端不应预先复制整个本地研究缓存。

研究回放与批量导入移出后，内存主要取决于IDE查询/图表计算、研究读取路径、策略币种与频率、Nautilus行情/订单/成交缓存、私有Redis、检查点及并发峰值。等待期runner约68MiB的旧观测不能证明长期活跃容量；IDE/Dolt曾各超过1GiB也不能证明32GB必需。

先评估4 vCPU、8–16GB、约160–220GB SSD的亚洲主机。8GB是小规模Paper待验证起点，16GB提供余量，均不承诺6–20条或Live容量。先做1–4条及24–72小时验证，覆盖UTC日线/funding边界，观察RSS、可用内存、CPU、原生回调/检查点延迟和磁盘增长。现行4条上限不变；remote env的8g账本cap属旧一体化部署候选，不能照搬到8GB整机。

## 亚洲月付候选：公开价，尚非完整订单

核对日期2026-11-06；优先新加坡，东京备选。公共行情连通性须以实际出口验证，地区标签不构成交易所可用保证。不依赖首年优惠或长约。

| 候选 | 官方公开规格/价格 | 待核实 |
|---|---|---|
| 腾讯云Lighthouse General Linux，新加坡/东京 | 4核8GB、180GB SSD、35Mbps、5120GB月流量：USD36/月；4核16GB、220GB SSD、40Mbps、6144GB：USD54/月。[官方价格](https://www.tencentcloud.com/document/product/1103/47794) | 优先核对4核8GB；实际账户地域库存、CPU架构、税费/备份/流量与固定IPv4需计入完整账单。16GB作为余量选项，尚未获得含所有附加项的人民币报价 |
| 阿里云Simple Application Server，新加坡/东京候选 | 公开Linux价表2核8GB、160GB SSD、20Mbps、5TB：USD35/月。[官方价格](https://www.alibabacloud.com/en/product/swas/pricing) | 核数较少；该地域实际套餐待核实。默认一个公网IP，但到期后不能保留，不等同可迁移EIP。[官方FAQ](https://www.alibabacloud.com/help/en/simple-application-server/support/faq) |
| OCI A1 Flex，亚洲ARM候选 | 4 OCPU/16GB按USD0.01/OCPU小时、USD0.0015/GB小时，744小时且不计免费额度，计算费约USD47.62/月；未含盘/IP/税费/备份。[官方单价](https://www.oracle.com/cloud/compute/arm/) | 与现有ARM镜像方向相容，但具体region的shape/库存与完整费用须在账户核对，不保证免费额度或库存。[shape规则](https://docs.oracle.com/en-us/iaas/Content/Compute/References/computeshapes.htm) |

腾讯官方说明实例重启保留公网/私网IP和磁盘；不证明释放后保留或换绑。[重启说明](https://www.tencentcloud.com/document/product/1103/41557)。仍须分别验收域名入口和容器实际IPv4出口；若需释放实例后保留并迁移出口，选择明确支持EIP的方案。

当前产品CI和service Dockerfile只支持linux/arm64。常规x86主机须先完成amd64 CI构建、依赖核对和成对原生验证，不能在生产用QEMU。不能为了复用现有镜像而强行选欧洲大内存机器，也不因工程成本自动锁定OCI。

## 上线前剩余步骤

1. 数据分工已实现并隔离验证；新主机仍须验收真实公开源初次克隆、执行cache、备份与负载，不把本地一体化Compose原样迁入；不迁移现有run8或活动目录。
2. 核实亚洲候选真实月付完整账单，主机/磁盘/固定IP/必要备份及税费每月总额不超过500元；针对具体方案获采购确认后再开通。
3. 用实际架构镜像验证登录、幂等启动、持久停止、同run恢复、日志与控制服务重启，再依据负载定8GB或16GB。当前恢复要求原容器，跨机复制不能称为resume。
4. 注册专用GitHub OAuth App并确认允许名单；回调https://www.vibe-trading.info/oauth2/callback，私有secret文件仅认证容器可读。实际GitHub登录及ACME签发在新机验收后，再具体确认DNS和上线。

认证[#2211](https://github.com/qOeOp/trade/pull/2211)和控制/日志[#2212](https://github.com/qOeOp/trade/pull/2212)已合并：5项认证原生探针及隔离Dolt/CLI/HTTP/native runtime等待阶段流程通过；842项Python、82项前端和后续50项聚焦验证通过，最终控制PR的CI全绿。后续数据路径分离见上述实现记录；亚洲公网部署和Live仍未实施。
