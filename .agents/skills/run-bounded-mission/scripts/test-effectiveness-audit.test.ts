import { afterEach, describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const helperPath = resolve(import.meta.dir, "test-effectiveness-audit.ts")
const temporaryRepositories: string[] = []

afterEach(() => {
  for (const path of temporaryRepositories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("test-effectiveness audit", () => {
  test("prints help without requiring a Git repository", () => {
    const root = mkdtempSync(join(tmpdir(), "test-effectiveness-help-"))
    temporaryRepositories.push(root)
    const result = audit(root, ["--help"])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Usage: test-effectiveness-audit.ts")
  })

  test("emits deterministic owner, consumer-lead, and test-value evidence without writes", () => {
    const fixture = createFixture()
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    write(fixture.root, "apps/example/calc/src/calc.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { add } from "./calc"',
      "",
      'test("adds values at the public boundary", () => {',
      "  expect(add(2, 3)).toBe(5)",
      "})",
      "",
    ].join("\n"))
    const candidate = commit(fixture.root, "change calculation")
    const statusBefore = git(fixture.root, ["status", "--porcelain=v1"])

    const first = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
      "--classification", "scenario_gap",
    ])
    const second = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
      "--classification", "scenario_gap",
    ])
    const fromSubdirectory = audit(join(fixture.root, "apps/example"), [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
      "--classification", "scenario_gap",
    ])

    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
    expect(fromSubdirectory.status).toBe(0)
    expect(first.stdout).toBe(second.stdout)
    expect(first.stdout).toBe(fromSubdirectory.stdout)
    expect(git(fixture.root, ["status", "--porcelain=v1"])).toBe(statusBefore)
    expect(first.stdout).not.toContain(fixture.root)

    const proposal = JSON.parse(first.stdout)
    expect(proposal.schema_version).toBe("bounded-mission.test-effectiveness-evidence.v1")
    expect(proposal.inputs.origin.commit).toBe(fixture.origin)
    expect(proposal.inputs.candidate.commit).toBe(candidate)
    expect(proposal.inputs.owner_roots).toContain("apps/example/calc")
    expect(proposal.summary).toMatchObject({
      changed_files: 2,
      affected_owners: 1,
      changed_source_files: 1,
      candidate_tests: 1,
      no_direct_static_candidate_evidence: false,
    })
    expect(proposal.affected_owners[0].owner).toBe("apps/example/calc")
    expect(proposal.affected_owners[0].consumer_leads.reverse_importers).toContain(
      "apps/example/calc/src/main.ts",
    )
    expect(proposal.affected_owners[0].candidate_tests[0]).toMatchObject({
      path: "apps/example/calc/src/calc.test.ts",
      direct_changed_source_imports: ["apps/example/calc/src/calc.ts"],
    })
    expect(proposal.affected_owners[0].candidate_tests[0].relevant).toBeUndefined()
    expect(proposal.escaped_defect_review.questions).toHaveLength(5)
    expect(proposal.caveats).toContain(
      "A provided failure classification is context only and never selects a test action.",
    )
  })

  test("runs an audit from a dependency-free helper copy", () => {
    const fixture = createFixture()
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation")
    const standaloneRoot = mkdtempSync(join(tmpdir(), "test-effectiveness-standalone-"))
    temporaryRepositories.push(standaloneRoot)
    const standaloneHelper = join(standaloneRoot, "test-effectiveness-audit.ts")
    copyFileSync(helperPath, standaloneHelper)

    const result = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--owner-root", "apps/example/calc",
    ], standaloneHelper)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).summary.candidate_tests).toBe(1)
  })

  test("reports empty diffs and changed owners with no test evidence without inventing coverage", () => {
    const fixture = createFixture()
    const emptyCandidate = commit(fixture.root, "empty candidate", true)
    const empty = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", emptyCandidate,
      "--scope", "apps/example/calc",
    ])
    expect(empty.status).toBe(0)
    expect(JSON.parse(empty.stdout).summary).toMatchObject({
      changed_files: 0,
      affected_owners: 0,
      candidate_tests: 0,
      no_direct_static_candidate_evidence: false,
    })

    write(fixture.root, "apps/example/no-test/CONTRACT.md", "# No Test Owner\n")
    write(fixture.root, "apps/example/no-test/package.json", '{"name":"no-test","private":true}\n')
    write(fixture.root, "apps/example/no-test/src/value.ts", "export const value = 1\n")
    const noTestOrigin = commit(fixture.root, "add owner without tests")
    write(fixture.root, "apps/example/no-test/src/value.ts", "export const value = 2\n")
    const noTestCandidate = commit(fixture.root, "change owner without tests")
    const noTest = audit(fixture.root, [
      "--origin", noTestOrigin,
      "--candidate", noTestCandidate,
      "--scope", "apps/example/no-test",
    ])
    expect(noTest.status).toBe(0)
    const proposal = JSON.parse(noTest.stdout)
    expect(proposal.summary).toMatchObject({
      changed_files: 1,
      affected_owners: 1,
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })
    expect(proposal.affected_owners[0].consumer_leads).toMatchObject({
      contract_paths: ["apps/example/no-test/CONTRACT.md"],
      entrypoint_paths: [],
      reverse_importers: [],
      status: "unresolved",
      uncertainty: "static paths do not prove production reachability or execution",
    })
    expect(proposal.authority.forbidden_claims).toContain("coverage_proven")

    write(fixture.root, "scripts/audit-helper.sh", "#!/usr/bin/env sh\nprintf 'one\\n'\n")
    const shellOrigin = commit(fixture.root, "add shell source")
    write(fixture.root, "scripts/audit-helper.sh", "#!/usr/bin/env sh\nprintf 'two\\n'\n")
    const shellCandidate = commit(fixture.root, "change shell source")
    const shell = JSON.parse(audit(fixture.root, [
      "--origin", shellOrigin,
      "--candidate", shellCandidate,
      "--scope", "scripts",
    ]).stdout)
    expect(shell.summary).toMatchObject({
      changed_source_files: 1,
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })
  })

  test("includes direct and side-effect test importers from unchanged owners", () => {
    const fixture = createFixture()
    write(fixture.root, "apps/example/calc/src/calc-side-effect.test.ts", [
      'import "./calc"',
      'import { expect, test } from "bun:test"',
      'test("loads calculation side effects", () => expect(true).toBe(true))',
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/integration/CONTRACT.md", "# Integration Contract\n")
    write(fixture.root, "apps/example/integration/package.json", '{"name":"integration","private":true}\n')
    write(fixture.root, "apps/example/integration/src/calc.integration.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { add } from "../../calc/src/calc"',
      'test("uses calculation across owners", () => expect(add(1, 2)).toBe(3))',
      "",
    ].join("\n"))
    const origin = commit(fixture.root, "add cross-owner and side-effect tests")
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")

    const proposal = JSON.parse(audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
    ]).stdout)
    const candidatePaths = proposal.affected_owners
      .flatMap((owner: { candidate_tests: Array<{ path: string }> }) => owner.candidate_tests)
      .map((item: { path: string }) => item.path)
    expect(candidatePaths).toContain("apps/example/calc/src/calc-side-effect.test.ts")
    expect(candidatePaths).toContain("apps/example/integration/src/calc.integration.test.ts")
    expect(proposal.affected_owners.find(
      (owner: { owner: string }) => owner.owner === "apps/example/integration",
    )).toMatchObject({
      changes: [],
      candidate_tests: [{
        path: "apps/example/integration/src/calc.integration.test.ts",
        direct_changed_source_imports: ["apps/example/calc/src/calc.ts"],
      }],
    })
  })

  test("finds multiline, dynamic, re-export, and punctuation-path importers", () => {
    const fixture = createFixture()
    write(fixture.root, "apps/example/calc/src/multiline.test.ts", [
      "import {",
      "  add,",
      "} from",
      '  "./calc"',
      'test("loads a multiline import", () => expect(add(1, 2)).toBe(3))',
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/dynamic.test.js", [
      "void import(",
      '  "./calc"',
      ")",
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/re-export.test.ts", [
      "export {",
      "  add,",
      "} from",
      '  "./calc"',
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/colon: spaced.test.ts", [
      "import {",
      "  add,",
      '} from "./calc"',
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/module-require.test.cjs", 'module.require("./calc")\n')
    write(fixture.root, "apps/example/calc/src/shebang.test.js", [
      "#!/usr/bin/env bun",
      'import { add } from "./calc"',
      "void add",
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/测试\tline\nbreak.test.ts", 'import { add } from "./calc"\n')
    const origin = commit(fixture.root, "add semantic import fixtures")
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")

    const result = audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
    ])
    expect(result.status).toBe(0)
    const evidence = JSON.parse(result.stdout)
    expect(evidence.import_analysis).toMatchObject({
      status: "complete",
      incomplete_files: [],
    })
    const candidateTests = evidence.affected_owners[0].candidate_tests.map(
      (item: { path: string }) => item.path,
    )
    expect(candidateTests).toHaveLength(8)
    expect(candidateTests).toEqual(expect.arrayContaining([
      "apps/example/calc/src/calc.test.ts",
      "apps/example/calc/src/colon: spaced.test.ts",
      "apps/example/calc/src/dynamic.test.js",
      "apps/example/calc/src/multiline.test.ts",
      "apps/example/calc/src/module-require.test.cjs",
      "apps/example/calc/src/re-export.test.ts",
      "apps/example/calc/src/shebang.test.js",
      "apps/example/calc/src/测试\tline\nbreak.test.ts",
    ]))
  })

  test("marks incomplete import evidence without discarding proven edges", () => {
    const fixture = createFixture()
    rmSync(join(fixture.root, "apps/example/calc/src/calc.test.ts"))
    write(fixture.root, "apps/example/calc/src/broken.test.ts", [
      "import {",
      "  add",
      'from "./calc"',
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/non-literal.test.ts", [
      'const target = "./calc"',
      "void import(target)",
      "",
    ].join("\n"))
    write(fixture.root, "apps/example/calc/src/import-type.test.ts", 'type Add = import("./calc").add\n')
    const origin = commit(fixture.root, "add incomplete import fixtures")
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")

    const result = audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
    ])
    expect(result.status).toBe(0)
    const evidence = JSON.parse(result.stdout)
    expect(evidence.import_analysis).toMatchObject({
      status: "incomplete",
      incomplete_files: [
        {
          path: "apps/example/calc/src/broken.test.ts",
          reasons: ["parse_error"],
        },
        {
          path: "apps/example/calc/src/import-type.test.ts",
          reasons: ["unsupported_module_syntax"],
        },
        {
          path: "apps/example/calc/src/non-literal.test.ts",
          reasons: ["non_literal_module_specifier", "unsupported_module_syntax"],
        },
      ],
    })
    expect(evidence.summary).toMatchObject({
      candidate_tests: 0,
      no_direct_static_candidate_evidence: false,
    })
    expect(evidence.affected_owners[0].consumer_leads.reverse_importers).toContain(
      "apps/example/calc/src/main.ts",
    )
  })

  test("does not turn comment, string, regex, or template text into proven edges", () => {
    const fixture = createFixture()
    rmSync(join(fixture.root, "apps/example/calc/src/calc.test.ts"))
    write(fixture.root, "apps/example/calc/src/text-only.test.ts", [
      '// import type { Add } from "./calc"',
      'const staticText = \'import type { Add } from "./calc"\'',
      "const dynamicText = \"import('./calc')\"",
      'const pattern = /module\\.require\\("\\.\\/calc"\\)/',
      'const templateText = `require("./calc")`',
      "void [staticText, dynamicText, pattern, templateText]",
      "",
    ].join("\n"))
    const origin = commit(fixture.root, "add adversarial module text")
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")

    const evidence = JSON.parse(audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
    ]).stdout)
    expect(evidence.import_analysis.status).toBe("incomplete")
    expect(evidence.summary).toMatchObject({
      candidate_tests: 0,
      no_direct_static_candidate_evidence: false,
    })
    expect(evidence.affected_owners[0].candidate_tests).toEqual([])
  })

  test("attributes a cross-owner rename to both revision owners within either scope", () => {
    const root = mkdtempSync(join(tmpdir(), "test-effectiveness-rename-"))
    temporaryRepositories.push(root)
    git(root, ["init", "--quiet"])
    write(root, "workspace/alpha/src/value.ts", "export const value = 1\n")
    const origin = commit(root, "origin owner")
    mkdirSync(join(root, "workspace/beta/src"), { recursive: true })
    renameSync(
      join(root, "workspace/alpha/src/value.ts"),
      join(root, "workspace/beta/src/value.ts"),
    )
    const candidate = commit(root, "move source between owners")

    for (const scope of [undefined, "workspace/alpha", "workspace/beta"]) {
      const result = audit(root, [
        "--origin", origin,
        "--candidate", candidate,
        "--owner-root", "workspace/alpha",
        "--owner-root", "workspace/beta",
        ...(scope ? ["--scope", scope] : []),
      ])
      expect(result.status).toBe(0)
      const evidence = JSON.parse(result.stdout)
      expect(evidence.affected_owners.map((owner: { owner: string }) => owner.owner)).toEqual([
        "workspace/alpha",
        "workspace/beta",
      ])
      expect(evidence.affected_owners[0]).toMatchObject({
        owner: "workspace/alpha",
        changed_source_paths: [],
        changes: [{
          status: "R100",
          previous_path: "workspace/alpha/src/value.ts",
          path: "workspace/beta/src/value.ts",
        }],
      })
      expect(evidence.affected_owners[1]).toMatchObject({
        owner: "workspace/beta",
        changed_source_paths: ["workspace/beta/src/value.ts"],
      })
      expect(evidence.unowned_changes).toEqual([])
    }
  })

  test("does not resolve an external bare package to a coincidental repository path", () => {
    const fixture = createFixture()
    write(fixture.root, "config/index.ts", "export const internalConfig = 1\n")
    write(fixture.root, "apps/example/calc/src/external-config.test.ts", [
      'import { expect, test } from "bun:test"',
      'import config from "config"',
      'test("uses the external package", () => expect(config).toBeDefined())',
      "",
    ].join("\n"))
    const origin = commit(fixture.root, "add coincidental path and external import")
    write(fixture.root, "config/index.ts", "export const internalConfig = 2\n")
    const candidate = commit(fixture.root, "change coincidental repository path")

    const result = audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--owner-root", "config",
      "--owner-root", "apps/example/calc",
    ])
    expect(result.status).toBe(0)
    const evidence = JSON.parse(result.stdout)
    expect(evidence.summary).toMatchObject({
      affected_owners: 1,
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })
    expect(evidence.affected_owners.map((owner: { owner: string }) => owner.owner)).toEqual(["config"])
  })

  test("reports deleted tests as origin-review uncertainty", () => {
    const fixture = createFixture()
    rmSync(join(fixture.root, "apps/example/calc/src/calc.test.ts"))
    const candidate = commit(fixture.root, "delete calculation test")
    const proposal = JSON.parse(audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
    ]).stdout)

    expect(proposal.summary).toMatchObject({
      changed_files: 1,
      candidate_tests: 0,
      deleted_test_files: 1,
      no_direct_static_candidate_evidence: false,
    })
    expect(proposal.deleted_test_review).toMatchObject({
      paths: ["apps/example/calc/src/calc.test.ts"],
      status: "requires_origin_review",
    })
    expect(proposal.affected_owners[0].deleted_test_paths).toEqual([
      "apps/example/calc/src/calc.test.ts",
    ])
  })

  test("keeps a failure classification as context across multiple candidate tests", () => {
    const fixture = createFixture()
    write(fixture.root, "apps/example/calc/src/calc-second.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { add } from "./calc"',
      'test("adds another pair", () => expect(add(2, 2)).toBe(4))',
      "",
    ].join("\n"))
    const origin = commit(fixture.root, "add second calculation test")
    write(fixture.root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")
    const proposal = JSON.parse(audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--classification", "outdated_contract_or_assertion",
    ]).stdout)

    expect(proposal.inputs.classification).toMatchObject({
      status: "provided",
      value: "outdated_contract_or_assertion",
    })
    expect(proposal.summary.candidate_tests).toBe(2)
    for (const candidateTest of proposal.affected_owners[0].candidate_tests) {
      expect(candidateTest.recommendation).toBeUndefined()
    }
  })

  test("keeps exact duplicates as investigation leads without selecting an action", () => {
    const fixture = createFixture()
    const duplicate = [
      'import { expect, test } from "bun:test"',
      'import { add } from "./calc"',
      "",
      'test("duplicate bytes are not deletion proof", () => {',
      "  expect(add(1, 2)).toBe(3)",
      "})",
      "",
    ].join("\n")
    write(fixture.root, "apps/example/calc/src/duplicate-a.test.ts", duplicate)
    write(fixture.root, "apps/example/calc/src/duplicate-b.test.ts", duplicate)
    const candidate = commit(fixture.root, "add exact duplicate tests")
    const result = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--scope", "apps/example/calc",
      "--classification", "outdated_contract_or_assertion",
    ])
    expect(result.status).toBe(0)
    const proposal = JSON.parse(result.stdout)
    expect(proposal.affected_owners[0].candidate_tests).toHaveLength(2)
    for (const candidateTest of proposal.affected_owners[0].candidate_tests) {
      expect(candidateTest.recommendation).toBeUndefined()
      expect(candidateTest.cost_signals.exact_content_duplicate_paths).toHaveLength(1)
    }
  })

  test("qualifies indirect and deleted-source gaps as absent direct static candidates", () => {
    const fixture = createFixture()
    write(fixture.root, "apps/example/calc/src/internal.ts", "export const internalValue = 1\n")
    write(
      fixture.root,
      "apps/example/calc/src/public.ts",
      'import { internalValue } from "./internal"\nexport const publicValue = internalValue\n',
    )
    write(fixture.root, "apps/example/calc/src/indirect.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { publicValue } from "./public"',
      'test("uses the public boundary", () => expect(publicValue).toBe(1))',
      "",
    ].join("\n"))
    const indirectOrigin = commit(fixture.root, "add indirect test path")
    write(fixture.root, "apps/example/calc/src/internal.ts", "export const internalValue = 2\n")
    const indirectCandidate = commit(fixture.root, "change transitive source")
    const indirect = JSON.parse(audit(fixture.root, [
      "--origin", indirectOrigin,
      "--candidate", indirectCandidate,
      "--scope", "apps/example/calc",
    ]).stdout)
    expect(indirect.summary).toMatchObject({
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })

    write(fixture.root, "apps/example/calc/src/obsolete.ts", "export const obsolete = true\n")
    write(fixture.root, "apps/example/calc/src/obsolete.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { obsolete } from "./obsolete"',
      'test("reads the obsolete source", () => expect(obsolete).toBe(true))',
      "",
    ].join("\n"))
    const deletedOrigin = commit(fixture.root, "add source that will be deleted")
    rmSync(join(fixture.root, "apps/example/calc/src/obsolete.ts"))
    const deletedCandidate = commit(fixture.root, "delete source")
    const deleted = JSON.parse(audit(fixture.root, [
      "--origin", deletedOrigin,
      "--candidate", deletedCandidate,
      "--scope", "apps/example/calc",
    ]).stdout)
    expect(deleted.summary).toMatchObject({
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })
  })

  test("fails closed on escaping scopes, invalid classifications, symbolic refs, and unknown revisions", () => {
    const fixture = createFixture()
    const hexRef40 = "1".repeat(40)
    const hexRef64 = "2".repeat(64)
    git(fixture.root, ["branch", "symbolic-branch", fixture.origin])
    git(fixture.root, ["branch", hexRef40, fixture.origin])
    git(fixture.root, ["branch", hexRef64, fixture.origin])
    const cases = [
      ["--origin", fixture.origin, "--candidate", fixture.origin, "--scope", "../escape"],
      ["--origin", fixture.origin, "--candidate", fixture.origin, "--owner-root", "../escape"],
      ["--origin", fixture.origin, "--candidate", fixture.origin, "--classification", "guess"],
      ["--origin", "HEAD", "--candidate", fixture.origin],
      ["--origin", "symbolic-branch", "--candidate", fixture.origin],
      ["--origin", fixture.origin.slice(0, 12), "--candidate", fixture.origin],
      ["--origin", `${fixture.origin}^`, "--candidate", fixture.origin],
      ["--origin", hexRef40, "--candidate", fixture.origin],
      ["--origin", hexRef64, "--candidate", fixture.origin],
      ["--origin", fixture.origin, "--candidate", "missing-revision"],
    ]
    for (const args of cases) {
      const result = audit(fixture.root, args)
      expect(result.status).not.toBe(0)
      expect(result.stderr).not.toContain(fixture.root)
      expect(JSON.parse(result.stderr)).toMatchObject({
        schema_version: "bounded-mission.test-effectiveness-error.v1",
        error: { code: "audit_failed" },
      })
    }
  })
})

function createFixture(): { root: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), "test-effectiveness-audit-"))
  temporaryRepositories.push(root)
  git(root, ["init", "--quiet"])
  write(root, "apps/example/calc/CONTRACT.md", "# Calculator Contract\n")
  write(root, "apps/example/calc/package.json", JSON.stringify({
    name: "calculator",
    private: true,
    scripts: { test: "bun test" },
  }))
  write(root, "apps/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right\n")
  write(root, "apps/example/calc/src/main.ts", 'import { add } from "./calc"\nexport const result = add(1, 2)\n')
  write(root, "apps/example/calc/src/calc.test.ts", [
    'import { expect, test } from "bun:test"',
    'import { add } from "./calc"',
    "",
    'test("adds values", () => {',
    "  expect(add(1, 2)).toBe(3)",
    "})",
    "",
  ].join("\n"))
  return { root, origin: commit(root, "origin") }
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function commit(root: string, message: string, allowEmpty = false): string {
  git(root, ["add", "."])
  const args = [
    "-c", "user.name=Test",
    "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "-m", message,
  ]
  if (allowEmpty) args.push("--allow-empty")
  git(root, args)
  return git(root, ["rev-parse", "HEAD"]).trim()
}

function audit(
  root: string,
  args: string[],
  executable = helperPath,
): { status: number; stdout: string; stderr: string } {
  let ownerArgs: string[] = []
  if (!args.includes("--help") && !args.includes("--owner-root")) {
    const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"]).trim()
    ownerArgs = [
      "apps/example/calc",
      "apps/example/integration",
      "apps/example/no-test",
      "scripts",
    ]
      .filter((path) => existsSync(join(repositoryRoot, path)))
      .flatMap((path) => ["--owner-root", path])
  }
  const result = Bun.spawnSync([process.execPath, executable, ...args, ...ownerArgs], {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}
