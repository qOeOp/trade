# Replay Trial Runner

Owns Trial-scoped Replay orchestration, Attempt authority validation, attempt-local idempotency, cooperative cancellation, resumable checkpoint handoff, typed failure, and durable Result Artifact commit.

Artifact Manifest v32 is the success commit marker. Runner 生成 Decision Evidence Timeline v8、Boundary v7、Market/State Snapshot v3 与 attested Harness evidence；Result v30/Fingerprint/Checkpoint v14 同时绑定这些 authority 以及 partial Order/Fill/current protection。Run Outcome v27 在 Engine/发布前保留 typed authority、storage、Harness failure；只有 completed 可以携带 Result/Artifact。

Step Engine may emit Checkpoint v14 only after a complete source-event boundary. Runner durably publishes the Attempt/lease-generation/source-offset-bound payload and Diagnostic Checkpoint Commit v2, then hands the descriptor to external Control Plane coordination; Runner never writes Control Plane state. Cooperative cancel returns no Result/Artifact. Resume requires Control Plane Resume Authorization v1 and revalidates authority、storage、Timeline、source prefix、partial Fill 与 rebuilt protection；clean/resume Result hash 必须一致。Local CAS 已认证，remote adapter 尚未认证。

If the simulated full close leaves negative isolated collateral, Runner returns typed `liquidation-deficit-unsupported` with the breached snapshot, trigger observation, and `remaining_collateral`; it publishes neither Result nor Artifact and never invents insurance-fund, bankruptcy-price, or ADL facts.

An open position reaching manifest-bound delisting returns `instrument-delisted-with-open-position`, carries the phase-`00` terminal EventKey, is non-retryable, and commits no partial Result. A settlement price requires a separately frozen data contract; Runner does not synthesize one.
