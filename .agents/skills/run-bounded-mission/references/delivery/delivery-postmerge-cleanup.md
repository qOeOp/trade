# Post-merge Cleanup

Cleanup is an irreversible-effect owner loaded only after an exact merged-head/tree readback and
separate authority for each target. Inventory exact remote branch, task/worktree, local branch, and
tag identities; never use globs, inferred names, broad deletion, or raw worktree removal.

| Target                | Owner and acceptance                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remote branch         | GitHub deletes the exact merged branch; changed or protected identity stops.                                                                                       |
| Managed task/worktree | The current app owner archives the exact terminal, unpinned task and confirms recoverability; dirty, active, permanent, unknown, or user-owned state is preserved. |
| Local branch          | Delete only the exact clean, fully merged ref outside its worktree; otherwise preserve.                                                                            |
| Main checkout         | Fast-forward only a clean authorized checkout to the exact canonical remote ref.                                                                                   |
| Tag                   | Preserve unless the user separately names the exact tag and deletion effect.                                                                                       |

Read back every issued effect. Report each row as `cleaned`, `already_equal`, `preserved`, `partial`, or
`unknown`, with its recovery locator. One failed row stops dependent rows and never widens authority.
