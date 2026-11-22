# Accessibility

The IDE (`ide/web`) is used in desktop and phone browsers by its operator and a few trusted people. It has not
been audited against WCAG and claims no conformance level. This page says what is in place and what is known to
be missing.

## In place

- **Keyboard.** Commands have shortcuts shown as the platform writes them (⌘K or Ctrl+K opens the command palette;
  ⌥T focuses the main toolbar; ⌘B, ⌘J and ⇧Esc toggle tool windows). Controls are native buttons or Radix
  primitives, every focusable element shows a focus ring (`:focus-visible`), run rows and calendar days open
  with Enter, and the source tree, run menus and the research scatter plot move with the arrow keys.
- **Names and states.** Icon-only controls carry `aria-label`; toggles, tabs, radio groups and listboxes carry
  their roles and `aria-pressed`, `aria-selected` or `aria-checked`; status and error lines are `role="status"`
  or `role="alert"`. The page declares `lang="en"`.
- **Themes and colour.** Light, dark or the system's choice. The four data colours are validated per theme for
  colour-vision separation and at least 3:1 contrast, and `npm run check` refuses a change to them unless its own
  validated set changes with it.
- **Motion and zoom.** Animations stop under `prefers-reduced-motion`. The page's viewport does not disable
  browser zoom.

## Known limits

- Price, equity and lineage charts are drawn on canvas or SVG; a screen reader gets at most their label, not
  their data.
  The same numbers are in the run tables and the command line's JSON output.
- No screen-reader pass (VoiceOver, NVDA) has been made over whole flows.
- The interface is English only.
- The phone layout covers urgent use (key numbers and single actions), not every desktop page.

## Report a barrier

Open an issue with the bug report template: the page, the browser and assistive technology, what you tried and
what blocked you.
