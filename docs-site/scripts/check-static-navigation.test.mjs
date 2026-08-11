import assert from 'node:assert/strict';
import test from 'node:test';
import { containsNavigationHref, navigationMarkup } from './lib/static-navigation.mjs';

const homeRoute = '/trade/zh/';
const childRoute = '/trade/zh/docs/concepts/accounting/';

test('rejects a docs link that exists only outside the Fumadocs sidebar', () => {
  const body = `<aside id="nd-sidebar"><a href="/other/">Other</a></aside><script>${childRoute}</script>`;
  const markup = navigationMarkup({
    body,
    parentRoute: '/trade/zh/docs/concepts/',
    localeHomeRoute: homeRoute,
  });
  assert.equal(containsNavigationHref(markup, childRoute), false);
});

test('rejects href-shaped script text inside the Fumadocs sidebar', () => {
  const body = `<aside id="nd-sidebar"><script>const marker = 'href="${childRoute}"';</script></aside>`;
  const markup = navigationMarkup({
    body,
    parentRoute: '/trade/zh/docs/concepts/',
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
      parentRoute: '/trade/zh/docs/concepts/',
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
      parentRoute: '/trade/zh/docs/concepts/',
      localeHomeRoute: homeRoute,
    });
    assert.equal(containsNavigationHref(markup, childRoute), false);
  }
});

test('accepts a docs link inside the Fumadocs sidebar', () => {
  const body = `<aside id="nd-sidebar"><a href="${childRoute}">Accounting</a></aside>`;
  const markup = navigationMarkup({
    body,
    parentRoute: '/trade/zh/docs/concepts/',
    localeHomeRoute: homeRoute,
  });
  assert.equal(containsNavigationHref(markup, childRoute), true);
});

test('checks top-level section links inside the localized home main content', () => {
  const sectionRoute = '/trade/zh/docs/concepts/';
  const body = `<main><a href="${sectionRoute}">Concepts</a></main><script></script>`;
  const markup = navigationMarkup({ body, parentRoute: homeRoute, localeHomeRoute: homeRoute });
  assert.equal(containsNavigationHref(markup, sectionRoute), true);
});
