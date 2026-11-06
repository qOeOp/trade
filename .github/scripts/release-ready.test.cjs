const assert = require('node:assert/strict');
const { test } = require('node:test');
const publish = require('./release-ready.cjs');
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const digest = `ghcr.io/qoeop/trade-ide@sha256:${'d'.repeat(64)}`;
const service = `ghcr.io/qoeop/trade-service@sha256:${'e'.repeat(64)}`;
const runtime = `ghcr.io/qoeop/trade-runtime@sha256:${'f'.repeat(64)}`;
const admitted = { revision: B, image: digest, service, runtime };
const withheld = { revision: B, image: null, service: null, runtime };
const run = (name, id, fields = {}) => ({ name, id, workflow_id: id, run_attempt: 2, event: 'push', head_branch: 'main',
  head_sha: B, head_repository: { full_name: 'qOeOp/trade' }, status: 'completed', conclusion: 'success', ...fields });
function fixture() {
  const f = { records: [], previous: { revision: A, image: digest, service, runtime }, runs: [run('quality', 1), run('ide-image', 2)],
    checks: [{ name: 'quality', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }],
    artifact: { id: 7, name: 'web-image-amd64-2', expired: false, workflow_run: { head_sha: B } }, conflict: false };
  const missing = () => { const e = Error('missing'); e.status = 404; throw e; };
  const actions = { listWorkflowRunsForRepo() {}, listWorkflowRunArtifacts() {},
    async listWorkflowRuns() { return { data: { workflow_runs: f.runs.filter((x) => x.name === 'ide-image') } }; },
    async downloadArtifact({ artifact_id }) { return { data: Buffer.from(JSON.stringify(artifact_id === 8 ? {revision:B,runtime} : { revision: B, image: digest, service })) }; } };
  const checks = { listForRef() {} };
  const git = {
    async getRef({ ref }) { return { data: { object: { sha: ref === 'heads/main' ? C : f.previous ? A : missing() } } }; },
    async createBlob({ content }) { f.next = JSON.parse(content); return { data: { sha: 'blob' } }; },
    async createTree() { return { data: { sha: 'tree' } }; },
    async createCommit({ parents }) { f.parents = parents; return { data: { sha: 'commit' } }; },
    async updateRef({ force }) {
      assert.equal(force, false);
      if (f.conflict) { f.conflict = false; f.previous = { revision: C, image: null }; const e = Error('race'); e.status = 422; throw e; }
      f.records.push(f.next);
    },
    async createRef() { f.records.push(f.next); },
  };
  const repos = {
    async compareCommitsWithBasehead({ basehead }) {
      const [before, after] = basehead.split('...');
      return { data: { status: before === after ? 'identical' : before < after ? 'ahead' : 'behind' } };
    },
    async getContent() { return { data: { content: Buffer.from(JSON.stringify(f.previous)).toString('base64') } }; },
  };
  f.github = { rest: { actions, checks, git, repos }, async paginate(method) {
    if (method === actions.listWorkflowRunsForRepo) return f.runs;
    if (method === checks.listForRef) return f.checks;
    if (method === actions.listWorkflowRunArtifacts) return [f.artifact, ...(f.runtimeArtifact ? [f.runtimeArtifact] : [])];
    throw Error('unknown API');
  } };
  f.context = { repo: { owner: 'qOeOp', repo: 'trade' }, payload: { workflow_run: run('quality', 1) }, sha: C };
  f.go = () => publish({ github: f.github, context: f.context, core: { info() {} }, readArchive: (bytes) => JSON.parse(bytes) });
  return f;
}

test('admission uses trigger SHA and the tested attempt digest, never default-branch SHA or a mutable tag', async () => {
  const f = fixture();
  await f.go();
  assert.deepEqual(f.records, [admitted]);
  assert.deepEqual(f.parents, [A]);
});
test('missing quality, incomplete or failed workflow, and late third-party checks withhold eligibility', async () => {
  for (const change of [
    (f) => { f.runs = f.runs.filter((x) => x.name !== 'quality'); },
    (f) => { f.runs.push(run('extra', 3, { status: 'in_progress', conclusion: null })); },
    (f) => { f.runs.push(run('extra', 3, { conclusion: 'failure' })); },
    (f) => { f.checks.push({ name: 'security', app: { slug: 'scanner' }, status: 'queued', conclusion: null }); },
    (f) => { f.checks.push({ name: 'release-ready', app: { slug: 'scanner' }, status: 'completed', conclusion: 'failure' }); },
  ]) {
    const f = fixture(); change(f); await f.go();
    assert.deepEqual(f.records, [withheld]);
  }
});
test('a later failed run supersedes an earlier pass, and a future native artifact cannot be used', async () => {
  const f = fixture();
  f.runs.push(run('quality', 9, { workflow_id: 1, conclusion: 'failure' }));
  await f.go();
  assert.equal(f.records[0].image, null);
  const g = fixture(); g.artifact.name = 'web-image-amd64-3';
  await assert.rejects(g.go(), /matching attempt artifact/);
  assert.deepEqual(g.records, []);
});
test('forks and non-push subjects cannot publish, while scheduled reconciliation can admit late passing checks', async () => {
  const f = fixture(); f.context.payload.workflow_run.head_repository.full_name = 'other/trade';
  await f.go(); assert.deepEqual(f.records, []);
  const g = fixture(); g.context.payload.workflow_run.event = 'pull_request';
  await g.go(); assert.deepEqual(g.records, []);
  const scheduled = fixture(); scheduled.context.payload = {};
  await scheduled.go(); assert.equal(scheduled.records[0].revision, B);
});
test('readiness jobs do not wait on themselves; other checks remain required', async () => {
  const f = fixture();
  f.checks.push({ name: 'release-ready', app: { slug: 'github-actions' }, status: 'in_progress' });
  await f.go(); assert.equal(f.records[0].image, digest);
});
test('out-of-order events and a reference conflict cannot overwrite newer source decisions', async () => {
  const f = fixture(); f.previous = { revision: C, image: null };
  await f.go(); assert.deepEqual(f.records, []);
  const g = fixture(); g.conflict = true;
  await g.go(); assert.deepEqual(g.records, []);
});

test('a partial rerun carries the latest already tested native job artifact from this workflow run', async () => {
  const f = fixture(); f.runs.find((x) => x.name === 'ide-image').run_attempt = 3;
  await f.go(); assert.equal(f.records[0].image, digest);
});

test('runtime is bound to its tested run; missing initial runtime or service artifact fails closed', async () => {
  const f=fixture(); f.previous={revision:A,image:digest};
  await assert.rejects(f.go(),/first execution release/);
  const g=fixture(); g.previous={revision:A,image:digest};
  g.runs.push(run('runtime-image',3));
  g.runtimeArtifact={id:8,name:'runtime-image-amd64-2',expired:false,workflow_run:{head_sha:B}};
  await g.go(); assert.deepEqual(g.records,[admitted]);
  const h=fixture(); h.runs.push(run('runtime-image',3));
  await assert.rejects(h.go(),/matching attempt artifact/);
});
test('withheld callbacks retain the admitted runtime for subsequent service-only releases', async () => {
  const f=fixture(); f.runs[0].status='in_progress'; await f.go();
  assert.deepEqual(f.records,[withheld]); f.previous=f.records[0]; f.runs[0].status='completed';
  await f.go(); assert.deepEqual(f.records.at(-1),admitted);
});
