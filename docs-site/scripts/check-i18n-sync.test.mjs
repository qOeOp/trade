import assert from 'node:assert/strict';
import test from 'node:test';
import { findUnpairedChangedDocuments } from './lib/i18n-sync.mjs';

const english = new Set(['concepts/example.md', 'tutorials/notebook.md']);
const chinese = new Set(english);

test('requires a Chinese path change when an English Markdown page changes', () => {
  assert.deepEqual(
    findUnpairedChangedDocuments({
      changed: new Set(['docs/concepts/example.md']),
      english,
      chinese,
    }),
    ['docs/concepts/example.md -> docs/concepts/example.zh.md'],
  );
});

test('accepts when both English and Chinese Markdown paths changed', () => {
  assert.deepEqual(
    findUnpairedChangedDocuments({
      changed: new Set(['docs/concepts/example.md', 'docs/concepts/example.zh.md']),
      english,
      chinese,
    }),
    [],
  );
});

test('requires the generated Chinese Markdown path when Jupytext changes', () => {
  assert.deepEqual(
    findUnpairedChangedDocuments({
      changed: new Set(['docs/tutorials/notebook.py']),
      english,
      chinese,
    }),
    ['docs/tutorials/notebook.py -> docs/tutorials/notebook.zh.md'],
  );
});
