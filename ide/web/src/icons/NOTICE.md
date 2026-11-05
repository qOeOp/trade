# Icons

Most icons are [Lucide](https://lucide.dev)'s, from the npm package `lucide-static` (the exact version is pinned in
`package.json` and `package-lock.json`); `registry.ts` imports each SVG from it by name.

- Copyright © Lucide Icons and Contributors, ISC License; the icons Lucide derives from Feather are
  Copyright © 2013-present Cole Bemis, MIT License. Both texts are in `LICENSE` here, copied from the package.
- The page draws them in the text colour with thin strokes (`Icon.tsx`); the paths are unchanged.

Where another open set draws a slot better, `registry.ts` carries that icon's geometry inline, unchanged, under a
comment naming its set and licence. Their licence texts are in `LICENSE` too:
[Tabler Icons](https://github.com/tabler/tabler-icons), [with icons](https://github.com/withevergrow/withicons) and
[iconsax-react](https://github.com/rendinjast/iconsax-react) (MIT); [Mage Icons](https://github.com/Mage-Icons/mage-icons)
(Apache-2.0); [System UIcons](https://github.com/CoreyGinnivan/system-uicons) (Unlicense).

The model providers' marks (DeepSeek, OpenAI, Anthropic) are [LobeHub](https://github.com/lobehub/lobe-icons)'s,
from the npm package `@lobehub/icons-static-svg` (pinned the same way); `brands.ts` imports them and `BrandMark` in
`Icon.tsx` fills them in the current colour, paths unchanged. Copyright © 2023 LobeHub, MIT License; the
package ships no licence file, so its text is in `LICENSE` here, copied from the project's repository. The marks themselves are their companies' trademarks;
the page shows them only to name the provider an agent uses.

The tooltip arrow (`TipArrow` in `marks.tsx`) is [Element Plus](https://element-plus.org)'s, its two paths copied from
Element Plus's design kit and filled with the page's tooltip colours. Copyright © 2020-present Element Plus, MIT License.

To add one: find it on lucide.dev, import `lucide-static/icons/<name>.svg?raw` in `registry.ts` under the page's
own name for it, and use that name. An icon from another set goes inline with its set and licence named, its
licence text in `LICENSE`, and `grid` set when it is not drawn on 24 units.
