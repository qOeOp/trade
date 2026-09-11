import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(
  new URL("../../rd-workbench/docker-compose.yml", import.meta.url),
  "utf8",
);

function serviceBlock(serviceName) {
  const marker = `  ${serviceName}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `${serviceName} service is missing`);
  const remainder = compose.slice(start + marker.length);
  const nextService = remainder.search(/^  [a-z0-9][a-z0-9-]*:\n/m);
  return remainder.slice(0, nextService === -1 ? undefined : nextService);
}

test("Dashboard image and migration are opt-in Compose services", () => {
  const migration = serviceBlock("dashboard-run-store-migrate");
  const dashboard = serviceBlock("dashboard-web");
  const worker = serviceBlock("dashboard-shadow-worker");
  const scheduler = serviceBlock("dashboard-shadow-scheduler");

  for (const block of [migration, dashboard, worker, scheduler]) {
    assert.match(block, /profiles: \["dashboard-preview"\]/);
    assert.match(block, /image: trade-dashboard:\$\{DASHBOARD_IMAGE_TAG:-preview\}/);
    assert.match(block, /DASHBOARD_DATABASE_URL: \$\{DASHBOARD_DATABASE_URL:-\}/);
  }

  assert.doesNotMatch(migration, /\n\s+build:/);
  assert.match(migration, /pull_policy: never/);
  assert.match(migration, /command: \["npm", "run", "run-store:migrate"\]/);
  assert.match(dashboard, /context: \.\./);
  assert.match(dashboard, /dockerfile: dashboard\/Dockerfile/);
  assert.match(dashboard, /dashboard-run-store-migrate:\n\s+condition: service_completed_successfully/);
  assert.match(dashboard, /127\.0\.0\.1:\$\{DASHBOARD_PORT:-3100\}:3100/);
  assert.match(dashboard, /RD_OWNER_API_URL: \$\{RD_OWNER_API_URL:-http:\/\/rd-owner-api:8080\}/);
  assert.match(dashboard, /read_only: true/);
  assert.match(dashboard, /cap_drop:\n\s+- ALL/);

  assert.match(worker, /command: \["npm", "run", "shadow-runtime", "--", "worker"\]/);
  assert.match(worker, /dashboard-run-store-migrate:\n\s+condition: service_completed_successfully/);
  assert.match(worker, /rd-owner-api:\n\s+condition: service_healthy/);
  assert.match(worker, /DASHBOARD_SHADOW_WORKER_TOKEN: \$\{DASHBOARD_SHADOW_WORKER_TOKEN:-\}/);
  assert.match(worker, /test -f \/tmp\/dashboard-shadow-worker\.ready/);
  assert.match(scheduler, /command: \["npm", "run", "shadow-runtime", "--", "scheduler"\]/);
  assert.match(scheduler, /DASHBOARD_SHADOW_SCHEDULES_JSON:/);
  assert.match(scheduler, /DASHBOARD_SCHEDULER_CAPABILITY_DIGEST:/);
  assert.match(scheduler, /test -f \/tmp\/dashboard-shadow-scheduler\.ready/);
  for (const block of [worker, scheduler]) {
    assert.match(block, /pull_policy: never/);
    assert.match(block, /read_only: true/);
    assert.match(block, /cap_drop:\n\s+- ALL/);
    assert.doesNotMatch(block, /ports:/);
  }
});

test("Artifact verified-directory reads use a dedicated GET-only Compose service", () => {
  const artifactRead = serviceBlock("rd-artifact-owner-read-api");
  const dashboard = serviceBlock("dashboard-web");

  assert.match(artifactRead, /profiles: \["dashboard-preview"\]/);
  assert.match(artifactRead, /strategy-factory-rd-artifact-read-api/);
  assert.match(artifactRead, /RD_ARTIFACT_OWNER_READ_DATABASE_URL:/);
  assert.match(artifactRead, /RD_ARTIFACT_OWNER_READ_API_TOKEN:/);
  assert.match(artifactRead, /expose:\n\s+- 8082/);
  assert.doesNotMatch(artifactRead, /ports:/);
  assert.match(artifactRead, /read_only: true/);
  assert.match(artifactRead, /cap_drop:\n\s+- ALL/);

  assert.match(dashboard, /rd-artifact-owner-read-api:\n\s+condition: service_healthy/);
  assert.match(
    dashboard,
    /RD_ARTIFACT_OWNER_READ_API_URL:[\s\S]*http:\/\/rd-artifact-owner-read-api:8082/,
  );
  assert.match(
    dashboard,
    /RD_ARTIFACT_OWNER_READ_API_TOKEN: \$\{RD_ARTIFACT_OWNER_READ_API_TOKEN:-\}/,
  );
});

test("Windmill remains independent of the opt-in Dashboard profile", () => {
  const server = serviceBlock("windmill-server");
  const worker = serviceBlock("windmill-worker");

  assert.doesNotMatch(server, /dashboard-(?:web|run-store-migrate|shadow-worker|shadow-scheduler)/);
  assert.doesNotMatch(worker, /dashboard-(?:web|run-store-migrate|shadow-worker|shadow-scheduler)/);
  assert.doesNotMatch(server, /profiles:/);
  assert.doesNotMatch(worker, /profiles:/);
  assert.match(server, /MODE: server/);
  assert.match(worker, /MODE: worker/);
});
