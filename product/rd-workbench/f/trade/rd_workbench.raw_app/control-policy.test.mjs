import assert from "node:assert/strict"
import test from "node:test"

import { actionControls } from "./control-policy.mjs"

test("only an unsubmitted request can be submitted", () => {
  assert.deepEqual(actionControls(null), {
    canSubmit: true,
    canResolve: false,
    canCreateSuccessor: false,
  })
})

test("unknown and identity conflict permit only same-identity resolution", () => {
  for (const nextAction of ["RESOLVE_SAME_REQUEST_IDENTITY"]) {
    assert.deepEqual(actionControls(nextAction), {
      canSubmit: false,
      canResolve: true,
      canCreateSuccessor: false,
    })
  }
})

test("rejection permits only creating a successor identity", () => {
  assert.deepEqual(actionControls("CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST"), {
    canSubmit: false,
    canResolve: false,
    canCreateSuccessor: true,
  })
})

test("acceptance and unrecognized actions expose no mutation", () => {
  for (const nextAction of ["WAIT_FOR_R_AND_D_EXECUTION", "UNRECOGNIZED"]) {
    assert.deepEqual(actionControls(nextAction), {
      canSubmit: false,
      canResolve: false,
      canCreateSuccessor: false,
    })
  }
})
