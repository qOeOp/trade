import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { publishedPages } from './lib/docs-pages.mjs';
import { basePath, docsRoute, parentNavigationRoute } from './lib/docs-routes.mjs';
import { mermaidCharts } from './lib/mermaid-skeleton.mjs';

const execFileAsync = promisify(execFile);
const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = join(siteRoot, 'content', 'docs');
const outputRoot = join(siteRoot, 'out');
const browserTestPath = `${basePath}/__docs-browser-test/`;

function outputFile(locale, page) {
  let slug = page.replace(/\.md$/, '');
  if (slug === 'index') slug = '';
  else if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
  return join(outputRoot, locale, 'docs', slug, 'index.html');
}

function attribute(node, name) {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function staticMermaidMarkup(html) {
  const result = { charts: 0, loading: 0 };
  function visit(node) {
    if (attribute(node, 'data-mermaid-chart') === 'true') {
      result.charts += 1;
      if (attribute(node, 'data-mermaid-status') === 'loading') result.loading += 1;
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return result;
}

function browserTaskMarkup(html) {
  const result = {
    complete: false,
    visibilityGuard: 'missing',
    visibilityGuardError: '',
    tasks: 0,
    passed: 0,
    errors: 0,
    errorMessages: [],
  };
  function visit(node) {
    if (node.tagName === 'body') {
      if (attribute(node, 'data-browser-complete') === 'true') result.complete = true;
      result.visibilityGuard = attribute(node, 'data-browser-visibility-guard') ?? 'missing';
      result.visibilityGuardError = attribute(node, 'data-browser-visibility-error') ?? '';
    }
    if (attribute(node, 'data-browser-task')) {
      result.tasks += 1;
      const status = attribute(node, 'data-browser-status');
      if (status === 'passed') result.passed += 1;
      else if (status === 'error') {
        result.errors += 1;
        result.errorMessages.push(
          `${attribute(node, 'data-browser-task')}: ${attribute(node, 'data-browser-error') ?? 'unknown error'}`,
        );
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return result;
}

async function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known executable location.
    }
  }
  throw new Error('Chrome is required for browser consumer checks; set CHROME_BIN.');
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

async function staticTarget(pathname) {
  if (!pathname.startsWith(basePath)) return null;
  let relativePath = decodeURIComponent(pathname.slice(basePath.length)).replace(/^\/+/, '');
  if (relativePath.length === 0) relativePath = 'index.html';
  let target = resolve(outputRoot, relativePath);
  if (target !== outputRoot && !target.startsWith(`${outputRoot}${sep}`)) return null;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
    else if (!info.isFile()) return null;
  } catch {
    if (extname(target)) return null;
    try {
      target = `${target}.html`;
      if (!(await stat(target)).isFile()) return null;
    } catch {
      return null;
    }
  }
  return target;
}

function browserTestHtml(tasks) {
  const payload = JSON.stringify(tasks).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Documentation browser consumer check</title></head>
<body data-browser-complete="false">
<script>
const tasks = ${payload};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function visible(element) {
  for (let current = element; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView.getComputedStyle(current);
    if (
      current.hidden ||
      current.inert ||
      current.getAttribute('aria-hidden') === 'true' ||
      current.hasAttribute('disabled') ||
      current.getAttribute('aria-disabled') === 'true' ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number(style.opacity) === 0 ||
      (current === element && style.pointerEvents === 'none')
    ) return false;
  }

  element.scrollIntoView({ block: 'center', inline: 'center' });
  const view = element.ownerDocument.defaultView;
  const viewportWidth = view.document.documentElement.clientWidth;
  const viewportHeight = view.document.documentElement.clientHeight;
  for (const rect of element.getClientRects()) {
    const left = Math.max(0, rect.left);
    const right = Math.min(viewportWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(viewportHeight, rect.bottom);
    if (right <= left || bottom <= top) continue;
    const points = [
      [(left + right) / 2, (top + bottom) / 2],
      [left + 1, (top + bottom) / 2],
      [right - 1, (top + bottom) / 2],
      [(left + right) / 2, top + 1],
      [(left + right) / 2, bottom - 1],
    ];
    if (points.some(([x, y]) => {
      const hit = element.ownerDocument.elementFromPoint(x, y);
      return hit === element || (hit !== null && element.contains(hit));
    })) return true;
  }
  return false;
}

function verifyVisibilityOracle() {
  const fixture = document.createElement('div');
  fixture.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  document.body.append(fixture);
  const makeAnchor = (style, attributes = {}) => {
    const anchor = document.createElement('a');
    anchor.href = '#visibility-guard';
    anchor.textContent = 'visibility guard';
    anchor.style.cssText = 'position:fixed;display:block;width:120px;height:24px;pointer-events:auto;' + style;
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
    fixture.append(anchor);
    return anchor;
  };
  try {
    const cases = [
      ['visible', makeAnchor('left:10px;top:10px'), true],
      ['offscreen', makeAnchor('left:-10000px;top:10px'), false],
      ['clipped', makeAnchor('left:10px;top:40px;clip-path:inset(50%)'), false],
      ['zero-area', makeAnchor('left:10px;top:70px;width:0;height:0;overflow:hidden'), false],
      ['disabled', makeAnchor('left:10px;top:100px', { disabled: '' }), false],
    ];
    const failures = cases
      .filter(([, anchor, expected]) => visible(anchor) !== expected)
      .map(([name]) => name);
    if (failures.length > 0) throw new Error('visibility oracle accepted/rejected: ' + failures.join(', '));
  } finally {
    fixture.remove();
  }
}

function inspect(task, document) {
  const problems = [];
  let waiting = false;
  if (task.mermaidCount > 0) {
    const charts = [...document.querySelectorAll('[data-mermaid-chart="true"]')];
    const errors = charts.filter((chart) => chart.dataset.mermaidStatus === 'error');
    if (errors.length > 0) problems.push(errors.length + ' Mermaid component(s) entered the error state');
    else if (
      charts.length !== task.mermaidCount ||
      charts.some((chart) => chart.dataset.mermaidStatus !== 'rendered' || !chart.querySelector('svg'))
    ) waiting = true;
  }

  if (task.navigation.length > 0) {
    const container = document.querySelector(task.navigationContainer);
    if (!container) waiting = true;
    else {
      const anchors = [...container.querySelectorAll('a[href]')];
      for (const route of task.navigation) {
        const found = anchors.some((anchor) => {
          try {
            return new URL(anchor.href, document.location.href).pathname === route && visible(anchor);
          } catch {
            return false;
          }
        });
        if (!found) problems.push('no visible navigation anchor for ' + route);
      }
    }
  }
  return { problems, waiting };
}

async function runTask(task) {
  const result = document.createElement('div');
  result.dataset.browserTask = task.route;
  result.dataset.browserStatus = 'running';
  document.body.append(result);

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:1440px;height:1000px;border:0;z-index:0';
  frame.src = task.route;
  document.body.append(frame);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('page load timed out')), 20000);
      frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      frame.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('page load failed')); }, { once: true });
    });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const inspection = inspect(task, frame.contentDocument);
      if (inspection.problems.length > 0) throw new Error(inspection.problems.join('; '));
      if (!inspection.waiting) {
        result.dataset.browserStatus = 'passed';
        return;
      }
      await wait(100);
    }
    throw new Error('hydrated consumer state timed out');
  } catch (error) {
    result.dataset.browserStatus = 'error';
    result.dataset.browserError = String(error);
  } finally {
    frame.remove();
  }
}

(async () => {
  try {
    verifyVisibilityOracle();
    document.body.dataset.browserVisibilityGuard = 'passed';
  } catch (error) {
    document.body.dataset.browserVisibilityGuard = 'error';
    document.body.dataset.browserVisibilityError = String(error);
  }
  for (let index = 0; index < tasks.length; index += 6) {
    await Promise.all(tasks.slice(index, index + 6).map(runTask));
  }
  document.body.dataset.browserComplete = 'true';
})();
</script>
</body></html>`;
}

async function browserConsumerMarkup(tasks) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === browserTestPath) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(browserTestHtml(tasks));
        return;
      }
      const target = await staticTarget(pathname);
      if (!target) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': contentTypes.get(extname(target)) ?? 'application/octet-stream',
      });
      response.end(await readFile(target));
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const profile = await mkdtemp(join(tmpdir(), 'vibe-docs-chrome-'));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind browser test server.');
    const chrome = await chromeExecutable();
    const { stdout } = await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--disable-background-networking',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-sandbox',
        `--user-data-dir=${profile}`,
        '--virtual-time-budget=45000',
        '--window-size=1440,1200',
        '--dump-dom',
        `http://127.0.0.1:${address.port}${browserTestPath}`,
      ],
      { maxBuffer: 50 * 1024 * 1024, timeout: 120_000 },
    );
    return browserTaskMarkup(stdout);
  } finally {
    await new Promise((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    await rm(profile, { force: true, recursive: true });
  }
}

function browserTask(tasks, route) {
  if (!tasks.has(route)) {
    tasks.set(route, { route, mermaidCount: 0, navigation: [], navigationContainer: '' });
  }
  return tasks.get(route);
}

const { english, chinese } = await publishedPages();
const failures = [];
const browserTasks = new Map();
let chartCount = 0;
let mermaidPageCount = 0;

for (const [locale, pages] of [
  ['en', english],
  ['zh', chinese],
]) {
  const localeHomeRoute = `${basePath}/${locale}/`;
  for (const page of [...pages].sort()) {
    const childRoute = docsRoute(locale, page);
    const parentRoute = parentNavigationRoute(locale, page);
    const parentTask = browserTask(browserTasks, parentRoute);
    parentTask.navigation.push(childRoute);
    parentTask.navigationContainer = parentRoute === localeHomeRoute ? 'main' : '#nd-sidebar';

    const sourcePath = join(
      contentRoot,
      locale === 'zh' ? page.replace(/\.md$/, '.zh.md') : page,
    );
    const charts = mermaidCharts(await readFile(sourcePath, 'utf8'));
    if (charts.length === 0) continue;
    mermaidPageCount += 1;
    chartCount += charts.length;
    browserTask(browserTasks, childRoute).mermaidCount = charts.length;

    const htmlPath = outputFile(locale, page);
    let markup;
    try {
      markup = staticMermaidMarkup(await readFile(htmlPath, 'utf8'));
    } catch (error) {
      failures.push(`${locale}/${page}: exported HTML unavailable (${String(error)})`);
      continue;
    }
    if (markup.charts !== charts.length || markup.loading !== charts.length) {
      failures.push(
        `${locale}/${page}: expected ${charts.length} static Mermaid render placeholders, found ${markup.charts} charts and ${markup.loading} loading placeholders`,
      );
    }
  }
}

const tasks = [...browserTasks.values()];
const browser = await browserConsumerMarkup(tasks);
if (
  !browser.complete ||
  browser.visibilityGuard !== 'passed' ||
  browser.tasks !== tasks.length ||
  browser.passed !== tasks.length
) {
  failures.push(
    `browser consumers: expected ${tasks.length} passing page tasks, found ${JSON.stringify(browser)}`,
  );
}

if (failures.length > 0) {
  throw new Error(`Browser documentation consumer check failed:\n${failures.join('\n')}`);
}

console.log(
  `Browser consumer check passed: ${chartCount} Mermaid diagrams on ${mermaidPageCount} localized pages rendered through the shipped React component; ${english.size + chinese.size} localized navigation links were visibly reachable across ${tasks.length} browser page tasks.`,
);
