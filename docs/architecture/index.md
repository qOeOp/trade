# Architecture Boundaries

The global map contains ten authority Owners and three visible boundaries. The boundaries make the product understandable without creating another writer for trading truth.

## Authority rule

Each mutable business fact has one Owner. Product Edge, Strategy Factory, and Observability may present, coordinate, or isolate facts, but they never become a second business authority. R&D is one real Owner containing Research and Develop capabilities. Event Rail transports committed wake hints as a separate channel.

## Visible boundaries

- [Product Edge](./product-edge/) is the Windmill-first application and MCP admission boundary.
- [Strategy Factory](./strategy-factory/) is the R&D Backtest Qualification value stream.
- [Observability](./observability/) collects telemetry, builds global status projections, and routes alerts.

## Channel

[Event Rail](./event-rail/) broadcasts committed events. It is a transport channel rather than a boundary or business authority.

## Reading the map

Owner borders show responsibility. Directed lines show typed handoffs. Scenario tabs hide unrelated paths without changing the underlying architecture. Node descriptions state capability boundaries rather than implementation classes or APIs.

## Implementation adoption

[Capability Adoption](./capability-adoption/) maps every existing workspace crate and supporting capability to its destination Owner or non-authoritative infrastructure. It records reuse and migration boundaries without adding another box to the global map.

## Freeze condition

Adding an Owner requires proving a new independent business authority. Adding a module requires proving it cannot fit an existing responsibility. The overview remains limited to thirteen visible groups and five modules per group.
