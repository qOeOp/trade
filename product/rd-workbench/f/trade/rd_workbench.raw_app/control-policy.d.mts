export type ActionControls = {
  canSubmit: boolean
  canResolve: boolean
  canCreateSuccessor: boolean
}

export function actionControls(nextLegalAction: string | null): ActionControls
