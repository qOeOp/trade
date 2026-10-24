# This directory is a working copy of candidate <strategy_id@revision>

- The source here is not a record. It becomes a new candidate only through `candidate publish`; the working copy can be deleted at any time.
- Before editing, read the 27 duty stances in the file header; change only the duty lines this change touches, and register their ids in changed_duties.
- The header format is in strategy-header.md beside this file; when unsure of a stance, read research-round's references/duty-directory.md.
- Every rule and parameter lives in the source; trading facts come only from engine state; decisions use only closed information.
- Next: `candidate publish` → `replay precheck` → `source review` by an independent reviewer → `registration add` → `replay run`.
- When a command refuses, complete what its next_actions name and continue; never bypass it.
