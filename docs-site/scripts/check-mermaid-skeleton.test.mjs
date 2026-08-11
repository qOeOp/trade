import assert from 'node:assert/strict';
import test from 'node:test';
import { mermaidSkeleton } from './lib/mermaid-skeleton.mjs';

test('accepts translated visible Mermaid labels', () => {
  const source = '```mermaid\nflowchart LR\n  A[Load data] -->|Success| B[Run strategy]\n```';
  const translated = '```mermaid\nflowchart LR\n  A[加载数据] -->|成功| B[运行策略]\n```';
  assert.deepEqual(mermaidSkeleton(translated), mermaidSkeleton(source));
});

test('accepts translated sequence messages while preserving participants', () => {
  const source = '```mermaid\nsequenceDiagram\n  participant E as Engine\n  E->>S: Start strategy\n```';
  const translated = '```mermaid\nsequenceDiagram\n  participant E as 引擎\n  E->>S: 启动策略\n```';
  assert.deepEqual(mermaidSkeleton(translated), mermaidSkeleton(source));
});

test('accepts translated display aliases for previously bare identifiers', () => {
  const source = '```mermaid\nsequenceDiagram\n  participant Engine\n  Engine->>Venue: Submit order\n```';
  const translated = '```mermaid\nsequenceDiagram\n  participant Engine as 引擎\n  Engine->>Venue: 提交订单\n```';
  assert.deepEqual(mermaidSkeleton(translated), mermaidSkeleton(source));
});

test('accepts translated node and edge display labels', () => {
  const source = '```mermaid\nflowchart LR\n  Root --> Spot\n  Engine -- publish --> Bus((Message bus))\n```';
  const translated = '```mermaid\nflowchart LR\n  Root --> Spot[现货]\n  Engine -- 发布 --> Bus((消息总线))\n```';
  assert.deepEqual(mermaidSkeleton(translated), mermaidSkeleton(source));
});

test('rejects changed Mermaid node identifiers', () => {
  const source = '```mermaid\nflowchart LR\n  A[Load data] --> B[Run strategy]\n```';
  const changed = '```mermaid\nflowchart LR\n  X[加载数据] --> B[运行策略]\n```';
  assert.notDeepEqual(mermaidSkeleton(changed), mermaidSkeleton(source));
});

test('rejects changed Mermaid topology', () => {
  const source = '```mermaid\nflowchart LR\n  A[Load] --> B[Run]\n```';
  const changed = '```mermaid\nflowchart LR\n  A[加载] --> C[运行]\n```';
  assert.notDeepEqual(mermaidSkeleton(changed), mermaidSkeleton(source));
});
