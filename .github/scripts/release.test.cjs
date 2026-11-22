const assert = require('node:assert/strict');
const { test } = require('node:test');
const release = require('./release.cjs');
// Commits in main order: A before B before C (the fake compare orders them by name).
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const run = (name, sha, fields = {}) => ({ name, event: 'push', head_branch: 'main', head_sha: sha,
  head_repository: { full_name: 'qOeOp/trade' }, status: 'completed', conclusion: 'success', ...fields });
const encode = (value) => ({ data: { content: Buffer.from(value).toString('base64') } });

function fixture() {
  const f = { runs: { [A]: [run('quality', A), run('ide-image', A)], [B]: [run('quality', B), run('ide-image', B)] },
    images: [run('ide-image', B), run('ide-image', A)], versions: { [A]: '0.4.4', [B]: '0.5.0' },
    staged: [{ revision: B, image: 'ide' }], releases: [], dispatches: [], sleeps: 0, onSleep() {} };
  const actions = {
    listWorkflowRunsForRepo() {},
    async listWorkflowRuns({ workflow_id, page }) {
      assert.equal(workflow_id, 'ide-image.yml');
      return { data: { workflow_runs: page === 1 ? f.images : [] } };
    },
    async createWorkflowDispatch(args) { f.dispatches.push(args.workflow_id); },
    async getWorkflowRun({ run_id }) { assert.equal(run_id, 77); return { data: { run_started_at: '2026-11-22T10:00:00Z' } }; },
  };
  const repos = {
    async compareCommitsWithBasehead({ basehead }) {
      const [before, after] = basehead.split('...');
      return { data: { status: before === after ? 'identical' : before < after ? 'ahead' : 'behind' } };
    },
    async listCommits({ sha }) {
      assert.equal(sha, 'main-ready');
      return { data: f.staged.map((record, i) => ({ sha: `staged-${i}`, commit: { committer: { date: record.at ?? '2026-11-22T09:00:00Z' } } })) };
    },
    async getContent({ path, ref }) {
      if (path === 'pyproject.toml') return encode(`[project]\nname = "x"\nversion = "${f.versions[ref]}"\n`);
      return encode(JSON.stringify(f.staged[Number(ref.slice('staged-'.length))]));
    },
    async createRelease(args) { f.releases.push(args); },
  };
  f.github = { rest: { actions, repos }, async paginate(method, args) {
    assert.equal(method, actions.listWorkflowRunsForRepo); return f.runs[args.head_sha] ?? [];
  } };
  let clock = 0;
  f.go = (merged = B, started = A) => release({ github: f.github, context: { repo: { owner: 'qOeOp', repo: 'trade' }, sha: started, runId: 77 },
    core: { info() {} }, version: '0.5.0', merged, notes: '- An entry.\n', now: () => clock,
    sleep: async () => { f.sleeps++; clock += 60 * 1000; f.onSleep(f); } });
  return f;
}

test('the merged bump is released once main-ready admits it, and release-ready is dispatched', async () => {
  const f = fixture(); f.staged = [];
  f.onSleep = (g) => { if (g.sleeps === 2) g.staged = [{ revision: B, image: null }]; if (g.sleeps === 3) g.staged = [{ revision: B, image: 'ide' }]; };
  await f.go();
  assert.equal(f.sleeps, 3);
  assert.deepEqual(f.releases.map(({ tag_name, target_commitish, name, body }) => [tag_name, target_commitish, name, body]),
    [['v0.5.0', B, 'v0.5.0', '- An entry.\n']]);
  assert.deepEqual(f.dispatches, ['release-ready.yml']);
});

test('a documentation-only merge releases the newest commit that built the product', async () => {
  const f = fixture(); f.runs[C] = [run('quality', C)]; f.staged = [{ revision: B, image: 'ide' }];
  await f.go(C);
  assert.equal(f.releases[0].target_commitish, B);
});

test('nothing is released while the merge has no push runs, nor when the product carries another version', async () => {
  const f = fixture(); f.runs[B] = [];
  await assert.rejects(f.go(), /Gave up after 180 minutes waiting for the push runs/);
  const g = fixture(); g.versions[B] = '0.4.4';
  await assert.rejects(g.go(), /carries 0.4.4, not 0.5.0/);
  for (const h of [f, g]) assert.deepEqual([h.releases, h.dispatches], [[], []]);
});

test('a failed run, or main-ready passing the commit by, ends the wait without a release', async () => {
  const f = fixture(); f.staged = [{ revision: B, image: null }]; f.runs[B].push(run('ide-web', B, { conclusion: 'failure' }));
  await assert.rejects(f.go(), /main-ready cannot admit .*: ide-web failure/);
  const g = fixture(); g.staged = [{ revision: C, image: 'ide' }, { revision: A, image: 'ide' }];
  await assert.rejects(g.go(), /moved past .* without a decision/);
  const h = fixture(); h.staged = [{ revision: A, image: 'ide' }];
  await assert.rejects(h.go(), /Gave up after 180 minutes waiting for main-ready/);
  for (const k of [f, g, h]) assert.deepEqual(k.releases, []);
});

test('on the commit this run started on, main-ready withholding it while the run is going does not count', async () => {
  const f = fixture(); f.staged = [{ revision: B, image: null, at: '2026-11-22T10:15:00Z' }, { revision: B, image: 'ide' }];
  await f.go(B, B);
  assert.equal(f.releases[0].target_commitish, B); assert.equal(f.sleeps, 0);
  const g = fixture(); g.staged = [{ revision: B, image: null, at: '2026-11-22T10:15:00Z' }, { revision: B, image: 'ide' }];
  await assert.rejects(g.go(B, A), /Gave up/);
});
