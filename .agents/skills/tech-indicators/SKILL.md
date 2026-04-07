---
name: tech-indicators
description: >-
  Use when the user wants technical analysis calculated from local OHLCV
  files. This skill reads manifest-driven OHLCV data and computes a full
  catalog of indicators plus support, resistance, trendlines, and invalidation.
---

# Tech Indicators

这个 skill 统一负责技术分析计算。

它不拉行情，不连接交易所。
它只读取本地 OHLCV 数据，然后输出：

- `freqtrade/technical` 指标目录里的已接入指标
- 我们自己的支撑位 / 压力位 / 趋势线 / 失效位
- JSON 与 Markdown 摘要

## 接受什么数据

这个 skill 的输入是 `ohlcv-fetch` 产出的 `manifest.json`。

每个 timeframe 对应一个本地 CSV，至少要有这些字段：

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`

## 产生什么输出

脚本会写入传入的 `--output-dir`：

- `analysis.json`
- `summary.md`
- `selected-indicators.json`

其中：

- `analysis.json` 是完整结果
- `summary.md` 是面向阅读的摘要
- `selected-indicators.json` 是本次实际执行的指标目录与参数

## 运行方式

推荐直接通过当前目录下的 `run.sh` 执行：

```bash
cd .agents/skills/tech-indicators
./run.sh --help
```

它会在当前 skill 目录下创建并复用 `.venv`。
只有首次运行或 `requirements.txt` 变化时才会安装依赖，不需要每次触发都重装。

## 用法

默认执行全部已接入指标：

```bash
cd .agents/skills/tech-indicators
export RUN_ROOT=../../data/runs
./run.sh --manifest "$RUN_ROOT/20260406-eth-ohlcv/manifest.json" --output-dir "$RUN_ROOT/20260406-eth-tech"
```

只执行一部分指标：

```bash
cd .agents/skills/tech-indicators
export RUN_ROOT=../../data/runs
./run.sh --manifest "$RUN_ROOT/20260406-eth-ohlcv/manifest.json" --output-dir "$RUN_ROOT/20260406-eth-tech" --indicators ema,sma,vwma,ichimoku
```

使用自定义参数：

```bash
cd .agents/skills/tech-indicators
export RUN_ROOT=../../data/runs
./run.sh --manifest "$RUN_ROOT/20260406-eth-ohlcv/manifest.json" --output-dir "$RUN_ROOT/20260406-eth-tech" --indicator-config "$RUN_ROOT/20260406-eth-tech-config.json"
```

`indicator-config` 是一个 JSON 对象，key 是指标名，value 是参数覆盖。例如：

```json
{
  "ema": { "period": 50 },
  "bollinger_bands": { "period": 20, "stdv": 2 },
  "ichimoku": { "conversion_line_period": 12, "base_line_periods": 30 }
}
```

## 指标说明

完整指标目录、默认参数、含义与观测重点见：

- `INDICATORS.md`
- `indicator_catalog.json`

## 说明

- 默认会执行 catalog 中全部已接入指标
- 默认 `all` 会跳过当前已知依赖未闭合的指标：`supertrend`、`pivots_points`
- 每个指标独立执行并独立容错
- 某个指标缺少额外依赖或当前安装版本没有该实现时，只会记录该指标错误，不会中断整次分析
- 某个指标失败不会中断整次分析，错误会写进 `analysis.json`
- `--manifest`、`--output-dir`、`--indicator-config` 都可以使用环境变量或 agent 拼好的相对路径
- `manifest` 中的 OHLCV 文件路径可以是相对路径，脚本会相对 `manifest.json` 所在目录解析
- 支撑压力位和趋势线仍然保留我们自己的计算口径
