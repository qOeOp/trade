// `next dev` with an owner.
//
// Five orphaned dev servers were found on this machine, the oldest four days old, each still
// holding port 3100 and each reparented to init. They were started by hand as `next dev`, their
// parent shell went away, and nothing was left that knew they existed. A signal handler alone does
// not close this: the parent died without passing a signal on, which is exactly why the children
// survived. So this does two things, and the second is the one that works when the first cannot
// run at all.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcess } from "../tests/browser-acceptance.mjs";

// Imported rather than copied. `browser-acceptance.mjs` says four copies of that teardown already
// exist and have drifted from each other before; a fifth written here would drift too, and this
// one would be the copy nobody runs in CI.

const dashboardRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nextBin = join(dashboardRoot, "node_modules", "next", "dist", "bin", "next");

// Keyed by worktree, because several worktrees of this repository run their own preview and a
// shared name would make each one reap the others.
const recordPath = join(tmpdir(),
  `dashboard-local-preview-${createHash("sha256").update(dashboardRoot).digest("hex").slice(0, 16)}.json`);

// A process id alone is not an identity: the id is reused, and the record outlives the process it
// names. `ps -o lstart=` pins the identity to a specific start instant, so a reaped id has to be
// both alive and the same process that was recorded.
function startedAt(pid) {
  const probe = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  return probe.status === 0 ? probe.stdout.trim() : null;
}

export function reapPredecessor(path = recordPath) {
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return "no-record"; // No record, or an unreadable one. Nothing here can be reaped safely.
  }
  if (!Number.isInteger(record?.pid) || typeof record?.startedAt !== "string") return "no-record";
  if (startedAt(record.pid) !== record.startedAt) {
    // Either it exited, or that id now names something else. Both mean there is nothing of ours
    // to stop, and the second means signalling would reach a stranger.
    rmSync(path, { force: true });
    return "identity-mismatch";
  }
  process.stderr.write(`local preview: stopping the previous server, pid ${record.pid}\n`);
  try {
    process.kill(-record.pid, "SIGTERM");
  } catch {
    try { process.kill(record.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  rmSync(path, { force: true });
  return "stopped";
}

export { recordPath, startedAt };

// Only when run as the preview, not when a test imports the reaper above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreview();
}

function runPreview() {

// This is the half that survives losing the parent. A session that is killed takes every handler
// below with it, and then the only thing left that can clean up is the next run.
reapPredecessor();

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  cwd: dashboardRoot,
  stdio: ["ignore", "inherit", "inherit"],
  detached: true, // Its own process group, so the teardown can address the tree rather than the top of it.
});

writeFileSync(recordPath, JSON.stringify({ pid: child.pid, startedAt: startedAt(child.pid) }));

let stopping = false;
async function stop(reason) {
  if (stopping) return;
  stopping = true;
  process.stderr.write(`local preview: stopping (${reason})\n`);
  await stopProcess(child, "local preview", { group: true });
  rmSync(recordPath, { force: true });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { stop(signal).then(() => process.exit(0)); });
}
child.on("exit", (code, signal) => {
  rmSync(recordPath, { force: true });
  process.exit(signal ? 1 : (code ?? 0));
});
}
