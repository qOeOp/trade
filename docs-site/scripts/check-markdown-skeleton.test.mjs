import assert from 'node:assert/strict';
import test from 'node:test';
import { protectedMarkdownSkeleton } from './lib/markdown-skeleton.mjs';

test('preserves link target association and order', () => {
  const source = '[Alpha](alpha.md) and [Beta](beta.md).';
  const swapped = '[甲](beta.md)和[乙](alpha.md)。';
  assert.notDeepEqual(protectedMarkdownSkeleton(swapped), protectedMarkdownSkeleton(source));
});

test('accepts localized same-page heading fragments', () => {
  const source = '[Safety](#safety-checks).';
  const translated = '[安全](#安全检查)。';
  assert.deepEqual(protectedMarkdownSkeleton(translated), protectedMarkdownSkeleton(source));
});

test('still rejects localized fragments for another page', () => {
  const source = '[Safety](guide.md#safety-checks).';
  const translated = '[安全](guide.md#安全检查)。';
  assert.notDeepEqual(protectedMarkdownSkeleton(translated), protectedMarkdownSkeleton(source));
});

test('rejects strong emphasis moved to another paragraph', () => {
  const source = '**Important** text.\n\nOrdinary text.';
  const relocated = '普通文本。\n\n**重要**文本。';
  assert.notDeepEqual(protectedMarkdownSkeleton(relocated), protectedMarkdownSkeleton(source));
});

test('rejects strong emphasis moved between paragraphs in one blockquote', () => {
  const source = '> **Critical** first paragraph.\n>\n> Ordinary second paragraph.';
  const relocated = '> 普通第一段。\n>\n> **关键**第二段。';
  assert.notDeepEqual(protectedMarkdownSkeleton(relocated), protectedMarkdownSkeleton(source));
});

test('rejects inline code moved between structural containers', () => {
  const cases = [
    ['Use `safe=True`.\n\nOrdinary.', '普通。\n\n使用 `safe=True`。'],
    ['- Use `safe=True`.\n- Ordinary.', '- 普通。\n- 使用 `safe=True`。'],
    [
      '| Primary | Secondary |\n| --- | --- |\n| `safe=True` | Ordinary |',
      '| 主要 | 次要 |\n| --- | --- |\n| 普通 | `safe=True` |',
    ],
    ['> Use `safe=True`.\n>\n> Ordinary.', '> 普通。\n>\n> 使用 `safe=True`。'],
  ];
  for (const [source, relocated] of cases) {
    assert.notDeepEqual(protectedMarkdownSkeleton(relocated), protectedMarkdownSkeleton(source));
  }
});

test('rejects protected content moved to another list item', () => {
  const source = '- **Critical** first item.\n- [Safety](safety.md) second item.';
  const relocated = '- [安全](safety.md)第一项。\n- **关键**第二项。';
  assert.notDeepEqual(protectedMarkdownSkeleton(relocated), protectedMarkdownSkeleton(source));
});

test('rejects a protected link moved to another table cell', () => {
  const source = '| Primary | Secondary |\n| --- | --- |\n| [Safety](safety.md) | Ordinary |';
  const relocated = '| 主要 | 次要 |\n| --- | --- |\n| 普通 | [安全](safety.md) |';
  assert.notDeepEqual(protectedMarkdownSkeleton(relocated), protectedMarkdownSkeleton(source));
});

test('accepts translated prose with the same protected structure', () => {
  const source = '**Important**: use [`Client`](client.md) with `safe=True`.';
  const translated = '**重要**：将 [`Client`](client.md) 与 `safe=True` 一起使用。';
  assert.deepEqual(protectedMarkdownSkeleton(translated), protectedMarkdownSkeleton(source));
});

test('accepts equivalent list spacing required by Markdown formatters', () => {
  const source = '## Setup\n- Use [`Client`](client.md).';
  const translated = '## 配置\n\n- 使用 [`Client`](client.md)。\n';
  assert.deepEqual(protectedMarkdownSkeleton(translated), protectedMarkdownSkeleton(source));
});
