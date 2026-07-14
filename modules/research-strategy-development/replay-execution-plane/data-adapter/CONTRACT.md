# Replay Data Adapter

Owns normalized Replay input admission: manifest/ref/content-hash binding, RFC 3339 UTC and OHLC invariants, instrument lifecycle, point-in-time universe declaration, closed-bar grid/gap detection, exact funding-event ordering, executable-window selection and evidence-window slicing.

It consumes immutable data already selected by Control Plane governance. Invalid identity, future availability, pre-listing/post-delisting facts and hash drift are rejected; admissible grid gaps, incomplete instrument history and survivor-only universes become Result limitations. It does not choose datasets, repair gaps silently, generate signals, match orders, or make review decisions.
