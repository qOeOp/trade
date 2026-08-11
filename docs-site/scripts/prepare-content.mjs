import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
const sourceRoot = join(repositoryRoot, 'docs');
const targetRoot = join(siteRoot, 'content', 'docs');
const sourceIcon = join(repositoryRoot, 'icon.svg');
const targetIcon = join(siteRoot, 'public', 'icon.svg');
const targetDarkIcon = join(siteRoot, 'public', 'icon-dark.svg');

async function findJupytextPages(directory) {
  const pages = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await findJupytextPages(path)));
    } else if (entry.name.endsWith('.py')) {
      const source = await readFile(path, 'utf8');
      if (source.startsWith('# %%')) pages.push(path);
    }
  }

  return pages.sort();
}

async function findMarkdownPages(directory) {
  const pages = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await findMarkdownPages(path)));
    } else if (entry.name.endsWith('.md')) {
      pages.push(path);
    }
  }

  return pages.sort();
}

function titleFromHeading(heading) {
  return heading
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

async function addFrontmatter(path) {
  const source = await readFile(path, 'utf8');
  if (source.startsWith('---\n')) return;

  const heading = source.match(/^#\s+(.+)$/m);
  if (!heading || heading.index === undefined) {
    throw new Error(`No level-one heading found in ${relative(targetRoot, path)}`);
  }

  const title = titleFromHeading(heading[1]);
  const body = `${source.slice(0, heading.index)}${source.slice(heading.index + heading[0].length)}`
    .replace(/^\n+/, '')
    .trimEnd();
  await writeFile(path, `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}\n`);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

await rm(targetRoot, { recursive: true, force: true });
await mkdir(dirname(targetRoot), { recursive: true });
await cp(sourceRoot, targetRoot, {
  recursive: true,
  filter: (path) => !['api_reference', 'dev_templates'].includes(relative(sourceRoot, path)),
});
await cp(sourceIcon, targetIcon);
const lightIcon = await readFile(sourceIcon, 'utf8');
const darkIcon = lightIcon.replace('fill="#111111"', 'fill="#ffffff"');
if (darkIcon === lightIcon) throw new Error('Icon dark-mode color token was not found');
await writeFile(targetDarkIcon, darkIcon);

const pages = await findJupytextPages(sourceRoot);
for (const sourcePath of pages) {
  const relativePath = relative(sourceRoot, sourcePath).replace(/\.py$/, '.md');
  const outputPath = join(targetRoot, relativePath);
  await mkdir(dirname(outputPath), { recursive: true });

  const result = spawnSync(
    'uvx',
    ['--from', 'jupytext==1.19.5', 'jupytext', '--to', 'md', '--output', outputPath, sourcePath],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`Jupytext conversion failed for ${relativePath}`);
  }
}

const markdownPages = await findMarkdownPages(targetRoot);
for (const page of markdownPages) await addFrontmatter(page);

await writeJson(join(targetRoot, 'meta.json'), {
  title: 'Vibe Trader Documentation',
  pages: [
    'getting_started',
    'concepts',
    'how_to',
    'tutorials',
    'integrations',
    'developer_guide',
  ],
});
await writeJson(join(targetRoot, 'meta.zh.json'), {
  title: 'Vibe Trader 文档',
  pages: [
    'getting_started',
    'concepts',
    'how_to',
    'tutorials',
    'integrations',
    'developer_guide',
  ],
});
await writeJson(join(targetRoot, 'getting_started', 'meta.zh.json'), {
  title: '入门',
  pages: ['...'],
});
await writeJson(join(targetRoot, 'concepts', 'meta.zh.json'), {
  title: '核心概念',
  pages: ['...'],
});
await writeJson(join(targetRoot, 'how_to', 'meta.zh.json'), {
  title: '操作指南',
  pages: ['...'],
});
await writeJson(join(targetRoot, 'tutorials', 'meta.zh.json'), {
  title: '教程',
  pages: ['...'],
});
await writeJson(join(targetRoot, 'integrations', 'meta.zh.json'), {
  title: '集成',
  pages: ['...'],
});
await writeJson(join(targetRoot, 'developer_guide', 'meta.zh.json'), {
  title: '开发者指南',
  pages: ['...'],
});

console.log(
  `Prepared ${markdownPages.length} docs pages, including ${pages.length} Jupytext pages.`,
);
