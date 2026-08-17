import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLISHED_DOC_ROOTS } from './publication-contract.mjs';

export const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const repositoryRoot = resolve(siteRoot, '..');
export const docsRoot = join(repositoryRoot, 'docs');

const publishedRoots = new Set(PUBLISHED_DOC_ROOTS);
const toPosix = (path) => path.split(sep).join('/');

async function findFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = toPosix(relative(docsRoot, path));
    if (entry.isDirectory()) {
      if (publishedRoots.has(relativePath.split('/')[0])) files.push(...(await findFiles(path)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

export async function publishedPages() {
  const english = new Set();
  const chinese = new Set();
  for (const path of await findFiles(docsRoot)) {
    if (path.endsWith('.zh.md')) chinese.add(path.replace(/\.zh\.md$/, '.md'));
    else if (path.endsWith('.md')) english.add(path);
    else if (path.endsWith('.py')) {
      const source = await readFile(join(docsRoot, path), 'utf8');
      if (source.startsWith('# %%')) english.add(path.replace(/\.py$/, '.md'));
    }
  }
  return { english, chinese };
}
