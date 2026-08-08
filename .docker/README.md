# Docker development services

The Docker files in this directory support local builds and integration tests.

Start PostgreSQL, Redis, and the schema initialization from the repository root:

```bash
make init-services
```

The default local PostgreSQL credentials are user `vibe`, password `pass`, database `vibe`, port `5432`.

Run PostgreSQL-backed Python and Rust tests with:

```bash
make test-postgres
```

Start or stop the services without resetting data:

```bash
make start-services
make stop-services
```

Use `make purge-services` to remove the local service volumes.
