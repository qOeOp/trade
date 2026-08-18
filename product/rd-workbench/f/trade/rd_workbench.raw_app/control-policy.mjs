/**
 * Project the Owner's single next legal action into the App's controls.
 * Unknown values fail closed: they expose no mutating action.
 */
export function actionControls(nextLegalAction) {
  return {
    canSubmit: nextLegalAction === null,
    canResolve: nextLegalAction === "RESOLVE_SAME_REQUEST_IDENTITY",
    canCreateSuccessor: nextLegalAction === "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
  }
}
