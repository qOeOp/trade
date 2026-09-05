import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

const connectionString = process.env.DASHBOARD_DATABASE_URL;
if (!connectionString) throw new Error("DASHBOARD_DATABASE_URL is required");

const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrations = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (migrations.length === 0) throw new Error("RUN_STORE_MIGRATIONS_UNAVAILABLE");
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3_000 });
try {
  for (const migration of migrations) {
    await pool.query(await readFile(`${migrationDirectory}/${migration}`, "utf8"));
    process.stdout.write(`Dashboard RunStore migration ${migration.slice(0, 4)} applied\n`);
  }
} finally {
  await pool.end();
}
