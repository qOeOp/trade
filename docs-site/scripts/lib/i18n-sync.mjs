export function findUnpairedChangedDocuments({ changed, english, chinese }) {
  const unpaired = [];
  for (const path of changed) {
    if (!path.startsWith('docs/') || path.endsWith('.zh.md')) continue;
    let page;
    if (path.endsWith('.md')) page = path.slice('docs/'.length);
    else if (path.endsWith('.py')) page = path.slice('docs/'.length).replace(/\.py$/, '.md');
    else continue;
    if (!english.has(page) || !chinese.has(page)) continue;
    const translation = `docs/${page.replace(/\.md$/, '.zh.md')}`;
    if (!changed.has(translation)) unpaired.push(`${path} -> ${translation}`);
  }
  return unpaired.sort();
}
