import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publishedPages, repositoryRoot, siteRoot } from './lib/docs-pages.mjs';
import { findUnpairedChangedDocuments } from './lib/i18n-sync.mjs';

const baselinePath = join(siteRoot, 'i18n-baseline.json');
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right));

function parseBaseline(source, label) {
  const value = JSON.parse(source);
  if (value.schemaVersion !== 1 || !Array.isArray(value.untranslated)) {
    throw new Error(`${label} must use schemaVersion 1 with an untranslated array`);
  }
  if (value.untranslated.some((path) => typeof path !== 'string')) {
    throw new Error(`${label} contains a non-string path`);
  }
  const normalized = sorted(new Set(value.untranslated));
  if (JSON.stringify(normalized) !== JSON.stringify(value.untranslated)) {
    throw new Error(`${label} must contain unique, sorted paths`);
  }
  return normalized;
}

function readBaseSha() {
  let value = process.env.DOCS_I18N_BASE_SHA?.trim();
  if (!value) {
    try {
      value = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error(
        'Cannot derive the localization base from origin/main; fetch it or set DOCS_I18N_BASE_SHA.',
      );
    }
  }
  if (!/^[0-9a-f]{40}$/.test(value) || /^0+$/.test(value)) {
    throw new Error(`DOCS_I18N_BASE_SHA must be a non-zero 40-character commit SHA: ${value}`);
  }
  execFileSync('git', ['cat-file', '-e', `${value}^{commit}`], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  });
  return value;
}

function readGitFile(revision, path) {
  try {
    return execFileSync('git', ['show', `${revision}:${path}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const { english, chinese } = await publishedPages();
const orphaned = sorted([...chinese].filter((path) => !english.has(path)));
if (orphaned.length > 0) {
  throw new Error(`Chinese documents without an English source:\n${orphaned.join('\n')}`);
}
const missing = sorted([...english].filter((path) => !chinese.has(path)));

if (process.argv.includes('--write-baseline')) {
  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        description:
          'Existing English pages without Chinese translations. This list may shrink but must not grow.',
        untranslated: missing,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote localization baseline with ${missing.length} untranslated pages.`);
  process.exit(0);
}

let baseline;
try {
  baseline = parseBaseline(await readFile(baselinePath, 'utf8'), 'localization baseline');
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error('Missing localization baseline; run npm run check:i18n -- --write-baseline');
  }
  throw error;
}

if (JSON.stringify(missing) !== JSON.stringify(baseline)) {
  const baselineSet = new Set(baseline);
  const missingSet = new Set(missing);
  const added = missing.filter((path) => !baselineSet.has(path));
  const resolved = baseline.filter((path) => !missingSet.has(path));
  throw new Error(
    [
      'Localization baseline does not match current documents.',
      added.length > 0 ? `New untranslated pages:\n${added.join('\n')}` : '',
      resolved.length > 0 ? `Resolved pages still in baseline:\n${resolved.join('\n')}` : '',
      'Add or update the Chinese document; regenerate the baseline only to remove entries.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
}

const baseSha = readBaseSha();
const baseSource = readGitFile(baseSha, 'docs-site/i18n-baseline.json');
if (baseSource) {
  const baseBaseline = new Set(parseBaseline(baseSource, 'base localization baseline'));
  const growth = baseline.filter((path) => !baseBaseline.has(path));
  if (growth.length > 0) throw new Error(`Localization debt must not grow:\n${growth.join('\n')}`);
}

const changedOutput = execFileSync('git', ['diff', '--name-only', baseSha, '--', 'docs'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
const untrackedOutput = execFileSync(
  'git',
  ['ls-files', '--others', '--exclude-standard', '--', 'docs'],
  { cwd: repositoryRoot, encoding: 'utf8' },
);
const changed = new Set(`${changedOutput}\n${untrackedOutput}`.split('\n').filter(Boolean));
const unpairedChanges = findUnpairedChangedDocuments({ changed, english, chinese });
if (unpairedChanges.length > 0) {
  throw new Error(
    `English documents changed without a corresponding Chinese file change:\n${unpairedChanges.join('\n')}`,
  );
}

console.log(
  `Localization check passed: ${english.size} English, ${chinese.size} Chinese, ${missing.length} baseline untranslated pages.`,
);
