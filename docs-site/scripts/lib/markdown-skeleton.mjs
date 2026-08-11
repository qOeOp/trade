import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';

const parser = unified().use(remarkParse).use(remarkGfm);
const protectedTypes = new Set([
  'strong',
  'inlineCode',
  'link',
  'image',
  'linkReference',
  'imageReference',
  'definition',
]);

function protectedUrl(url) {
  return url.startsWith('#') ? '#<localized-heading>' : url;
}

function sectionIndexes(source) {
  const result = [];
  let section = 0;
  let fenceCharacter = null;
  let fenceLength = 0;

  for (const [index, line] of source.split('\n').entries()) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence && fenceCharacter === null) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
    } else if (
      fence &&
      fence[1][0] === fenceCharacter &&
      fence[1].length >= fenceLength
    ) {
      fenceCharacter = null;
      fenceLength = 0;
    }
    const inFence = fenceCharacter !== null;
    if (!inFence && /^#{1,6}\s+/.test(line)) {
      section += 1;
    }
    result[index + 1] = { section };
  }
  return result;
}

export function protectedMarkdownSkeleton(source) {
  const tree = parser.parse(source);
  const lineSections = sectionIndexes(source);
  const definitions = new Map();

  function collectDefinitions(node) {
    if (node.type === 'definition') definitions.set(node.identifier, node.url);
    for (const child of node.children ?? []) collectDefinitions(child);
  }
  collectDefinitions(tree);

  const blocks = new Map();
  function visit(node, ancestry = []) {
    if (node.type === 'code') return;
    if (protectedTypes.has(node.type)) {
      const location = lineSections[node.position?.start.line ?? 1] ?? { section: 0 };
      const context = ancestry.join('/');
      const key = `${location.section}:${context}`;
      const protectedBlock = blocks.get(key) ?? {
        ...location,
        context,
        strong: 0,
        inlineCode: [],
        links: [],
        images: [],
        definitions: [],
      };
      if (node.type === 'strong') protectedBlock.strong += 1;
      if (node.type === 'inlineCode') protectedBlock.inlineCode.push(node.value);
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
        const target = [protectedUrl(node.url), node.title ?? null];
        if (node.type === 'link') protectedBlock.links.push(target);
        if (node.type === 'image') protectedBlock.images.push(target);
        if (node.type === 'definition') protectedBlock.definitions.push(target);
      } else if (node.type === 'linkReference' || node.type === 'imageReference') {
        const targetUrl = definitions.get(node.identifier);
        const target = [targetUrl === undefined ? null : protectedUrl(targetUrl), null];
        if (node.type === 'linkReference') protectedBlock.links.push(target);
        else protectedBlock.images.push(target);
      }
      blocks.set(key, protectedBlock);
    }
    for (const [index, child] of (node.children ?? []).entries()) {
      let segment;
      if (child.type === 'paragraph') segment = `paragraph:${index}`;
      else if (child.type === 'list') {
        segment = `list:${index}:${child.ordered ? 'ordered' : 'unordered'}`;
      }
      else if (child.type === 'listItem') segment = `item:${index}`;
      else if (child.type === 'table') segment = `table:${index}`;
      else if (child.type === 'tableRow') segment = `row:${index}`;
      else if (child.type === 'tableCell') segment = `cell:${index}`;
      else if (child.type === 'blockquote') segment = `blockquote:${index}`;
      visit(child, segment ? [...ancestry, segment] : ancestry);
    }
  }
  visit(tree);

  return [...blocks.values()].map((block) => ({
    ...block,
    inlineCode: [...block.inlineCode].sort(),
  }));
}
