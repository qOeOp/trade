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

## Raw segment protocol

- Header: `TL2S` magic + unsigned big-endian `version=1` + `flags=0` (8 bytes).
- Frame: unsigned big-endian `payload_length` + IEEE CRC32 + exact payload bytes.
- Maximum payload is 16 MiB; zero-length payloads are rejected.
- Finalize writes a unique partial file, syncs it, then atomically renames it.
- Recovery accepts only the checksum-valid prefix and reports the first invalid/truncated frame; it never invents bytes.

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
