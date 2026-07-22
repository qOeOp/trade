import { expect, test } from "bun:test"
import { maybeUpdateRdProgramState } from "./rd-loop-runner"

test("loop execution leaves program state untouched when no program is bound", () => {
  expect(maybeUpdateRdProgramState(undefined, undefined, "data/catalog.db", {}, "2026-01-01T00:00:00Z"))
    .toBeUndefined()
})
