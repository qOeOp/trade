import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const helperPath = resolve(import.meta.dir, "git-path-history.py")
const python = Bun.which("python3") ?? Bun.which("python") ?? ""
if (!python) throw new Error("python3 or python is required")

const temporaryRepositories: string[] = []

afterEach(() => {
  for (const path of temporaryRepositories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("bounded Git path history", () => {
  test("resolves repository-relative paths from a nested working directory", () => {
    const root = createRepository()
    write(root, "src/value.txt", "one\n")
    commit(root, "initial value")
    write(root, "src/value.txt", "one\ntwo\n")
    const candidate = commit(root, "extend value")
    mkdirSync(join(root, "nested"))

    const result = history(join(root, "nested"), [
      "--repo", ".",
      "--path", "src/value.txt",
      "--revision", "HEAD",
      "--max-count", "1",
      "--format", "json",
    ])

    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.paths).toEqual(["src/value.txt"])
    expect(output.truncated).toBe(true)
    expect(output.commits).toHaveLength(1)
    expect(output.commits[0]).toMatchObject({
      commit: candidate,
      additions: 1,
      deletions: 0,
      file_count: 1,
      files: [{ path: "src/value.txt", binary: false }],
    })
  })

  test("follows a file across a rename without treating a directory as followable", () => {
    const root = createRepository()
    write(root, "src/old-name.txt", "one\n")
    commit(root, "add old name")
    git(root, ["mv", "src/old-name.txt", "src/new-name.txt"])
    commit(root, "rename value")
    write(root, "src/new-name.txt", "one\ntwo\n")
    commit(root, "change new name")

    const followed = history(root, [
      "--path", "src/new-name.txt",
      "--follow",
      "--max-count", "10",
      "--format", "json",
    ])

    expect(followed.status).toBe(0)
    const output = JSON.parse(followed.stdout)
    expect(output.commits.map((item: { subject: string }) => item.subject)).toEqual([
      "change new name",
      "rename value",
      "add old name",
    ])
    expect(output.commits[1].files).toEqual([{
      path: "src/new-name.txt",
      old_path: "src/old-name.txt",
      additions: 0,
      deletions: 0,
      binary: false,
    }])

    const directory = history(root, [
      "--path", "src",
      "--follow",
      "--format", "json",
    ])
    expect(directory.status).not.toBe(0)
    expect(directory.stderr).toContain("--follow requires a file path")
  })

  test("bounds emitted file records while retaining commit totals and binary signals", () => {
    const root = createRepository()
    write(root, "files/a.txt", "a\n")
    write(root, "files/b.txt", "b\n")
    writeFile(root, "files/data.bin", new Uint8Array([0, 1, 2, 3]))
    commit(root, "add files")
    write(root, "files/a.txt", "a\nchanged\n")
    write(root, "files/b.txt", "b\nchanged\n")
    writeFile(root, "files/data.bin", new Uint8Array([0, 1, 4, 3]))
    commit(root, "change files")

    const result = history(root, [
      "--path", "files",
      "--max-count", "1",
      "--max-files", "1",
      "--format", "json",
    ])

    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.files_truncated).toBe(true)
    expect(output.commits[0]).toMatchObject({
      file_count: 3,
      binary_files: 1,
      files_truncated: true,
    })
    expect(output.commits[0].files).toHaveLength(1)
  })
})

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "git-path-history-"))
  temporaryRepositories.push(root)
  git(root, ["init", "--quiet"])
  return root
}

function write(root: string, path: string, content: string): void {
  writeFile(root, path, content)
}

function writeFile(root: string, path: string, content: string | Uint8Array): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function commit(root: string, message: string): string {
  git(root, ["add", "."])
  git(root, [
    "-c", "user.name=Test",
    "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "-m", message,
  ])
  return git(root, ["rev-parse", "HEAD"]).trim()
}

function history(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([python, helperPath, ...args], {
    cwd,
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
