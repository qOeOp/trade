# Icons

The icons are [Lucide](https://lucide.dev)'s, from the npm package `lucide-static` (the exact version is pinned in
`package.json` and `package-lock.json`); `registry.ts` imports each SVG from it by name.

- Copyright © Lucide Icons and Contributors, ISC License; the icons Lucide derives from Feather are
  Copyright © 2013-present Cole Bemis, MIT License. Both texts are in `LICENSE` here, copied from the package.
- The page draws them in the text colour with thin strokes (`Icon.tsx`); the paths are unchanged.

To add one: find it on lucide.dev, import `lucide-static/icons/<name>.svg?raw` in `registry.ts` under the page's
own name for it, and use that name.
