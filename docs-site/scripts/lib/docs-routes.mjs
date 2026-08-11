export const basePath = '/trade';

export function docsRoute(locale, page) {
  let slug = page.replace(/\.md$/, '');
  if (slug === 'index') slug = '';
  else if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
  return `${basePath}/${locale}/docs/${slug}${slug ? '/' : ''}`;
}

export function parentNavigationRoute(locale, page) {
  const segments = page.replace(/\.md$/, '').split('/');
  const isIndex = segments.at(-1) === 'index';
  segments.pop();
  if (isIndex) segments.pop();
  if (segments.length === 0) return `${basePath}/${locale}/`;
  return `${basePath}/${locale}/docs/${segments.join('/')}/`;
}
