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

## Boundaries

- No domain workflow.
- No cycle scheduling or job graph ownership.
- No exchange access.
- No strategy research or execution decisions.
