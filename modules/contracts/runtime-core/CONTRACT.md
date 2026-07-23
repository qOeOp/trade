# contracts/runtime-core

## Type

contract module

## Owns

- JSON record helpers.
- Canonical JSON serialization and SHA-256 hashing shared by cross-domain wire contracts.
- Repository-relative path resolution and runtime path guard.
- Lifecycle processor spec / record helpers shared by control tower and domain runtime integrations.
- Owner tool registry resolver for `toolset.json` entries.
- UTC timestamp helper.
- Shared fail-closed CLI JSON / flag parsing and response printing.
- Normalized subprocess tool result envelope for orchestrators.
- Foreground child signal forwarding and drain semantics for external process-manager entrypoints.
- Database environment resolution: stable local roots, isolated test/CI instances, and explicit runtime roots. Environment selection carries no exchange-write authority.
- Shared test DB lifecycle creates unique OS-temp data/tmp roots, owns an open-handle registry, checkpoints WAL, and recursively removes DB/WAL/SHM on idempotent cleanup.
- Database identity binds environment/store/instance before owner schema or domain writes. Empty DB can initialize; non-empty legacy DB requires an explicit owner migration; missing or mismatched identity otherwise fails closed.

## Boundaries

- No domain workflow.
- No cycle scheduling or job graph ownership.
- No exchange access.
- No strategy research or execution decisions.
- Store database names are lowercase basenames and cannot escape the selected environment data root.
