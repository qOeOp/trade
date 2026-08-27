#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_METADATA_SUFFIXES = [".script.json", ".script.yaml"];
const SCRIPT_SOURCE_SUFFIXES = [
  ".fetch.ts",
  ".playbook.yml",
  ".duckdb.sql",
  ".deno.ts",
  ".bun.ts",
  ".pg.sql",
  ".my.sql",
  ".bq.sql",
  ".odb.sql",
  ".sf.sql",
  ".ms.sql",
  ".sql",
  ".ps1",
  ".java",
  ".php",
  ".gql",
  ".py",
  ".go",
  ".sh",
  ".rs",
  ".cs",
  ".nu",
  ".rb",
  ".r",
  ".ts",
];
const DIALECT_SQL_SUFFIXES = [
  ".pg.sql",
  ".my.sql",
  ".bq.sql",
  ".odb.sql",
  ".sf.sql",
  ".ms.sql",
  ".duckdb.sql",
];
const RESOURCE_GRAMMAR = Object.freeze({
  flow: Object.freeze({ folderSuffix: ".flow", markers: Object.freeze(["flow.yaml"]) }),
  app: Object.freeze({ folderSuffix: ".app", markers: Object.freeze(["app.yaml"]) }),
  rawApp: Object.freeze({ folderSuffix: ".raw_app", markers: Object.freeze(["raw_app.yaml"]) }),
});
const ALL_RESOURCE_MARKERS = new Set([
  "app.json",
  "app.yaml",
  "flow.json",
  "flow.yaml",
  "raw_app.json",
  "raw_app.yaml",
]);
const NON_DOTTED_RESOURCE_SUFFIXES = ["__app", "__flow", "__raw_app"];
const MODULE_FOLDER_SUFFIXES = ["__dbt", "__mod"];
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const WORKSPACE_CONFIG = "defaultTs: bun\nincludes:\n  - f/trade/**\nexcludes: []\n";

export const WINDMILL_CLI_REHASH_GRAMMAR = Object.freeze({
  package: "windmill-cli@1.791.0",
  packageIntegrity:
    "sha512-gS4km0gPbo8mc+58VxJM69FNjefOd/bwrJJJVg5zHA81hHIud+BNa2nnUNWxI2XNKpMlTb+z3khkdSwY3hb9yA==",
  bundleSha256: "c26ae830b0736602c30b75ebcd678a28f5d58c98b5d7c5cac44c4a9fd56aa4c0",
  sourceExtensions: Object.freeze([...SCRIPT_SOURCE_SUFFIXES]),
  resourceKinds: Object.freeze(Object.keys(RESOURCE_GRAMMAR)),
  prunedDirectoryNames: Object.freeze(["dot-prefixed", "node_modules"]),
});

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readWindmillText(path) {
  const content = await readFile(path);
  if (
    (content[0] === 0xff && content[1] === 0xfe) ||
    (content[0] === 0xfe && content[1] === 0xff) ||
    (content[0] === 0x00 && content[1] === 0x00 && content[2] === 0xfe && content[3] === 0xff)
  ) {
    throw new Error(`unsupported Windmill text encoding: ${path}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error(`invalid UTF-8 Windmill content: ${path}`);
  }
}

async function assertPhysicalDirectory(path, label) {
  const pathStat = await lstat(path);
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
  return realpath(path);
}

function canonicalPath(workspace, path) {
  const localPath = relative(workspace, path);
  if (localPath === "" || localPath.startsWith(`..${sep}`) || localPath === "..") {
    throw new Error(`path escapes workspace: ${path}`);
  }

  const normalized = localPath.split(sep).join("/");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    throw new Error(`ambiguous Windmill path: ${normalized}`);
  }
  return normalized;
}

function scriptRemotePath(workspace, sourcePath) {
  const source = canonicalPath(workspace, sourcePath);
  const firstDot = source.indexOf(".");
  if (firstDot < 0) {
    throw new Error(`script source has no Windmill extension: ${source}`);
  }
  const remotePath = source.slice(0, firstDot);
  if (remotePath === "" || remotePath.endsWith("/")) {
    throw new Error(`ambiguous Windmill script path: ${source}`);
  }
  return remotePath;
}

function isInsideResourceFolder(workspace, path) {
  const directorySegments = canonicalPath(workspace, dirname(path)).split("/");
  return directorySegments.some((segment) =>
    [".app", ".flow", ".raw_app"].some((suffix) => segment.endsWith(suffix)),
  );
}

function shouldPruneDirectory(name) {
  return name === "node_modules" || name.startsWith(".");
}

async function walkFiles(root) {
  const files = [];
  const directories = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && shouldPruneDirectory(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic links are not allowed in the Windmill projection: ${path}`);
      }
      if (entry.isDirectory()) {
        directories.push(path);
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return { directories, files };
}

function addUnique(entries, path, hash) {
  const pathIdentity = path.normalize("NFC").toLowerCase();
  const collision = [...entries.keys()].find(
    (existing) => existing.normalize("NFC").toLowerCase() === pathIdentity,
  );
  if (collision !== undefined) {
    throw new Error(`duplicate or ambiguous Windmill lock path: ${collision} / ${path}`);
  }
  if (!HASH_PATTERN.test(hash)) {
    throw new Error(`invalid content hash for ${path}`);
  }
  entries.set(path, hash);
}

async function scriptEntries(workspace, files) {
  const entries = new Map();
  const fileSet = new Set(files);
  const metadataFiles = new Set(
    files.filter(
      (path) =>
        SCRIPT_METADATA_SUFFIXES.some((suffix) => path.endsWith(suffix)) &&
        !isInsideResourceFolder(workspace, path),
    ),
  );
  const consumedMetadata = new Set();
  const sourceFiles = files.filter(
    (path) =>
      SCRIPT_SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix)) &&
      !isInsideResourceFolder(workspace, path),
  );

  for (const sourcePath of sourceFiles) {
    const remotePath = scriptRemotePath(workspace, sourcePath);
    const metadataBase = join(workspace, ...remotePath.split("/"));
    const candidates = SCRIPT_METADATA_SUFFIXES.map((suffix) => `${metadataBase}${suffix}`).filter(
      (path) => fileSet.has(path),
    );
    if (candidates.length !== 1) {
      throw new Error(
        `${remotePath} must have exactly one canonical metadata file; found ${candidates.length}`,
      );
    }
    if (
      sourcePath.endsWith(".sql") &&
      !DIALECT_SQL_SUFFIXES.some((suffix) => sourcePath.endsWith(suffix))
    ) {
      throw new Error(`ambiguous bare SQL script extension: ${canonicalPath(workspace, sourcePath)}`);
    }

    const metadataPath = candidates[0];
    const [source, metadata] = await Promise.all([
      readWindmillText(sourcePath),
      readWindmillText(metadataPath),
    ]);
    consumedMetadata.add(metadataPath);
    addUnique(entries, remotePath, sha256(`{}${source}${metadata}`));
  }

  const orphanMetadata = [...metadataFiles].filter((path) => !consumedMetadata.has(path));
  if (orphanMetadata.length > 0) {
    throw new Error(
      `metadata has no canonical script source: ${canonicalPath(workspace, orphanMetadata[0])}`,
    );
  }

  return entries;
}

function resourceKindForDirectory(directory) {
  const name = basename(directory);
  return Object.entries(RESOURCE_GRAMMAR).find(([, grammar]) =>
    name.endsWith(grammar.folderSuffix),
  )?.[0];
}

function isWithin(directory, path) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

function classifyResources(workspace, files, directories) {
  for (const directory of directories) {
    const name = basename(directory);
    if (MODULE_FOLDER_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
      throw new Error(
        `unsupported CLI-admitted script module layout: ${canonicalPath(workspace, directory)}`,
      );
    }
    if (NON_DOTTED_RESOURCE_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
      throw new Error(
        `unsupported non-dotted Windmill resource layout: ${canonicalPath(workspace, directory)}`,
      );
    }
  }

  const resourceDirectories = directories
    .map((directory) => ({ directory, kind: resourceKindForDirectory(directory) }))
    .filter(({ kind }) => kind !== undefined)
    .sort((left, right) => comparePaths(left.directory, right.directory));

  for (const resource of resourceDirectories) {
    const parent = resourceDirectories.find(
      (candidate) =>
        candidate.directory !== resource.directory && isWithin(candidate.directory, resource.directory),
    );
    if (parent !== undefined) {
      throw new Error(
        `nested Windmill resources are ambiguous: ${canonicalPath(workspace, parent.directory)} / ${canonicalPath(workspace, resource.directory)}`,
      );
    }

    const directFiles = files.filter((path) => dirname(path) === resource.directory);
    const markers = directFiles.filter((path) =>
      RESOURCE_GRAMMAR[resource.kind].markers.includes(basename(path)),
    );
    const unknownMarkers = directFiles.filter(
      (path) => ALL_RESOURCE_MARKERS.has(basename(path)) && !markers.includes(path),
    );
    if (unknownMarkers.length > 0) {
      throw new Error(
        `unknown Windmill resource marker: ${canonicalPath(workspace, unknownMarkers[0])}`,
      );
    }
    if (markers.length !== 1) {
      throw new Error(
        `${canonicalPath(workspace, resource.directory)} must have exactly one canonical ${resource.kind} marker; found ${markers.length}`,
      );
    }
  }

  const outsideMarker = files.find(
    (path) =>
      ALL_RESOURCE_MARKERS.has(basename(path)) &&
      !resourceDirectories.some(({ directory }) => isWithin(directory, path)),
  );
  if (outsideMarker !== undefined) {
    throw new Error(
      `unknown Windmill resource marker: ${canonicalPath(workspace, outsideMarker)}`,
    );
  }

  return resourceDirectories;
}

async function resourceEntries(workspace, files, resources) {
  const entries = new Map();

  for (const { directory, kind } of resources) {
    const runnableDirectory = kind === "rawApp" ? join(directory, "backend") : directory;
    const runnableFiles = files.filter(
      (path) =>
        dirname(path) === runnableDirectory &&
        SCRIPT_SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix)),
    );
    const fileHashes = new Map();
    for (const runnable of runnableFiles) {
      const subpath = basename(runnable);
      addUnique(fileHashes, subpath, sha256(`${await readWindmillText(runnable)}{}`));
    }

    const sortedFileHashes = Object.fromEntries(
      [...fileHashes.entries()].sort(([left], [right]) => comparePaths(left, right)),
    );
    const resourcePath = canonicalPath(workspace, directory);
    for (const [subpath, hash] of Object.entries(sortedFileHashes)) {
      addUnique(entries, `${resourcePath}+${subpath}`, hash);
    }
    const topHash = kind === "flow" ? "__flow_hash" : "__app_hash";
    addUnique(entries, `${resourcePath}+${topHash}`, sha256(JSON.stringify(sortedFileHashes)));
  }

  return entries;
}

export async function buildWorkspaceLock(workspacePath) {
  const workspace = resolve(workspacePath);
  const physicalWorkspace = await assertPhysicalDirectory(workspace, "workspace");

  const workspaceConfig = await readFile(join(workspace, "wmill.yaml"), "utf8");
  if (workspaceConfig !== WORKSPACE_CONFIG) {
    throw new Error("wmill.yaml does not match the supported deterministic workspace scope");
  }

  const projectionRoot = join(workspace, "f", "trade");
  const physicalProjection = await assertPhysicalDirectory(projectionRoot, "Windmill projection");
  if (physicalProjection !== join(physicalWorkspace, "f", "trade")) {
    throw new Error(`Windmill projection has a symbolic-link ancestor: ${projectionRoot}`);
  }

  const { directories, files } = await walkFiles(projectionRoot);
  const resources = classifyResources(workspace, files, directories);
  const entries = new Map();
  for (const source of [
    await scriptEntries(workspace, files),
    await resourceEntries(workspace, files, resources),
  ]) {
    for (const [path, hash] of source) addUnique(entries, path, hash);
  }

  const sortedEntries = [...entries.entries()].sort(([left], [right]) =>
    comparePaths(left, right),
  );
  const locks = sortedEntries.map(([path, hash]) => `  ${path}: ${hash}\n`).join("");
  return `version: v2\nlocks:${locks === "" ? " {}\n" : `\n${locks}`}`;
}

function usage() {
  return `Usage: generate-wmill-lock.mjs [--workspace DIR] [--output FILE] [--check]\n`;
}

function parseArguments(arguments_) {
  const options = { check: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--check") {
      if (options.check) throw new Error("--check may only be supplied once");
      options.check = true;
    } else if (argument === "--workspace" || argument === "--output") {
      const key = argument.slice(2);
      if (options[key] !== undefined) throw new Error(`${argument} may only be supplied once`);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[key] = value;
      index += 1;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function writeAtomically(path, content) {
  try {
    const targetStat = await lstat(path);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error(`output must be a regular file: ${path}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporaryDirectory = await mkdtemp(join(dirname(path), ".wmill-lock-"));
  const temporaryPath = join(temporaryDirectory, "wmill-lock.yaml");
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function main(arguments_) {
  const options = parseArguments(arguments_);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = resolve(options.workspace ?? defaultWorkspace);
  const output = resolve(options.output ?? join(workspace, "wmill-lock.yaml"));
  const generated = await buildWorkspaceLock(workspace);

  if (options.check) {
    const existing = await readFile(output, "utf8");
    if (existing !== generated) {
      throw new Error(`${output} is not the deterministic projection of ${workspace}`);
    }
    process.stdout.write(`verified ${output}\n`);
    return;
  }

  await writeAtomically(output, generated);
  process.stdout.write(`wrote ${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`generate-wmill-lock: ${error.message}\n`);
    process.exitCode = 1;
  });
}
