# L2 Recorder Bake-off Contract

P0-only evidence module for selecting the runtime language of the future public L2 data plane.

## Owns

- Frozen Binance Futures depth fixtures and their expected projection verdicts.
- Equivalent Bun, Go, and Rust fixture recorder/projector implementations.
- Reproducible local benchmark evidence for the language adoption ADR.

## Boundaries

- Connects only when the operator explicitly runs `capture --yes-public-network`; only the routed Binance public depth stream and public REST snapshot are allowed.
- Never reads API keys, account state, private/user-data streams, or write endpoints.
- Does not write market-data owner stores, manifests, artifacts, or live facts.
- Does not publish signals, place orders, or become a runtime dependency.
- Benchmark results are evidence, not an automatic language decision.
- Rust soak also requires `--yes-public-network`; it uses a bounded receiver queue and bounded book-level cap, and writes only below the requested ignored output base.
- The Bun supervisor may own Rust process lifecycle and evidence orchestration, but never parses books or writes market-data owner stores. It signals only the exact child PID it created.
- Detached launches publish an immutable terminal-state sidecar; status reports `failed` immediately when the supervisor exits without passing evidence instead of inferring activity from recently written segment files.
- The natural-soak default combined book cap is 100,000 levels. A configured capacity breach remains a hard, explicit failure and may only resume in a fresh epoch.

## Raw segment protocol

- Header: `TL2S` magic + unsigned big-endian `version=1` + `flags=0` (8 bytes).
- Frame: unsigned big-endian `payload_length` + IEEE CRC32 + exact payload bytes.
- Maximum payload is 16 MiB; zero-length payloads are rejected.
- Finalize writes a unique partial file, syncs it, then atomically renames it.
- Recovery accepts only the checksum-valid prefix and reports the first invalid/truncated frame; it never invents bytes.
- `delay-ms` and `sync-every-frames` are fault-injection controls only; normal writes keep both at zero.
- Soak frames use `trade.l2-raw-depth-frame.v1`: exact WebSocket text plus local receive time. Each connection has its own immutable REST snapshot and stream epoch.
- Snapshot bridge miss, live `pu` gap, queue overflow, socket close and capacity breach are distinct outcomes. Only a fresh epoch may resume after discontinuity.

## Contract

- Input: `trade.l2-bakeoff-fixture.v1` JSON.
- Output: `trade.l2-bakeoff-result.v1` JSON on stdout.
- Any sequence break returns `incomplete` and the last valid book; it must not be repaired silently.
- All prices and quantities are normalized decimal strings before hashing.

## Commands

- `bun run test`
- `bun run capture -- --yes-public-network --symbol BTCUSDT --events 200 --output tmp/l2-recorder-bakeoff/live-btcusdt.json`
- `bun run benchmark -- --iterations 10000 --output <ignored-json-path>`
- `go test ./...`
- `cargo test`
- `bun run segment-benchmark -- --fixture ../../../tmp/l2-recorder-bakeoff/live-btcusdt.json --samples 5`
- `bun run crash-injection -- --fixture ../../../tmp/l2-recorder-bakeoff/live-btcusdt.json --output tmp/l2-recorder-bakeoff/crash-evidence.json`
- `bun run soak:rust -- --yes-public-network --symbol BTCUSDT --duration-seconds 60 --output-base ../../../tmp/l2-recorder-bakeoff/soak-rust`
- `bun run soak:supervisor -- --yes-public-network --symbol BTCUSDT --cycles 3 --output tmp/l2-recorder-bakeoff/soak-supervisor-evidence.json`
- `bun run soak:natural -- --yes-public-network --symbol BTCUSDT --duration-seconds 3600 --output tmp/l2-recorder-bakeoff/natural-soak-evidence.json`
- `bun run soak:natural:launch -- --yes-public-network --symbol BTCUSDT --duration-seconds 3600 --output tmp/l2-recorder-bakeoff/natural-soak-evidence.json`
- `bun run soak:natural:status -- --receipt tmp/l2-recorder-bakeoff/natural-soak-launch/<run>/launch-receipt.json`
- `bun run adoption-input -- --natural-soak tmp/l2-recorder-bakeoff/natural-soak-evidence.json --output tmp/l2-recorder-bakeoff/adoption-input.json`
