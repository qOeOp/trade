import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entries, groups } from './lib/docs-entries.mjs';
import { chapterSource } from './lib/docs-pages.mjs';
import { buildRdIndex } from './lib/rd-index.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
const outputRoot = join(siteRoot, 'content', 'docs');
const description = { en: 'The research chain: candidates, registered hypotheses, comparison evidence and the trust boundaries enforced in code', zh: '研发长链：候选、登记的假设、比较证据与代码强制的信任边界' };

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const [slug, source, englishTitle, chineseTitle] of entries) {
  for (const [locale, suffix, title] of [['en', '', englishTitle], ['zh', '.zh', chineseTitle]]) {
    // Chapters are authored as MDX (components for capabilities, references and tables); plain Markdown still works.
    const { markdown } = await chapterSource(join(repositoryRoot, 'docs'), source, locale);
    const heading = markdown.match(/^# (.+)\r?\n/);
    const content = markdown.replace(/^# .+\r?\n/, '');
    // Page description: the half-sentence after the colon in the chapter heading, else the site description.
    const subtitle = heading ? heading[1].split(/[：:]\s*/).slice(1).join(': ').trim() : '';
    await writeFile(join(outputRoot, `${slug}${suffix}.mdx`), `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(subtitle || description[locale])}\n---\n\n${content}`);
  }
}
// The sidebar is docsTree (lib/source.ts); meta.json only names the root.
await writeFile(join(outputRoot, 'meta.json'), JSON.stringify({ title: 'Research Chain' }));
await writeFile(join(outputRoot, 'meta.zh.json'), JSON.stringify({ title: '研发长链' }));
// Definition index for <Ref> hover previews, built from the chapter sources; a dangling ref or a duplicate id fails here.
const index = await buildRdIndex(entries, join(repositoryRoot, 'docs'));
await mkdir(join(siteRoot, 'lib', 'generated'), { recursive: true });
await writeFile(join(siteRoot, 'lib', 'generated', 'rd-index.json'), JSON.stringify(index));
await writeFile(join(siteRoot, 'lib', 'generated', 'rd-groups.json'), JSON.stringify(groups));
await copyFile(join(repositoryRoot, 'docs', 'rd', 'entries.json'), join(siteRoot, 'lib', 'generated', 'rd-entries.json'));
await copyFile(join(repositoryRoot, 'docs', 'assets', 'icon.svg'), join(siteRoot, 'public', 'icon.svg'));
await copyFile(join(repositoryRoot, 'docs', 'assets', 'icon-dark.svg'), join(siteRoot, 'public', 'icon-dark.svg'));
// The trade IDE's faces (ide/web/fonts): PP Supply Mono served beside the pages, and HarmonyOS Sans SC's
// unicode-range slices on jsDelivr at the IDE's pinned version, so a browser fetches only the slices on screen.
const ideFonts = join(repositoryRoot, 'ide', 'web', 'fonts');
await mkdir(join(siteRoot, 'public', 'fonts'), { recursive: true });
for (const weight of ['Regular', 'Medium', 'Bold']) {
  await copyFile(join(ideFonts, `Supply-${weight}.otf`), join(siteRoot, 'public', 'fonts', `Supply-${weight}.otf`));
}
const harmony = 'https://cdn.jsdelivr.net/npm/harmonyos-sans-sc-webfont-splitted@1.1.0/dist/';
const harmonyFaces = [];
for (const [name, range] of [['Regular', '100 449'], ['Medium', '450 900']]) {
  const css = await readFile(join(ideFonts, 'harmonyos-sans-sc', `${name}.css`), 'utf8');
  for (const [, slice, unicodes] of css.matchAll(/url\("\.\/([^"]+\.woff2)"\)[^;]*;[\s\S]*?unicode-range:([^;]+);/g)) {
    harmonyFaces.push(`@font-face{font-family:"HarmonyOS Sans SC";font-style:normal;font-weight:${range};font-display:swap;size-adjust:96%;src:url("${harmony}${slice}") format("woff2");unicode-range:${unicodes};}`);
  }
}
if (!harmonyFaces.length) throw new Error('No HarmonyOS Sans SC slices found');
await writeFile(join(siteRoot, 'lib', 'generated', 'harmonyos-sans-sc.css'), `${harmonyFaces.join('\n')}\n`);
console.log(`Prepared ${entries.length} bilingual chapters and ${Object.keys(index.zh).length} index entries.`);
