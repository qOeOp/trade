import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedPages } from './lib/docs-pages.mjs';
import { basePath, docsRoute, parentNavigationRoute } from './lib/docs-routes.mjs';
import { containsNavigationHref, navigationMarkup } from './lib/static-navigation.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(siteRoot, 'out');
const excludedPages = new Set(['404.html', '404/index.html', '_not-found/index.html']);
const toPosix = (path) => path.split(sep).join('/');

async function findFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(path)));
    else files.push(toPosix(relative(outputRoot, path)));
  }
  return files;
}

function routeFromFile(path) {
  if (path === 'index.html') return `${basePath}/`;
  if (path.endsWith('/index.html')) return `${basePath}/${path.slice(0, -'index.html'.length)}`;
  if (path.endsWith('.html')) return `${basePath}/${path.slice(0, -'.html'.length)}`;
  if (!path.includes('.') && !path.startsWith('_next/')) return `${basePath}/${path}`;
  return null;
}

async function resolveRequest(pathname) {
  if (!pathname.startsWith(basePath)) return null;
  let relativePath = decodeURIComponent(pathname.slice(basePath.length)).replace(/^\/+/, '');
  if (relativePath.length === 0) relativePath = 'index.html';
  const direct = resolve(outputRoot, relativePath);
  if (direct !== outputRoot && !direct.startsWith(`${outputRoot}${sep}`)) return null;

  try {
    const info = await stat(direct);
    if (info.isFile()) return { path: direct };
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) return { redirect: `${pathname}/` };
      return { path: join(direct, 'index.html') };
    }
  } catch {
    if (!extname(relativePath)) {
      try {
        const html = `${direct}.html`;
        if ((await stat(html)).isFile()) return { path: html };
      } catch {
        return null;
      }
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const target = await resolveRequest(pathname);
    if (!target) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } else if (target.redirect) {
      response.writeHead(308, { location: target.redirect });
      response.end();
    } else {
      response.writeHead(200);
      createReadStream(target.path).pipe(response);
    }
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
});

await new Promise((resolvePromise, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolvePromise);
});

try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind route-check server');
  const origin = `http://127.0.0.1:${address.port}`;
  const routes = (await findFiles(outputRoot))
    .filter((path) => !excludedPages.has(path))
    .map(routeFromFile)
    .filter((route) => route !== null)
    .sort();
  if (routes.length === 0) throw new Error('No exported routes found in docs-site/out');

  const { english, chinese } = await publishedPages();
  const expectedRoutes = new Set([
    `${basePath}/`,
    `${basePath}/en/`,
    `${basePath}/zh/`,
    `${basePath}/api/search`,
    ...[...english].map((page) => docsRoute('en', page)),
    ...[...chinese].map((page) => docsRoute('zh', page)),
  ]);
  const routeSet = new Set(routes);
  const missingRoutes = [...expectedRoutes].filter((route) => !routeSet.has(route)).sort();
  if (missingRoutes.length > 0) {
    throw new Error(`Expected routes missing from static export:\n${missingRoutes.join('\n')}`);
  }

  const failures = [];
  const responseBodies = new Map();
  for (const route of routes) {
    const response = await fetch(`${origin}${route}`);
    const body = await response.text();
    responseBodies.set(route, body);
    if (!response.ok) failures.push(`${route}: HTTP ${response.status}`);
    else if (route.endsWith('/')) {
      if (body.length < 200 || !/<html[\s>]/i.test(body) || !/<\/html>/i.test(body)) {
        failures.push(`${route}: response is not a non-empty HTML document`);
      } else if (/Page Not Found|There isn't a GitHub Pages site here/i.test(body)) {
        failures.push(`${route}: response contains a 404-page marker`);
      }
    } else if (route === `${basePath}/api/search`) {
      try {
        const data = JSON.parse(body);
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
          failures.push(`${route}: search index is empty`);
        }
      } catch {
        failures.push(`${route}: response is not valid JSON`);
      }
    } else if (body.length === 0) failures.push(`${route}: response body is empty`);
  }

  for (const [locale, pages] of [
    ['en', english],
    ['zh', chinese],
  ]) {
    for (const page of pages) {
      const childRoute = docsRoute(locale, page);
      const parentRoute = parentNavigationRoute(locale, page);
      const parentBody = responseBodies.get(parentRoute);
      if (!parentBody) {
        failures.push(`${childRoute}: navigation parent was not exported (${parentRoute})`);
        continue;
      }
      const markup = navigationMarkup({
        body: parentBody,
        parentRoute,
        localeHomeRoute: `${basePath}/${locale}/`,
      });
      if (!markup) {
        failures.push(`${childRoute}: navigation container missing from ${parentRoute}`);
      } else if (!containsNavigationHref(markup, childRoute)) {
        failures.push(`${childRoute}: not linked from navigation container in ${parentRoute}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Static route check failed:\n${failures.join('\n')}`);
  }
  console.log(
    `Static route check passed: ${expectedRoutes.size} expected routes and ${routes.length} exported routes returned non-404 data; ${english.size + chinese.size} localized pages are linked from their navigation parent.`,
  );
} finally {
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
}
