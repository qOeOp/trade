import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { basePath, docsRoute, parentNavigationRoute } from './lib/docs-routes.mjs';
import { PUBLISHED_DOC_ROOTS } from './lib/publication-contract.mjs';
import { routeRelativeMarkdownLinks } from './prepare-content.mjs';
import {
  containsNavigationHref,
  internalDocumentRoutes,
  navigationMarkup,
  PUBLISHED_DOC_ROOTS as NAVIGATION_PUBLISHED_DOC_ROOTS,
} from './lib/static-navigation.mjs';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.mjs')) files.push(path);
  }
  return files;
}

const homeRoute = '/trade/zh/';
const childRoute = '/trade/zh/docs/owners/risk/';

test('rewrites leaf-page links without treating a mixed fence marker as a close', () => {
  const source = [
    '```text',
    '~~~',
    '[fenced](../owners/risk/)',
    '```',
    '[body](../owners/risk/)',
  ].join('\n');
  const expected = [
    '```text',
    '~~~',
    '[fenced](../owners/risk/)',
    '```',
    '[body](../../owners/risk/)',
  ].join('\n');

  assert.equal(routeRelativeMarkdownLinks(source, 'guide/install'), expected);
});

test('preserves index-page links and links inside a matching tilde fence', () => {
  const source = ['~~~~', '[fenced](./risk/)', '```', '~~~~', '[body](./risk/)'].join('\n');
  assert.equal(routeRelativeMarkdownLinks(source, 'owners/index'), source);
  assert.equal(
    routeRelativeMarkdownLinks(source, 'owners/runtime'),
    ['~~~~', '[fenced](./risk/)', '```', '~~~~', '[body](../risk/)'].join('\n'),
  );
});

test('preserves links in blockquote and list fences while rewriting body links', () => {
  const source = [
    '> ```md',
    '> [quoted](../owners/risk/)',
    '> ```',
    '',
    '- ```md',
    '  [listed](../owners/risk/)',
    '  ```',
    '',
    '[body](../owners/risk/)',
  ].join('\n');
  const expected = [
    '> ```md',
    '> [quoted](../owners/risk/)',
    '> ```',
    '',
    '- ```md',
    '  [listed](../owners/risk/)',
    '  ```',
    '',
    '[body](../../owners/risk/)',
  ].join('\n');

  assert.equal(routeRelativeMarkdownLinks(source, 'guide/install'), expected);
});

test('rejects a docs link that exists only outside the Fumadocs sidebar', () => {
  const body = `<aside id="nd-sidebar"><a href="/other/">Other</a></aside><script>${childRoute}</script>`;
  const markup = navigationMarkup({
    body,
    parentRoute: '/trade/zh/docs/owners/',
    localeHomeRoute: homeRoute,
  });
  assert.equal(containsNavigationHref(markup, childRoute), false);
});

test('rejects href-shaped script text inside the Fumadocs sidebar', () => {
  const body = `<aside id="nd-sidebar"><script>const marker = 'href="${childRoute}"';</script></aside>`;
  const markup = navigationMarkup({
    body,
    parentRoute: '/trade/zh/docs/owners/',
    localeHomeRoute: homeRoute,
  });
  assert.equal(containsNavigationHref(markup, childRoute), false);
});

test('rejects hidden and inert anchors', () => {
  for (const attribute of [
    'hidden',
    'inert',
    'aria-hidden="true"',
    'disabled',
    'aria-disabled="true"',
  ]) {
    const body = `<aside id="nd-sidebar"><div ${attribute}><a href="${childRoute}">Hidden</a></div></aside>`;
    const markup = navigationMarkup({
      body,
      parentRoute: '/trade/zh/docs/owners/',
      localeHomeRoute: homeRoute,
    });
    assert.equal(containsNavigationHref(markup, childRoute), false);
  }
});

test('rejects anchors hidden by common CSS mechanisms', () => {
  for (const attribute of [
    'class="hidden"',
    'class="invisible"',
    'style="display: none"',
    'style="visibility: hidden"',
    'style="opacity: 0"',
    'style="pointer-events: none"',
    'class="pointer-events-none"',
    'style="position: fixed; left: -10000px"',
    'style="clip: rect(0, 0, 0, 0)"',
    'style="clip-path: inset(50%)"',
    'style="overflow: hidden; width: 0; height: 0"',
  ]) {
    const body = `<aside id="nd-sidebar"><div ${attribute}><a href="${childRoute}">Hidden</a></div></aside>`;
    const markup = navigationMarkup({
      body,
      parentRoute: '/trade/zh/docs/owners/',
      localeHomeRoute: homeRoute,
    });
    assert.equal(containsNavigationHref(markup, childRoute), false);
  }
});

test('accepts a docs link inside the Fumadocs sidebar', () => {
  const body = `<aside id="nd-sidebar"><a href="${childRoute}">Accounting</a></aside>`;
  const markup = navigationMarkup({
    body,
    parentRoute: '/trade/zh/docs/owners/',
    localeHomeRoute: homeRoute,
  });
  assert.equal(containsNavigationHref(markup, childRoute), true);
});

test('checks the visible header CTA for the first product guide', () => {
  const sectionRoute = '/trade/zh/docs/guide/';
  const body = `<body><header><a href="${sectionRoute}">Guide</a></header><main></main><script></script></body>`;
  const markup = navigationMarkup({ body, parentRoute: homeRoute, localeHomeRoute: homeRoute });
  assert.equal(containsNavigationHref(markup, sectionRoute), true);
});

test('checks sibling top-level sections from the first docs sidebar', () => {
  assert.equal(
    parentNavigationRoute('zh', 'owners/index.md'),
    '/trade/zh/docs/guide/',
  );
  assert.equal(
    parentNavigationRoute('zh', 'guide/index.md'),
    '/trade/zh/',
  );
});

test('rejects a guide child linked only from the page body when the persistent sidebar is missing', () => {
  const parentRoute = '/trade/en/docs/guide/';
  const childRoute = '/trade/en/docs/guide/quickstart/';
  const body = '<body><main><a href="./quickstart">Quickstart</a></main></body>';
  const markup = navigationMarkup({
    body,
    parentRoute,
    localeHomeRoute: '/trade/en/',
    childRoute,
  });

  assert.equal(markup, null);
  assert.equal(containsNavigationHref(markup, childRoute, parentRoute), false);
});

test('accepts top-level product sections from the Guide index body', () => {
  const parentRoute = '/trade/en/docs/guide/';
  const sectionRoute = '/trade/en/docs/architecture/';
  const body = '<body><article id="nd-page"><a href="../architecture/">Architecture</a></article></body>';
  const markup = navigationMarkup({
    body,
    parentRoute,
    localeHomeRoute: '/trade/en/',
    childRoute: sectionRoute,
  });

  assert.equal(containsNavigationHref(markup, sectionRoute, parentRoute), true);
});

test('locks the normative publication to one four-root authority', async () => {
  assert.equal(PUBLISHED_DOC_ROOTS.join(','), 'guide,architecture,owners,scenarios');
  assert.equal(NAVIGATION_PUBLISHED_DOC_ROOTS, PUBLISHED_DOC_ROOTS);

  const authority = join(scriptsRoot, 'lib', 'publication-contract.mjs');
  const duplicateRootLiteral = /\[\s*['"]guide['"]\s*,\s*['"]architecture['"]\s*,\s*['"]owners['"]\s*,\s*['"]scenarios['"]\s*,?\s*\]/s;
  for (const path of await sourceFiles(scriptsRoot)) {
    if (path === authority) continue;
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(
      source,
      duplicateRootLiteral,
      `${relative(scriptsRoot, path)} duplicates the publication root literal`,
    );
  }
});

test('resolves relative body links against the current exported route', () => {
  const markup = '<body><a href="../runtime">Runtime</a><a href="#facts">Facts</a><a href="https://example.com/">External</a></body>';

  assert.deepEqual(
    internalDocumentRoutes(markup, '/trade/en/docs/owners/risk/', '/trade').sort(),
    ['/trade/en/docs/owners/risk/', '/trade/en/docs/owners/runtime'].sort(),
  );
});

test('accepts base-path-qualified Flow detail links and rejects root bypasses', () => {
  const nodeRoute = docsRoute('zh', 'owners/rd.md');
  const relationRoute = docsRoute('zh', 'scenarios/research.md');
  const qualified = `<a href="${nodeRoute}">Node docs</a><a href="${relationRoute}">Relation docs</a>`;
  const bypassed = '<a href="/zh/docs/owners/rd/">Node bypass</a><a href="/zh/docs/scenarios/research/">Relation bypass</a>';

  assert.deepEqual(
    internalDocumentRoutes(qualified, '/trade/zh/', basePath).sort(),
    [nodeRoute, relationRoute].sort(),
  );
  assert.deepEqual(internalDocumentRoutes(bypassed, '/trade/zh/', basePath), []);
});
