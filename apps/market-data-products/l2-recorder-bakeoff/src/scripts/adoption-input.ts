#!/usr/bin/env bun

import { dirname, relative, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildAdoptionInput,
  type AdoptionEvidenceInput,
} from "../bun/adoption-input";

interface Arguments {
  projector: string;
  segment: string;
  crash: string;
  supervisedSoak: string;
  naturalSoak?: string;
  output: string;
}

const repositoryRoot = resolve(process.cwd(), "../../..");
const arguments_ = parseArgs(process.argv.slice(2));
const paths = {
  projector: resolve(repositoryRoot, arguments_.projector),
  segment: resolve(repositoryRoot, arguments_.segment),
  crash: resolve(repositoryRoot, arguments_.crash),
  supervisedSoak: resolve(repositoryRoot, arguments_.supervisedSoak),
  naturalSoak:
    arguments_.naturalSoak == null
      ? undefined
      : resolve(repositoryRoot, arguments_.naturalSoak),
};
for (const path of Object.values(paths)) {
  if (path != null) assertTmpPath(path);
}
const report = buildAdoptionInput({
  projector: readJson(paths.projector) as AdoptionEvidenceInput["projector"],
  segment: readJson(paths.segment) as AdoptionEvidenceInput["segment"],
  crash: readJson(paths.crash) as AdoptionEvidenceInput["crash"],
  supervisedSoak: readJson(
    paths.supervisedSoak,
  ) as AdoptionEvidenceInput["supervisedSoak"],
  naturalSoak:
    paths.naturalSoak == null
      ? undefined
      : (readJson(paths.naturalSoak) as NonNullable<
          AdoptionEvidenceInput["naturalSoak"]
        >),
});
const outputPath = resolve(repositoryRoot, arguments_.output);
assertTmpPath(outputPath);
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  sources: Object.fromEntries(
    Object.entries(paths)
      .filter(([, path]) => path != null)
      .map(([name, path]) => [name, relative(repositoryRoot, path!)]),
  ),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({ output: relative(repositoryRoot, outputPath), readiness: report["readiness"] })}\n`,
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertTmpPath(path: string): void {
  const repositoryRelative = relative(repositoryRoot, path).replaceAll(
    "\\",
    "/",
  );
  if (
    !repositoryRelative.startsWith("tmp/") ||
    repositoryRelative.includes("../")
  )
    throw new Error("evidence path must be inside repository tmp/");
}

function parseArgs(argv: string[]): Arguments {
  const result: Arguments = {
    projector: "tmp/l2-recorder-bakeoff/live-evidence-20260722.json",
    segment: "tmp/l2-recorder-bakeoff/segment-evidence-20260722.json",
    crash: "tmp/l2-recorder-bakeoff/crash-evidence-20260722.json",
    supervisedSoak:
      "tmp/l2-recorder-bakeoff/soak-supervisor-evidence-20260722.json",
    output: `tmp/l2-recorder-bakeoff/adoption-input-${Date.now()}.json`,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name == null || value == null)
      throw new Error(`incomplete argument: ${name ?? "<missing>"}`);
    if (name === "--projector") result.projector = value;
    else if (name === "--segment") result.segment = value;
    else if (name === "--crash") result.crash = value;
    else if (name === "--supervised-soak") result.supervisedSoak = value;
    else if (name === "--natural-soak") result.naturalSoak = value;
    else if (name === "--output") result.output = value;
    else throw new Error(`unknown argument: ${name}`);
  }
  return result;
}
