import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const skillRoot = resolve(import.meta.dir, "..")
const repositoryRoot = resolve(skillRoot, "../../..")
const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8")
const agents = readFileSync(resolve(repositoryRoot, "AGENTS.md"), "utf8")
const metadata = readFileSync(resolve(skillRoot, "agents/openai.yaml"), "utf8")
const frontmatter = skill.slice(4, skill.indexOf("\n---", 4))
const descriptionLine = frontmatter.split("\n").find((line) => line.startsWith("description: "))
if (!descriptionLine) throw new Error("SKILL.md frontmatter is missing description")
const description = JSON.parse(descriptionLine.slice("description: ".length)) as string
const replayFixtures = JSON.parse(
  readFileSync(resolve(skillRoot, "fixtures/trigger-contract.json"), "utf8"),
) as Array<{ name: string; prompt: string; expectedWorkflowStart: boolean }>

describe("run-bounded-mission entry contract", () => {
  test("the public entry points identify one trigger owner", () => {
    expect(agents).toContain(
      "SKILL.md` 的 frontmatter description 是该 workflow 的唯一触发 owner",
    )
    expect(skill).toContain(
      "The frontmatter description is the single owner for entry classification.",
    )
    expect(metadata).toContain(
      'short_description: "Start an explicitly requested or repository-required mission"',
    )
    expect(metadata).toContain("allow_implicit_invocation: true")
  })

  test("the owner distinguishes affirmative entry from discovery or mention", () => {
    expect(description).toContain("affirmatively invokes the exact token $run-bounded-mission")
    expect(description).toContain("clearly asks to use or run the bounded mission workflow")
    expect(description).toContain("repository instructions require it for non-trivial implementation or delivery")
    expect(description).toContain(
      "Quoting, naming, linking, inspecting, auditing, explaining, diagnosing, or negating",
    )
    expect(description).toContain("An affirmative explicit invocation wins over otherwise excluded request types")
  })

  test("static replay fixtures cover the required workflow-start decisions", () => {
    expect(replayFixtures.map(({ name, expectedWorkflowStart }) => [name, expectedWorkflowStart])).toEqual([
      ["exact affirmative invocation", true],
      ["natural-language affirmative invocation", true],
      ["repository-required non-trivial implementation", true],
      ["mention only", false],
      ["explicit negation", false],
      ["audit only", false],
      ["diagnose only", false],
      ["mechanical edit", false],
      ["routine status", false],
      ["task management", false],
      ["appended affirmative request", true],
    ])
  })
})
