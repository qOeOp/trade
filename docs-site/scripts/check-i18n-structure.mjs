import { access, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { publishedPages, siteRoot } from './lib/docs-pages.mjs';
import { protectedMarkdownSkeleton } from './lib/markdown-skeleton.mjs';
import { mermaidSkeleton } from './lib/mermaid-skeleton.mjs';

const contentRoot = join(siteRoot, 'content', 'docs');

async function existingGeneratedPageCandidates(path, locale = 'en') {
  const stem = path.replace(/\.md$/, '');
  const localizedStem = locale === 'zh' ? `${stem}.zh` : stem;
  const candidates = [`${localizedStem}.md`, `${localizedStem}.mdx`];
  const existing = [];
  for (const candidate of candidates) {
    try {
      await access(join(contentRoot, candidate));
      existing.push(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { candidates, existing };
}

async function resolveGeneratedPair(path) {
  const [englishResult, chineseResult] = await Promise.all([
    existingGeneratedPageCandidates(path),
    existingGeneratedPageCandidates(path, 'zh'),
  ]);
  if (englishResult.existing.length !== 1) {
    throw new Error(
      `${path}: expected exactly one generated English page (${englishResult.candidates.join(' or ')}), found ${englishResult.existing.length}`,
    );
  }
  if (chineseResult.existing.length !== 1) {
    throw new Error(
      `${path}: expected exactly one generated Chinese page (${chineseResult.candidates.join(' or ')}), found ${chineseResult.existing.length}`,
    );
  }
  const englishPath = englishResult.existing[0];
  const chinesePath = chineseResult.existing[0];
  if (extname(englishPath) !== extname(chinesePath)) {
    throw new Error(
      `${path}: generated English/Chinese extensions differ (${englishPath} versus ${chinesePath})`,
    );
  }
  return { englishPath, chinesePath };
}

function matches(source, expression, map = (match) => match[0]) {
  return [...source.matchAll(expression)].map(map);
}

function fencedCode(source) {
  return matches(source, /^(?<fence>`{3,}|~{3,})(?<info>[^\n]*)\n[\s\S]*?^\k<fence>[ \t]*$/gm)
    .filter((block) => !/^\s*(?:`{3,}|~{3,})mermaid(?:\s|$)/.test(block));
}

function inlineCode(source) {
  const prose = source.replace(/^(?<fence>`{3,}|~{3,})[^\n]*\n[\s\S]*?^\k<fence>[ \t]*$/gm, '');
  return matches(prose, /(?<!`)`([^`]+)`(?!`)/g, (match) => {
    const value = match[1].replace(/\s+/g, ' ').trim();
    return `\`${value}\``;
  }).sort();
}

function strongEmphasis(source) {
  const prose = source
    .replace(/^(?<fence>`{3,}|~{3,})[^\n]*\n[\s\S]*?^\k<fence>[ \t]*$/gm, '')
    .replace(/(?<!`)`([^`]+)`(?!`)/g, '');
  return matches(prose, /(?<!\*)\*\*(?!\*)|(?<!_)__(?!_)/g);
}

function linkTargets(source) {
  const inline = matches(
    source,
    /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gm,
    (match) => match[1],
  );
  const definitions = matches(source, /^\[[^\]]+\]:\s+(\S+)/gm, (match) => match[1]);
  const attributes = matches(
    source,
    /\b(?:href|src)\s*=\s*(?:["']([^"']+)["']|\{["']([^"']+)["']\})/gm,
    (match) => match[1] ?? match[2],
  );
  return [...inline, ...definitions, ...attributes]
    .map((target) => target.startsWith('#') ? '#<localized-heading>' : target)
    .sort();
}

function headingLevels(source) {
  return matches(source, /^(#{1,6})\s+/gm, (match) => match[1].length);
}

function directives(source) {
  return matches(source, /^(:{3,})([A-Za-z][\w-]*)?/gm, (match) => [match[1].length, match[2] ?? '']);
}

function tableShape(source) {
  return source
    .split('\n')
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) => matches(line, /(?<!\\)\|/g).length);
}

function htmlTags(source) {
  return matches(source, /<(\/)?([A-Za-z][\w-]*)\b/gm, (match) => [match[1] ?? '', match[2]]);
}

function listMarkers(source) {
  return matches(source, /^([ \t]*)([-+*]|\d+[.)])[ \t]+/gm, (match) => [
    match[1].length,
    /^\d/.test(match[2]) ? 'ordered' : 'unordered',
  ]);
}

const extractors = {
  'protected Markdown skeleton': (source) => [protectedMarkdownSkeleton(source)],
  'Mermaid diagram structure': mermaidSkeleton,
  'fenced code': fencedCode,
  'inline code': inlineCode,
  'strong emphasis': strongEmphasis,
  'link targets': linkTargets,
  'heading levels': headingLevels,
  directives,
  'table shape': tableShape,
  'HTML tags': htmlTags,
  'list markers': listMarkers,
};

const { english, chinese } = await publishedPages();
const missing = [...english].filter((path) => !chinese.has(path)).sort();
const availableOnly = process.argv.includes('--available-only');
const requestedPathIndex = process.argv.indexOf('--path');
const requestedPath = requestedPathIndex >= 0 ? process.argv[requestedPathIndex + 1] : undefined;
if (requestedPathIndex >= 0 && !requestedPath) {
  throw new Error('Expected an English document path after --path.');
}
if (requestedPath && !english.has(requestedPath)) {
  throw new Error(`Unknown published English document path: ${requestedPath}`);
}
if (missing.length > 0 && !availableOnly && !requestedPath) {
  throw new Error(`Cannot check translation structure with missing Chinese pages:\n${missing.join('\n')}`);
}

const failures = [];
const checkedPaths = (requestedPath ? [requestedPath] : [...english])
  .filter((path) => chinese.has(path))
  .sort();
if (requestedPath && checkedPaths.length === 0) {
  throw new Error(`Chinese translation is missing for: ${requestedPath}`);
}
for (const path of checkedPaths) {
  const { englishPath, chinesePath } = await resolveGeneratedPair(path);
  const [englishSource, chineseSource] = await Promise.all([
    readFile(join(contentRoot, englishPath), 'utf8'),
    readFile(join(contentRoot, chinesePath), 'utf8'),
  ]);

  const leakedPlaceholders = matches(chineseSource, /\bXQZTK\d+ZQX\b/g);
  if (leakedPlaceholders.length > 0) {
    failures.push(`${path}: leaked ${leakedPlaceholders.length} translation placeholder token(s)`);
  }

  for (const [label, extract] of Object.entries(extractors)) {
    const expected = extract(englishSource);
    const actual = extract(chineseSource);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${path}: ${label} changed (English ${expected.length}, Chinese ${actual.length})`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Chinese translations changed protected Markdown structure:\n${failures.join('\n')}`);
}

console.log(`Translation structure check passed for ${checkedPaths.length} English/Chinese page pairs.`);
if (availableOnly && missing.length > 0) {
  console.log(`Skipped ${missing.length} English pages whose Chinese peers are not present yet.`);
}
