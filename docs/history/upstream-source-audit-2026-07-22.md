---
title: Upstream Source Audit 2026-07-22
role: historical-research
status: completed-historical
owner: architecture
last_verified: 2026-07-23 CST
---

# Upstream Source Audit 2026-07-22

一次性源码审查已完成；本记录只保留可重取指纹，不定义当前架构。吸收后的当前结论在 [Design Architecture](../architecture/design-architecture.md)、[Server Runtime Implementation](../architecture/migrations/server-runtime-implementation-plan.md)、[R&D Strategy Universe](../research/strategy/rd-strategy-universe-design.md) 与 owner `CONTRACT.md`。

| Source | Frozen commit |
| --- | --- |
| `kernc/backtesting.py` | `cadcbe22fc2abe426256634fa946a48326b96c8e` |
| `mementum/backtrader` | `b853d7c90b6721476eb5a5ea3135224e33db1f14` |
| `freqtrade/freqtrade` | `69fc8483500ebfbeb27b7aadb4605196b46c0eb0` |
| `jesse-ai/jesse` | `fa63531cae6c09b978711dc1892285067304e2df` |
| `QuantConnect/Lean` | `153d0b7427a918063a018ec18964ddf450edc125` |
| `nautechsystems/nautilus_trader` | `39bbb228815ee170f484210f4fa0cf3b5821c524` |
| `NoFxAiOS/nofx` | `39eac5aca745266b6d4f2b75e8fc75fd5a71ed98` |
| `microsoft/qlib` | `d5379c520f66a39953bad76234a7019a72796fd0` |
| `LLMQuant/quant-mind` | `27a08e6e21bfdc14b92d2de9a499b3ee41ffddab` |
| `brokermr810/QuantDinger` | `7250471edd17569d7d6a4bcbed2700306c319cba` |
| `microsoft/RD-Agent` | `4f9ecb005881cddc08df0124a2e894c018007679` |
| `polakowo/vectorbt` | `f9897528f675114e6b34790178dbb2ca137acb51` |

共同吸收的是 deterministic engine / evidence、事件驱动与 owner state、策略生命周期、隔离研发、数据 lineage、risk clamp、fail-closed recovery 和 Agent / code / tool 分层。没有复制平台 UI、多用户、多交易所、模型直控交易、框架式策略 API 或第二套 domain authority。完整 clones 位于 ignored `tmp/`，审查后是可重取 cache；不属于行情、Trial、Result、策略或 incident evidence。
