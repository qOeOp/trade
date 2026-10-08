export const basePath = '/trade';

export function docsRoute(locale, page) {
  const slug = page.replace(/\.md$/, '');
  return `${basePath}/${locale}/docs/${slug === 'index' ? '' : `${slug}/`}`;
}

export function parentNavigationRoute(locale) {
  return `${basePath}/${locale}/docs/`;
}
