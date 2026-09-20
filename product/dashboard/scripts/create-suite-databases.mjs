// Creates the control databases the Dashboard PostgreSQL suites derive their disposable databases
// from. Each suite only ever CREATEs a fresh random database next to its control database and drops
// it again; nothing is migrated or written into the databases created here.
//
// Usage: DASHBOARD_SUITE_POSTGRES=postgresql://user:pass@127.0.0.1:5432 node scripts/create-suite-databases.mjs

import pg from "pg";

const CONTROL_DATABASES = [
  "dashboard_run_store",
  "dashboard_audit",
  "dashboard_runs",
  "dashboard_shadow_runtime",
  "dashboard_workers",
  "dashboard_calendar",
  "dashboard_service_logs",
];

const base = process.env.DASHBOARD_SUITE_POSTGRES;
if (!base) {
  console.error("DASHBOARD_SUITE_POSTGRES must name the PostgreSQL server the suites may create databases on");
  process.exit(2);
}
const admin = new URL(base);
if (admin.hostname !== "127.0.0.1") {
  console.error("DASHBOARD_SUITE_POSTGRES must point at a loopback server; the suites are destructive");
  process.exit(2);
}
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.href });
await client.connect();
try {
  for (const name of CONTROL_DATABASES) {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    console.log(`${name}: ${existing.rowCount === 0 ? "created" : "present"}`);
  }
} finally {
  await client.end();
}
