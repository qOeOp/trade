import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const helperPath = resolve(import.meta.dir, "test-effectiveness-audit.ts")
const temporaryRepositories: string[] = []

afterEach(() => {
  for (const path of temporaryRepositories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("test-effectiveness audit", () => {
  test("emits deterministic owner, consumer, test-value, and action evidence without writes", () => {
    const fixture = createFixture()
    write(fixture.root, "modules/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    write(fixture.root, "modules/example/calc/src/calc.test.ts", [
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
      "--scope", "modules/example/calc",
      "--classification", "scenario_gap",
    ])
    const second = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--scope", "modules/example/calc",
      "--classification", "scenario_gap",
    ])

    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
    expect(first.stdout).toBe(second.stdout)
    expect(git(fixture.root, ["status", "--porcelain=v1"])).toBe(statusBefore)
    expect(first.stdout).not.toContain(fixture.root)

    const proposal = JSON.parse(first.stdout)
    expect(proposal.schema_version).toBe("trade.test-effectiveness-proposal.v1")
    expect(proposal.inputs.origin.commit).toBe(fixture.origin)
    expect(proposal.inputs.candidate.commit).toBe(candidate)
    expect(proposal.summary).toMatchObject({
      changed_files: 2,
      affected_owners: 1,
      changed_source_files: 1,
      candidate_tests: 1,
      no_direct_static_candidate_evidence: false,
    })
    expect(proposal.affected_owners[0].owner).toBe("modules/example/calc")
    expect(proposal.affected_owners[0].consumer_evidence.reverse_importers).toContain(
      "modules/example/calc/src/main.ts",
    )
    expect(proposal.affected_owners[0].candidate_tests[0]).toMatchObject({
      path: "modules/example/calc/src/calc.test.ts",
      direct_changed_source_imports: ["modules/example/calc/src/calc.ts"],
      recommendation: { action: "strengthen" },
    })
    expect(proposal.affected_owners[0].candidate_tests[0].relevant).toBeUndefined()
    expect(proposal.escaped_defect_review.questions).toHaveLength(5)
    expect(proposal.proposal.test_refactor_mission.unresolved_conditions).toContain(
      "integrated_refactor_proposal_evidence",
    )
  })

  test("reports empty diffs and changed owners with no test evidence without inventing coverage", () => {
    const fixture = createFixture()
    const emptyCandidate = commit(fixture.root, "empty candidate", true)
    const empty = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", emptyCandidate,
      "--scope", "modules/example/calc",
    ])
    expect(empty.status).toBe(0)
    expect(JSON.parse(empty.stdout).summary).toMatchObject({
      changed_files: 0,
      affected_owners: 0,
      candidate_tests: 0,
      no_direct_static_candidate_evidence: false,
    })

    write(fixture.root, "modules/example/no-test/CONTRACT.md", "# No Test Owner\n")
    write(fixture.root, "modules/example/no-test/package.json", '{"name":"no-test","private":true}\n')
    write(fixture.root, "modules/example/no-test/src/value.ts", "export const value = 1\n")
    const noTestOrigin = commit(fixture.root, "add owner without tests")
    write(fixture.root, "modules/example/no-test/src/value.ts", "export const value = 2\n")
    const noTestCandidate = commit(fixture.root, "change owner without tests")
    const noTest = audit(fixture.root, [
      "--origin", noTestOrigin,
      "--candidate", noTestCandidate,
      "--scope", "modules/example/no-test",
    ])
    expect(noTest.status).toBe(0)
    const proposal = JSON.parse(noTest.stdout)
    expect(proposal.summary).toMatchObject({
      changed_files: 1,
      affected_owners: 1,
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })
    expect(proposal.affected_owners[0].consumer_evidence).toMatchObject({
      contract_paths: ["modules/example/no-test/CONTRACT.md"],
      entrypoint_paths: [],
      reverse_importers: [],
      status: "unresolved",
    })
    expect(proposal.authority.forbidden_claims).toContain("coverage_proven")
    expect(proposal.proposal.test_refactor_mission.recommendation).toBe("not_recommended")

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
    write(fixture.root, "modules/example/calc/src/calc-side-effect.test.ts", [
      'import "./calc"',
      'import { expect, test } from "bun:test"',
      'test("loads calculation side effects", () => expect(true).toBe(true))',
      "",
    ].join("\n"))
    write(fixture.root, "modules/example/integration/CONTRACT.md", "# Integration Contract\n")
    write(fixture.root, "modules/example/integration/package.json", '{"name":"integration","private":true}\n')
    write(fixture.root, "modules/example/integration/src/calc.integration.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { add } from "../../calc/src/calc"',
      'test("uses calculation across owners", () => expect(add(1, 2)).toBe(3))',
      "",
    ].join("\n"))
    const origin = commit(fixture.root, "add cross-owner and side-effect tests")
    write(fixture.root, "modules/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")

    const proposal = JSON.parse(audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--scope", "modules/example/calc",
    ]).stdout)
    const candidatePaths = proposal.affected_owners
      .flatMap((owner: { candidate_tests: Array<{ path: string }> }) => owner.candidate_tests)
      .map((item: { path: string }) => item.path)
    expect(candidatePaths).toContain("modules/example/calc/src/calc-side-effect.test.ts")
    expect(candidatePaths).toContain("modules/example/integration/src/calc.integration.test.ts")
    expect(proposal.affected_owners.find(
      (owner: { owner: string }) => owner.owner === "modules/example/integration",
    )).toMatchObject({
      changes: [],
      candidate_tests: [{
        path: "modules/example/integration/src/calc.integration.test.ts",
        direct_changed_source_imports: ["modules/example/calc/src/calc.ts"],
      }],
    })
  })

  test("reports deleted tests as origin-review uncertainty", () => {
    const fixture = createFixture()
    rmSync(join(fixture.root, "modules/example/calc/src/calc.test.ts"))
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
      paths: ["modules/example/calc/src/calc.test.ts"],
      status: "requires_origin_review",
    })
    expect(proposal.affected_owners[0].deleted_test_paths).toEqual([
      "modules/example/calc/src/calc.test.ts",
    ])
    expect(proposal.proposal.test_refactor_mission.recommendation).toBe("conditional")
  })

  test("does not broadcast a failure classification across multiple candidate tests", () => {
    const fixture = createFixture()
    write(fixture.root, "modules/example/calc/src/calc-second.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { add } from "./calc"',
      'test("adds another pair", () => expect(add(2, 2)).toBe(4))',
      "",
    ].join("\n"))
    const origin = commit(fixture.root, "add second calculation test")
    write(fixture.root, "modules/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right + 0\n")
    const candidate = commit(fixture.root, "change calculation source")
    const proposal = JSON.parse(audit(fixture.root, [
      "--origin", origin,
      "--candidate", candidate,
      "--classification", "outdated_contract_or_assertion",
    ]).stdout)

    expect(proposal.inputs.classification.recommendation_binding).toBe("unbound")
    expect(proposal.summary.candidate_tests).toBe(2)
    for (const candidateTest of proposal.affected_owners[0].candidate_tests) {
      expect(candidateTest.recommendation.action).toBe("further_investigation")
    }
  })

  test("keeps exact duplicates as investigation leads instead of deletion candidates", () => {
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
    write(fixture.root, "modules/example/calc/src/duplicate-a.test.ts", duplicate)
    write(fixture.root, "modules/example/calc/src/duplicate-b.test.ts", duplicate)
    const candidate = commit(fixture.root, "add exact duplicate tests")
    const result = audit(fixture.root, [
      "--origin", fixture.origin,
      "--candidate", candidate,
      "--scope", "modules/example/calc",
      "--classification", "outdated_contract_or_assertion",
    ])
    expect(result.status).toBe(0)
    const proposal = JSON.parse(result.stdout)
    expect(proposal.summary.action_counts.delete_candidate).toBeUndefined()
    expect(proposal.affected_owners[0].candidate_tests).toHaveLength(2)
    for (const candidateTest of proposal.affected_owners[0].candidate_tests) {
      expect(candidateTest.recommendation.action).toBe("further_investigation")
      expect(candidateTest.cost_signals.exact_content_duplicate_paths).toHaveLength(1)
    }
  })

  test("qualifies indirect and deleted-source gaps as absent direct static candidates", () => {
    const fixture = createFixture()
    write(fixture.root, "modules/example/calc/src/internal.ts", "export const internalValue = 1\n")
    write(
      fixture.root,
      "modules/example/calc/src/public.ts",
      'import { internalValue } from "./internal"\nexport const publicValue = internalValue\n',
    )
    write(fixture.root, "modules/example/calc/src/indirect.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { publicValue } from "./public"',
      'test("uses the public boundary", () => expect(publicValue).toBe(1))',
      "",
    ].join("\n"))
    const indirectOrigin = commit(fixture.root, "add indirect test path")
    write(fixture.root, "modules/example/calc/src/internal.ts", "export const internalValue = 2\n")
    const indirectCandidate = commit(fixture.root, "change transitive source")
    const indirect = JSON.parse(audit(fixture.root, [
      "--origin", indirectOrigin,
      "--candidate", indirectCandidate,
      "--scope", "modules/example/calc",
    ]).stdout)
    expect(indirect.summary).toMatchObject({
      candidate_tests: 0,
      no_direct_static_candidate_evidence: true,
    })

    write(fixture.root, "modules/example/calc/src/obsolete.ts", "export const obsolete = true\n")
    write(fixture.root, "modules/example/calc/src/obsolete.test.ts", [
      'import { expect, test } from "bun:test"',
      'import { obsolete } from "./obsolete"',
      'test("reads the obsolete source", () => expect(obsolete).toBe(true))',
      "",
    ].join("\n"))
    const deletedOrigin = commit(fixture.root, "add source that will be deleted")
    rmSync(join(fixture.root, "modules/example/calc/src/obsolete.ts"))
    const deletedCandidate = commit(fixture.root, "delete source")
    const deleted = JSON.parse(audit(fixture.root, [
      "--origin", deletedOrigin,
      "--candidate", deletedCandidate,
      "--scope", "modules/example/calc",
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
        schema_version: "trade.test-effectiveness-error.v1",
        error: { code: "audit_failed" },
      })
    }
  })
})

function createFixture(): { root: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), "test-effectiveness-audit-"))
  temporaryRepositories.push(root)
  git(root, ["init", "--quiet"])
  write(root, "modules/example/calc/CONTRACT.md", "# Calculator Contract\n")
  write(root, "modules/example/calc/package.json", JSON.stringify({
    name: "calculator",
    private: true,
    scripts: { test: "bun test" },
  }))
  write(root, "modules/example/calc/src/calc.ts", "export const add = (left: number, right: number) => left + right\n")
  write(root, "modules/example/calc/src/main.ts", 'import { add } from "./calc"\nexport const result = add(1, 2)\n')
  write(root, "modules/example/calc/src/calc.test.ts", [
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

function audit(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([process.execPath, helperPath, ...args], {
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
