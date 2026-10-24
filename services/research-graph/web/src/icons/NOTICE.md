# Icons

The SVGs under `expui/` are from the IntelliJ Platform's New UI icon set:

- Source: [JetBrains/intellij-community](https://github.com/JetBrains/intellij-community), `platform/icons/src/expui`
- Commit: `b861a2178f97eb14e27a8c282a4ea71a3025faa4`
- Copyright © JetBrains s.r.o. and contributors; licensed under the Apache License 2.0 (`LICENSE` here).
- Kept byte for byte at their upstream paths; the page recolours them to the theme at render time.

To add one: download it from
`https://raw.githubusercontent.com/JetBrains/intellij-community/<commit>/platform/icons/src/expui/<path>` into the same path
here, register it in `registry.ts` and list it below. `scripts/check-rules.mjs` fails on unregistered or missing files.

Files:

- actions/checked.svg, actions/moveToBottomLeft.svg, actions/moveToRightTop.svg
- general/chevronDown.svg, general/chevronRight.svg, general/chevronUp.svg, general/close.svg, general/down.svg,
  general/remove.svg, general/search.svg, general/up.svg
- toolwindows/commit.svg, toolwindows/palette.svg
