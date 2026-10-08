export async function publishedPages() {
  const pages = ['index.md', 'architecture.md', 'replay.md', 'findings.md'];
  return { english: new Set(pages), chinese: new Set(pages) };
}
