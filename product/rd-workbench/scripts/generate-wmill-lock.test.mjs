import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { spawnSync } from "node:child_process";

import {
  buildWorkspaceLock,
  WINDMILL_CLI_REHASH_GRAMMAR,
} from "./generate-wmill-lock.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(testDirectory, "..");
const generator = join(testDirectory, "generate-wmill-lock.mjs");
const temporaryRoots = [];

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function temporaryWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "wmill-lock-generator-test-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "f", "trade"), { recursive: true });
  await writeFile(
    join(root, "wmill.yaml"),
    "defaultTs: bun\nincludes:\n  - f/trade/**\nexcludes: []\n",
  );
  return root;
}

async function put(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("sorts canonical paths and hashes exact script and raw-app bytes", async () => {
  const root = await temporaryWorkspace();
  const betaSource = "export async function main() { return 2; }\n";
  const betaMetadata = "summary: beta\n";
  const alphaSource = "def main():\n    return 1\n";
  const alphaMetadata = "summary: alpha\n";
  await put(root, "f/trade/z/beta.ts", betaSource);
  await put(root, "f/trade/z/beta.script.yaml", betaMetadata);
  await put(root, "f/trade/a/alpha.py", alphaSource);
  await put(root, "f/trade/a/alpha.script.yaml", alphaMetadata);
  await put(root, "f/trade/app.raw_app/raw_app.yaml", "summary: app\n");

  const expected = [
    "version: v2",
    "locks:",
    `  f/trade/a/alpha: ${hash(`{}${alphaSource}${alphaMetadata}`)}`,
    `  f/trade/app.raw_app+__app_hash: ${hash("{}")}`,
    `  f/trade/z/beta: ${hash(`{}${betaSource}${betaMetadata}`)}`,
    "",
  ].join("\n");

  assert.equal(await buildWorkspaceLock(root), expected);
  assert.equal(await buildWorkspaceLock(root), expected);
});

test("rejects an ambiguous script stem with multiple source files", async () => {
  const root = await temporaryWorkspace();
  await put(root, "f/trade/ambiguous.script.yaml", "summary: ambiguous\n");
  await put(root, "f/trade/ambiguous.ts", "export function main() {}\n");
  await put(root, "f/trade/ambiguous.py", "def main():\n    pass\n");

  await assert.rejects(buildWorkspaceLock(root), /duplicate or ambiguous Windmill lock path/);
});

test("rejects a script source without canonical metadata", async () => {
  const root = await temporaryWorkspace();
  await put(root, "f/trade/orphan.ts", "export function main() {}\n");

  await assert.rejects(
    buildWorkspaceLock(root),
    /f\/trade\/orphan must have exactly one canonical metadata file; found 0/,
  );
});

test("uses Windmill's first-dot key grammar for dotted script names", async () => {
  const root = await temporaryWorkspace();
  const source = "export function main() { return 'dotted'; }\n";
  const metadata = "summary: dotted\n";
  await put(root, "f/trade/dotted.name.ts", source);
  await put(root, "f/trade/dotted.script.yaml", metadata);

  assert.equal(
    await buildWorkspaceLock(root),
    [
      "version: v2",
      "locks:",
      `  f/trade/dotted: ${hash(`{}${source}${metadata}`)}`,
      "",
    ].join("\n"),
  );
});

test("rejects metadata named from a dotted source instead of its canonical key", async () => {
  const root = await temporaryWorkspace();
  await put(root, "f/trade/dotted.name.ts", "export function main() {}\n");
  await put(root, "f/trade/dotted.name.script.yaml", "summary: dotted\n");

  await assert.rejects(
    buildWorkspaceLock(root),
    /f\/trade\/dotted must have exactly one canonical metadata file; found 0/,
  );
});

test("includes scripts beneath an in-scope dist directory", async () => {
  const root = await temporaryWorkspace();
  const source = "export function main() { return 'dist'; }\n";
  const metadata = "summary: dist\n";
  await put(root, "f/trade/dist/hidden.ts", source);
  await put(root, "f/trade/dist/hidden.script.yaml", metadata);

  assert.equal(
    await buildWorkspaceLock(root),
    [
      "version: v2",
      "locks:",
      `  f/trade/dist/hidden: ${hash(`{}${source}${metadata}`)}`,
      "",
    ].join("\n"),
  );
});

test("matches the CLI exclusion of nested git and node_modules directories", async () => {
  const root = await temporaryWorkspace();
  for (const directory of [".git", "node_modules"]) {
    await put(root, `f/trade/${directory}/hidden.ts`, "export function main() {}\n");
    await put(root, `f/trade/${directory}/hidden.script.yaml`, "summary: hidden\n");
  }

  assert.equal(await buildWorkspaceLock(root), "version: v2\nlocks: {}\n");
});

test("covers every pinned CLI script extension and rejects ambiguous bare SQL", async () => {
  const root = await temporaryWorkspace();
  const expected = [];
  const supported = WINDMILL_CLI_REHASH_GRAMMAR.sourceExtensions.filter(
    (suffix) => suffix !== ".sql",
  );
  for (const [index, suffix] of supported.entries()) {
    const stem = `kind_${String(index).padStart(2, "0")}`;
    const source = `# ${suffix}\n`;
    const metadata = `summary: ${stem}\n`;
    await put(root, `f/trade/${stem}${suffix}`, source);
    await put(root, `f/trade/${stem}.script.yaml`, metadata);
    expected.push(`  f/trade/${stem}: ${hash(`{}${source}${metadata}`)}`);
  }

  assert.equal(
    await buildWorkspaceLock(root),
    ["version: v2", "locks:", ...expected, ""].join("\n"),
  );

  await put(root, "f/trade/ambiguous.sql", "select 1;\n");
  await put(root, "f/trade/ambiguous.script.yaml", "summary: ambiguous\n");
  await assert.rejects(buildWorkspaceLock(root), /ambiguous bare SQL script extension/);
});

test("table-drives every rehash resource kind and marker variant", async (context) => {
  const cases = [
    { kind: "flow-yaml", folder: "sample.flow", marker: "flow.yaml", top: "__flow_hash" },
    { kind: "app", folder: "sample.app", marker: "app.yaml", top: "__app_hash" },
    {
      kind: "raw-app",
      folder: "sample.raw_app",
      marker: "raw_app.yaml",
      top: "__app_hash",
      runnableDirectory: "backend",
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.kind, async () => {
      const root = await temporaryWorkspace();
      const source = "export function main() { return true; }\n";
      await put(root, `f/trade/${fixture.folder}/${fixture.marker}`, "{}\n");
      const runnable = [
        "f/trade",
        fixture.folder,
        fixture.runnableDirectory,
        "run.ts",
      ].filter(Boolean).join("/");
      await put(root, runnable, source);
      const resourcePath = `f/trade/${fixture.folder}`;
      const fileHash = hash(`${source}{}`);
      assert.equal(
        await buildWorkspaceLock(root),
        [
          "version: v2",
          "locks:",
          `  ${resourcePath}+${fixture.top}: ${hash(JSON.stringify({ "run.ts": fileHash }))}`,
          `  ${resourcePath}+run.ts: ${fileHash}`,
          "",
        ].join("\n"),
      );
    });
  }
});

test("table-drives internal-directory exclusions and fail-closed layouts", async (context) => {
  for (const directory of [".claude", ".git", ".hidden", "node_modules"]) {
    await context.test(`excludes ${directory}`, async () => {
      const root = await temporaryWorkspace();
      await put(root, `f/trade/${directory}/hidden.ts`, "export function main() {}\n");
      await put(root, `f/trade/${directory}/hidden.script.yaml`, "summary: hidden\n");
      assert.equal(await buildWorkspaceLock(root), "version: v2\nlocks: {}\n");
    });
  }

  for (const fixture of [
    { path: "f/trade/refuting__mod/script.ts", pattern: /script module layout/ },
    { path: "f/trade/refuting__dbt/wm_dbt.yaml", pattern: /script module layout/ },
    { path: "f/trade/refuting__flow/flow.yaml", pattern: /non-dotted Windmill resource layout/ },
    { path: "f/trade/refuting.flow/flow.json", pattern: /unknown Windmill resource marker/ },
  ]) {
    await context.test(`rejects ${fixture.path}`, async () => {
      const root = await temporaryWorkspace();
      await put(root, fixture.path, "{}\n");
      await assert.rejects(buildWorkspaceLock(root), fixture.pattern);
    });
  }
});

test("rejects a symbolic-link projection ancestor without writing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "wmill-lock-symlink-root-"));
  const outside = await mkdtemp(join(tmpdir(), "wmill-lock-symlink-outside-"));
  temporaryRoots.push(root, outside);
  await writeFile(
    join(root, "wmill.yaml"),
    "defaultTs: bun\nincludes:\n  - f/trade/**\nexcludes: []\n",
  );
  await put(outside, "trade/escaped.ts", "export function main() {}\n");
  await put(outside, "trade/escaped.script.yaml", "summary: escaped\n");
  await symlink(outside, join(root, "f"));
  const output = join(root, "generated.yaml");

  const result = spawnSync(
    process.execPath,
    [generator, "--workspace", root, "--output", output],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Windmill projection has a symbolic-link ancestor/);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test(
  "matches the content-addressed official rehash on the complete mixed corpus",
  {
    skip:
      process.env.WINDMILL_CLI === undefined ||
      process.env.WINDMILL_CLI_BUNDLE === undefined,
  },
  async () => {
    const cliBundle = await readFile(process.env.WINDMILL_CLI_BUNDLE);
    assert.equal(hash(cliBundle), WINDMILL_CLI_REHASH_GRAMMAR.bundleSha256);

    const root = await temporaryWorkspace();
    const supported = WINDMILL_CLI_REHASH_GRAMMAR.sourceExtensions.filter(
      (suffix) => suffix !== ".sql",
    );
    for (const [index, suffix] of supported.entries()) {
      const stem = `kind_${String(index).padStart(2, "0")}`;
      await put(root, `f/trade/scripts/${stem}${suffix}`, `# ${suffix}\n`);
      await put(root, `f/trade/scripts/${stem}.script.yaml`, `summary: ${stem}\n`);
    }
    await put(root, "f/trade/dotted.name.ts", "export function main() {}\n");
    await put(root, "f/trade/dotted.script.yaml", "summary: dotted\n");
    await put(root, "f/trade/dist/admitted.ts", "export function main() {}\n");
    await put(root, "f/trade/dist/admitted.script.yaml", "summary: dist\n");

    await put(root, "f/trade/mixed.flow/flow.yaml", "{}\n");
    await put(root, "f/trade/mixed.flow/inline.ts", "export function main() {}\n");
    await put(root, "f/trade/mixed.flow/inline.script.yaml", "summary: internal\n");
    await put(root, "f/trade/mixed.flow/nested/ignored.ts", "ignored nested runnable\n");
    await put(root, "f/trade/mixed.app/app.yaml", "{}\n");
    await put(root, "f/trade/mixed.app/run.py", "def main():\n    return True\n");
    await put(root, "f/trade/mixed.app/nested/ignored.ts", "ignored nested runnable\n");
    await put(root, "f/trade/mixed.raw_app/raw_app.yaml", "{}\n");
    await put(root, "f/trade/mixed.raw_app/backend/query.sql", "select 1;\n");
    await put(
      root,
      "f/trade/mixed.raw_app/backend/nested/ignored.ts",
      "ignored nested runnable\n",
    );
    await put(root, "f/trade/mixed.raw_app/frontend.ts", "ignored by raw-app rehash\n");

    for (const directory of [".claude", ".git", ".hidden", "node_modules"]) {
      await put(root, `f/trade/${directory}/ignored.ts`, "export function main() {}\n");
      await put(root, `f/trade/${directory}/ignored.script.yaml`, "summary: ignored\n");
    }

    const generated = await buildWorkspaceLock(root);
    await writeFile(join(root, "wmill-lock.yaml"), "version: v2\nlocks: {}\n");
    const result = spawnSync(process.env.WINDMILL_CLI, ["generate-metadata", "rehash"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(join(root, "wmill-lock.yaml"), "utf8"), generated);

    const currentCopy = await mkdtemp(join(tmpdir(), "wmill-lock-current-tree-oracle-"));
    temporaryRoots.push(currentCopy);
    await cp(workspace, currentCopy, { recursive: true });
    const currentGenerated = await buildWorkspaceLock(currentCopy);
    await writeFile(join(currentCopy, "wmill-lock.yaml"), "version: v2\nlocks: {}\n");
    const currentResult = spawnSync(
      process.env.WINDMILL_CLI,
      ["generate-metadata", "rehash"],
      { cwd: currentCopy, encoding: "utf8" },
    );
    assert.equal(currentResult.status, 0, currentResult.stderr || currentResult.stdout);
    assert.equal(
      await readFile(join(currentCopy, "wmill-lock.yaml"), "utf8"),
      currentGenerated,
    );
  },
);

test("check mode is byte-read-only", async () => {
  const root = await temporaryWorkspace();
  await put(root, "f/trade/example.ts", "export function main() { return true; }\n");
  await put(root, "f/trade/example.script.yaml", "summary: example\n");
  const output = join(root, "wmill-lock.yaml");
  await writeFile(output, await buildWorkspaceLock(root));
  const before = await stat(output);

  const result = spawnSync(
    process.execPath,
    [generator, "--workspace", root, "--output", output, "--check"],
    { encoding: "utf8" },
  );
  const after = await stat(output);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("check mode reports drift without repairing it", async () => {
  const root = await temporaryWorkspace();
  await put(root, "f/trade/example.ts", "export function main() { return true; }\n");
  await put(root, "f/trade/example.script.yaml", "summary: example\n");
  const output = join(root, "wmill-lock.yaml");
  await writeFile(output, "version: v2\nlocks: {}\n");
  const before = await stat(output);

  const result = spawnSync(
    process.execPath,
    [generator, "--workspace", root, "--output", output, "--check"],
    { encoding: "utf8" },
  );
  const after = await stat(output);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not the deterministic projection/);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("current-tree check is repeatable and does not touch the shared lock", async () => {
  const root = await temporaryWorkspace();
  const output = join(root, "generated-wmill-lock.yaml");
  const generated = await buildWorkspaceLock(workspace);
  assert.equal(await buildWorkspaceLock(workspace), generated);
  await writeFile(output, generated);
  const sharedLock = join(workspace, "wmill-lock.yaml");
  const before = await stat(sharedLock);

  const result = spawnSync(
    process.execPath,
    [generator, "--workspace", workspace, "--output", output, "--check"],
    { encoding: "utf8" },
  );
  const after = await stat(sharedLock);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
});
