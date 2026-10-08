# R1 research archive

This directory preserves experiment records, source checks, result artifacts and historical analysis scripts from the local Nautilus fork. It is evidence for ongoing research, not the supported replay implementation. Some Python scripts import the removed `vibe_trading` package and cannot be run on the minimal architecture as written.

Use `strategies/r1/` for current Strategy source and native shared-account replay. When a historical diagnostic is needed, port its question to the published `nautilus_trader` API and record the new result without overwriting the prior experiment. Preserve `RD_EXPERIMENTS.md`, `SOURCE_CASES.md`, result identities and provenance. Put durable product/process findings in `docs/plans/r1-native-rd-findings.zh.md`.
