// remark-directive reads any `:name` as a text directive, digits included, so clock times like 02:00 lose
// their minutes. Only container directives (admonitions) are meant as syntax here; text and leaf directives
// go back to the plain text they were written as.

type Node = { type: string; value?: string; name?: string; attributes?: Record<string, string | null | undefined> | null; children?: Node[] };

function restore(node: Node, marker: string): Node[] {
  const label = node.children?.length ? [{ type: 'text', value: '[' }, ...node.children, { type: 'text', value: ']' }] : [];
  const attributes = Object.entries(node.attributes ?? {}).map(([key, value]) => (value ? `${key}="${value}"` : key));
  const tail = attributes.length ? [{ type: 'text', value: `{${attributes.join(' ')}}` }] : [];
  return [{ type: 'text', value: `${marker}${node.name}` }, ...label, ...tail];
}

function walk(parent: Node) {
  if (!parent.children) return;
  const restored = parent.children.flatMap((child) => {
    walk(child);
    if (child.type === 'textDirective') return restore(child, ':');
    if (child.type === 'leafDirective') return [{ type: 'paragraph', children: restore(child, '::') }];
    return [child];
  });
  // Merge neighbouring text so a restored time renders as one string, as it was written.
  parent.children = restored.reduce<Node[]>((merged, child) => {
    const last = merged[merged.length - 1];
    if (last?.type === 'text' && child.type === 'text') merged[merged.length - 1] = { type: 'text', value: `${last.value}${child.value}` };
    else merged.push(child);
    return merged;
  }, []);
}

export function remarkDirectiveText() {
  return (tree: Node) => walk(tree);
}
