const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const publish = require('./release-ready.cjs');
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const digest = `ghcr.io/qoeop/trade-ide@sha256:${'d'.repeat(64)}`;
const service = `ghcr.io/qoeop/trade-service@sha256:${'e'.repeat(64)}`;
const runtime = `ghcr.io/qoeop/trade-runtime@sha256:${'f'.repeat(64)}`;
const admitted = { revision: B, image: digest, service, runtime };
const withheld = { revision: B, image: null, service: null, runtime: null };
const run = (name, id, fields = {}) => ({ name, id, workflow_id: id, run_attempt: 2, event: 'push', head_branch: 'main',
  head_sha: B, head_repository: { full_name: 'qOeOp/trade' }, status: 'completed', conclusion: 'success', ...fields });
const blobSha = (content) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../engine/runtime/Dockerfile'), 'utf8');

function fixture() {
  // previous/records are main-ready; production/deployed are deploy-ready, which only version tags move.
  const f = { records: [], previous: { revision: A, image: digest, service, runtime },
    production: { revision: A, image: digest, service, runtime }, deployed: [], tags: [], deployments: [], parents: {},
    runs: [run('quality', 1), run('ide-image', 2)],
    checks: [{ name: 'quality', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }],
    artifact: { id: 7, name: 'web-image-amd64-2', expired: false, workflow_run: { head_sha: B } },
    history: { [A]: [run('quality', 11, { head_sha: A })], [C]: [run('quality', 21, { head_sha: C }), run('ide-image', 22, { head_sha: C })] },
    historyChecks: {}, artifacts: {}, downloads: {}, runtimeHistory: [], trees: {}, blobs: {}, truncated: new Set(),
    calls: { pushes: [], checks: [], trees: [], blobs: [], runtimePages: 0 }, conflict: null };
  const base = [
    ['engine/runtime/Dockerfile', dockerfile], ['engine/run.py', '# native engine\n'],
    ['pyproject.toml', '[project]\nname = "fixture"\n'], ['uv.lock', 'version = 1\n'],
    ['service/web.py', '# service only\n'],
  ];
  // The execution Dockerfile copies the replay closure by name, then engine/*.py.
  for (const name of new Set(dockerfile.match(/engine\/[a-z_]+\.py/g))) {
    if (!base.some(([existing]) => existing === name)) base.push([name, `# ${name}\n`]);
  }
  // Actual Dockerfile bytes and real Git blob identities exercise the production Python helper.
  for (const name of ['.github/workflows/runtime-image.yml', '.github/scripts/publish-platform-image.sh',
    '.github/scripts/check-native-runtime.py', '.github/scripts/ci-paths.py', '.github/actions/ci-paths/action.yml', 'deploy/runtime_inputs.py']) {
    base.push([name, fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8')]);
  }
  for (const sha of [A, B, C]) {
    f.trees[sha] = base.map(([name, content]) => {
      const hash = blobSha(content); f.blobs[hash] = content;
      return { path: name, mode: '100644', type: 'blob', sha: hash };
    });
    f.historyChecks[sha] = structuredClone(f.checks);
  }
  f.setInput = (sha, name, content, mode = '100644') => {
    f.trees[sha] = f.trees[sha].filter((item) => item.path !== name);
    if (content !== null) {
      const hash = blobSha(content); f.blobs[hash] = content;
      f.trees[sha].push({ path: name, mode, type: 'blob', sha: hash });
    }
  };
  f.addRuntime = (sha, id, fields = {}) => {
    const native = run('runtime-image', id, { head_sha: sha, ...fields });
    (sha === B ? f.runs : f.history[sha]).push(native);
    f.runtimeHistory.unshift(native);
    const artifact = { id: id + 100, name: 'runtime-image-amd64-2', expired: false, workflow_run: { head_sha: sha } };
    f.artifacts[id] = [artifact]; f.downloads[artifact.id] = { revision: sha, runtime };
    return native;
  };
  f.addRuntime(A, 12);
  f.artifacts[22] = [{ id: 9, name: 'web-image-amd64-2', expired: false, workflow_run: { head_sha: C } }];
  f.downloads[7] = { revision: B, image: digest, service };
  f.downloads[9] = { revision: C, image: digest, service };
  const missing = () => { const e = Error('missing'); e.status = 404; throw e; };
  const treeSha = (sha) => createHash('sha1').update(JSON.stringify(f.trees[sha])).digest('hex');
  const actions = { listWorkflowRunsForRepo() {}, listWorkflowRunArtifacts() {},
    async listWorkflowRuns({ workflow_id }) {
      assert.equal(workflow_id, 'ide-image.yml'); // Runtime history must use the paginated API.
      return { data: { workflow_runs: f.runs.filter((item) => item.name === 'ide-image') } };
    },
    async downloadArtifact({ artifact_id }) { return { data: Buffer.from(JSON.stringify(f.downloads[artifact_id])) }; },
  };
  const checks = { listForRef() {} };
  const git = {
    async getRef({ ref }) {
      if (ref === 'heads/main') return { data: { object: { sha: C } } };
      const tip = { 'heads/main-ready': f.previous && 'main-ready-tip', 'heads/deploy-ready': f.production && 'deploy-ready-tip' }[ref];
      return tip ? { data: { object: { sha: tip } } } : missing();
    },
    async getCommit({ commit_sha }) { return { data: { sha: commit_sha, tree: { sha: treeSha(commit_sha) } } }; },
    async getTree({ tree_sha, recursive }) {
      assert.equal(recursive, '1');
      const sha = Object.keys(f.trees).find((key) => treeSha(key) === tree_sha);
      f.calls.trees.push(sha);
      return { data: { sha: tree_sha, truncated: f.truncated.has(sha), tree: f.trees[sha] } };
    },
    async getBlob({ file_sha }) {
      f.calls.blobs.push(file_sha);
      return { data: { sha: file_sha, encoding: 'base64', content: Buffer.from(f.blobs[file_sha]).toString('base64') } };
    },
    async createBlob({ content }) { f.next = JSON.parse(content); return { data: { sha: 'blob' } }; },
    async createTree() { return { data: { sha: 'tree' } }; },
    async createCommit({ parents }) { f.pending = parents; return { data: { sha: 'commit' } }; },
    async updateRef({ ref, force }) {
      assert.equal(force, false);
      if (f.conflict) { const conflict = f.conflict; f.conflict = null; conflict(); const e = Error('race'); e.status = 422; throw e; }
      f.parents[ref.slice('heads/'.length)] = f.pending;
      (ref === 'heads/deploy-ready' ? f.deployed : f.records).push(f.next);
    },
    async createRef({ ref }) {
      assert.ok(['refs/heads/main-ready', 'refs/heads/deploy-ready'].includes(ref));
      (ref === 'refs/heads/deploy-ready' ? f.deployed : f.records).push(f.next);
    },
  };
  const repos = {
    async compareCommitsWithBasehead({ basehead }) {
      const [before, after] = basehead.split('...');
      return { data: { status: before === after ? 'identical' : before < after ? 'ahead' : 'behind' } };
    },
    async getContent({ ref }) {
      const record = { 'main-ready-tip': f.previous, 'deploy-ready-tip': f.production }[ref];
      return { data: { content: Buffer.from(JSON.stringify(record)).toString('base64') } };
    },
    listTags() {},
    async createDeployment(args) { f.deployments.push({ ...args, statuses: [] }); return { data: { id: f.deployments.length } }; },
    async createDeploymentStatus({ owner: _owner, repo: _repo, deployment_id, ...status }) { f.deployments[deployment_id - 1].statuses.push(status); },
  };
  f.github = { rest: { actions, checks, git, repos }, async paginate(method, args) {
    if (method === actions.listWorkflowRunsForRepo) {
      f.calls.pushes.push(args.head_sha); return args.head_sha === B ? f.runs : f.history[args.head_sha];
    }
    if (method === repos.listTags) return f.tags;
    if (method === checks.listForRef) { f.calls.checks.push(args.ref); return args.ref === B ? f.checks : f.historyChecks[args.ref]; }
    if (method === actions.listWorkflowRunArtifacts) return args.run_id === 2 ? [f.artifact] : f.artifacts[args.run_id] ?? [];
    if (method === actions.listWorkflowRuns) {
      assert.equal(args.workflow_id, 'runtime-image.yml'); assert.equal(args.per_page, 100);
      f.calls.runtimePages++; return f.runtimeHistory;
    }
    throw Error('unknown API');
  } };
  f.context = { repo: { owner: 'qOeOp', repo: 'trade' }, payload: { workflow_run: run('quality', 1) }, sha: C };
  f.go = () => publish({ github: f.github, context: f.context, core: { info() {}, warning() {} }, readArchive: (bytes) => JSON.parse(bytes) });
  return f;
}

test('admission uses trigger SHA, matching native inputs and tested attempt digests', async () => {
  const f = fixture(); await f.go();
  assert.deepEqual(f.records, [admitted]); assert.deepEqual(f.parents, { 'main-ready': ['main-ready-tip'] });
  assert.equal(f.calls.runtimePages, 1);
});

test('missing quality, incomplete, failed or cancelled workflows, and external checks withhold', async () => {
  for (const change of [
    (f) => { f.runs = f.runs.filter((item) => item.name !== 'quality'); },
    (f) => { f.runs.push(run('extra', 3, { status: 'in_progress', conclusion: null })); },
    (f) => { f.runs.push(run('extra', 3, { conclusion: 'failure' })); },
    (f) => { f.runs.push(run('extra', 3, { conclusion: 'cancelled' })); },
    (f) => { f.checks.push({ name: 'security', app: { slug: 'scanner' }, status: 'queued', conclusion: null }); },
    (f) => { f.checks.push({ name: 'release-ready', app: { slug: 'scanner' }, status: 'completed', conclusion: 'failure' }); },
  ]) {
    const f = fixture(); change(f); await f.go(); assert.deepEqual(f.records, [withheld]);
  }
});

test('the documentation site run and its jobs do not decide eligibility; another workflow job still does', async () => {
  for (const [conclusion, suite, expected] of [['failure', 50, admitted], ['cancelled', 50, admitted],
    [null, 50, admitted], ['failure', 51, withheld]]) {
    const f = fixture();
    f.runs.push(run('docs-pages', 5, { check_suite_id: 50, status: conclusion ? 'completed' : 'in_progress', conclusion }));
    f.checks.push({ name: 'Deploy documentation site', app: { slug: 'github-actions' }, check_suite: { id: suite },
      status: conclusion ? 'completed' : 'in_progress', conclusion });
    await f.go(); assert.deepEqual(f.records, [expected], `${conclusion} ${suite}`);
  }
});

test('later failed run supersedes an earlier pass, and future or foreign native artifacts fail closed', async () => {
  const f = fixture(); f.runs.push(run('quality', 9, { workflow_id: 1, conclusion: 'failure' }));
  await f.go(); assert.deepEqual(f.records, [withheld]);
  for (const change of [
    (g) => { g.artifact.name = 'web-image-amd64-3'; },
    (g) => { g.artifact.workflow_run.head_sha = A; },
    (g) => { g.downloads[7].revision = A; },
    (g) => { g.downloads[7].service = undefined; },
  ]) {
    const g = fixture(); change(g); await assert.rejects(g.go(), /artifact|identity/); assert.deepEqual(g.records, []);
  }
});

test('forks and non-push subjects cannot publish; scheduled reconciliation can admit', async () => {
  const f = fixture(); f.context.payload.workflow_run.head_repository.full_name = 'other/trade';
  await f.go(); assert.deepEqual(f.records, []);
  const g = fixture(); g.context.payload.workflow_run.event = 'pull_request'; await g.go(); assert.deepEqual(g.records, []);
  const scheduled = fixture(); scheduled.context.payload = {}; await scheduled.go(); assert.deepEqual(scheduled.records, [admitted]);
});

test('readiness jobs are excluded and a partial rerun can reuse its latest tested native job artifact', async () => {
  const f = fixture(); f.checks.push({ name: 'release-ready', app: { slug: 'github-actions' }, status: 'in_progress' });
  f.runs.find((item) => item.name === 'ide-image').run_attempt = 3;
  await f.go(); assert.deepEqual(f.records, [admitted]);
});

test('a non-null retained runtime never admits new or changed engine inputs', async () => {
  for (const [name, content] of [['engine/run.py', '# changed\n'], ['engine/live.py', '# newly copied\n'],
    ['pyproject.toml', '[project]\nname = "changed"\n'], ['uv.lock', 'version = 2\n'],
    ['.github/scripts/check-native-runtime.py', '# changed qualification\n'], ['.dockerignore', 'engine/live.py\n']]) {
    const f = fixture(); f.setInput(B, name, content); await f.go(); assert.deepEqual(f.records, [withheld], name);
  }
});

test('deleted and mode-changed inputs invalidate reuse; exact service-only changes reuse it', async () => {
  const removed = fixture(); removed.setInput(A, 'engine/removed.py', '# deleted later\n');
  await removed.go(); assert.deepEqual(removed.records, [withheld]);
  const mode = fixture(); mode.setInput(B, 'engine/run.py', '# native engine\n', '100755');
  await mode.go(); assert.deepEqual(mode.records, [withheld]);
  const serviceOnly = fixture(); serviceOnly.setInput(B, 'service/web.py', '# newer service\n');
  await serviceOnly.go(); assert.deepEqual(serviceOnly.records, [admitted]);
});

test('missing matching runtime withholds even an initial release, and later callback re-resolves it', async () => {
  const f = fixture(); f.previous = null; f.runtimeHistory = []; await f.go(); assert.deepEqual(f.records, [withheld]);
  f.previous = f.records[0]; f.runtimeHistory = [f.history[A].find((item) => item.name === 'runtime-image')];
  await f.go(); assert.deepEqual(f.records.at(-1), admitted);
});

test('target runtime uses its own latest tested attempt and cannot bypass matching artifact identity', async () => {
  const f = fixture(); f.setInput(B, 'engine/run.py', '# new native runtime\n'); f.addRuntime(B, 3);
  await f.go(); assert.deepEqual(f.records, [admitted]);
  for (const change of [
    (g) => { g.artifacts[3] = []; },
    (g) => { g.artifacts[3][0].name = 'runtime-image-amd64-3'; },
    (g) => { g.artifacts[3][0].workflow_run.head_sha = A; },
    (g) => { g.downloads[103].revision = A; },
  ]) {
    const g = fixture(); g.addRuntime(B, 3); change(g); await assert.rejects(g.go(), /artifact|identity/);
    assert.deepEqual(g.records, []);
  }
  const failed = fixture(); const old = failed.addRuntime(B, 3);
  failed.runs.push({ ...old, run_attempt: 3, conclusion: 'failure' });
  await failed.go(); assert.deepEqual(failed.records, [withheld]);
});

test('candidate source requires all green workflows and checks, latest runtime run and attempt, and ancestry', async () => {
  for (const fault of ['checks', 'cancelled-ide', 'attempt', 'run', 'ancestry', 'fork', 'event', 'legacy']) {
    const f = fixture(); const old = f.history[A].find((item) => item.name === 'runtime-image');
    if (fault === 'checks') f.historyChecks[A].push({ name: 'scanner', status: 'completed', conclusion: 'failure' });
    if (fault === 'cancelled-ide') f.history[A].push(run('ide-image', 13, { head_sha: A, conclusion: 'cancelled' }));
    if (fault === 'attempt') f.history[A].push({ ...old, run_attempt: 3, conclusion: 'failure' });
    if (fault === 'run') f.history[A].push({ ...old, id: 14, conclusion: 'failure' });
    if (fault === 'ancestry') { f.runtimeHistory = []; f.addRuntime(C, 23); }
    if (fault === 'fork') old.head_repository = { full_name: 'other/trade' };
    if (fault === 'event') old.event = 'workflow_dispatch';
    if (fault === 'legacy') f.artifacts[12] = [];
    await f.go(); assert.deepEqual(f.records, [withheld], fault);
  }
});

test('runtime history is paginated past old invalid entries', async () => {
  const f = fixture(); f.runtimeHistory.unshift(...Array.from({ length: 110 }, (_, i) => run('runtime-image', i + 200, { head_sha: A, event: 'workflow_dispatch' })));
  await f.go(); assert.deepEqual(f.records, [admitted]); assert.equal(f.calls.runtimePages, 1);
});

test('different historical Dockerfiles are skipped before parsing and do not block later matching runtimes', async () => {
  const historical = `${dockerfile}\nRUN printf old \\\n  runtime\n`;
  for (const matching of [false, true]) {
    const f = fixture(); f.setInput(A, 'engine/runtime/Dockerfile', historical);
    if (matching) {
      const candidate = f.addRuntime(B, 3);
      f.runtimeHistory = [f.history[A].find((item) => item.name === 'runtime-image'), candidate];
    }
    await f.go();
    assert.deepEqual(f.records, [matching ? admitted : withheld]);
    assert.ok(!f.calls.blobs.includes(blobSha(historical)));
    assert.deepEqual(f.calls.blobs, [blobSha(dockerfile)]);
  }
});

test('a historical commit without the runtime Dockerfile is skipped, a target without one fails', async () => {
  for (const matching of [false, true]) {
    const f = fixture(); f.trees[A] = f.trees[A].filter((item) => item.path !== 'engine/runtime/Dockerfile');
    if (matching) {
      const candidate = f.addRuntime(B, 3);
      f.runtimeHistory = [f.history[A].find((item) => item.name === 'runtime-image'), candidate];
    }
    await f.go();
    assert.deepEqual(f.records, [matching ? admitted : withheld]);
  }
  const target = fixture(); target.trees[B] = target.trees[B].filter((item) => item.path !== 'engine/runtime/Dockerfile');
  await assert.rejects(target.go(), /Runtime Dockerfile is missing/); assert.deepEqual(target.records, []);
});

test('Dockerfile prefilter does not hide incomplete trees, target parser failures or matching-candidate defects', async () => {
  const target = fixture();
  target.setInput(B, 'engine/runtime/Dockerfile', `${dockerfile}\nRUN printf target \\\n  runtime\n`);
  await assert.rejects(target.go(), /continued Dockerfile/); assert.deepEqual(target.records, []);

  const incomplete = fixture();
  incomplete.setInput(A, 'engine/runtime/Dockerfile', `${dockerfile}\n# distinct historical Dockerfile\n`);
  incomplete.truncated.add(A);
  await assert.rejects(incomplete.go(), /tree is incomplete/); assert.deepEqual(incomplete.records, []);

  const malformed = fixture(); malformed.setInput(A, 'engine/run.py', '../external', '120000');
  await assert.rejects(malformed.go(), /regular tracked file/); assert.deepEqual(malformed.records, []);

  const identity = fixture(); const getCommit = identity.github.rest.git.getCommit;
  identity.github.rest.git.getCommit = async (args) => {
    const result = await getCommit(args);
    if (args.commit_sha === A) result.data.sha = C;
    return result;
  };
  await assert.rejects(identity.go(), /commit identity/); assert.deepEqual(identity.records, []);

  const transport = fixture(); const getBlob = transport.github.rest.git.getBlob;
  transport.github.rest.git.getBlob = async (args) => {
    if (transport.calls.blobs.length === 1) throw Error('fixture transport unavailable');
    return getBlob(args);
  };
  await assert.rejects(transport.go(), /fixture transport unavailable/); assert.deepEqual(transport.records, []);
});

test('late ancestor callback rechecks the newer channel source and uses its web artifact', async () => {
  const f = fixture(); f.previous = { ...withheld, revision: C };
  await f.go(); assert.deepEqual(f.records, [{ ...admitted, revision: C }]);
  assert.ok(f.calls.pushes.includes(C)); assert.ok(f.calls.checks.includes(C));
  const failed = fixture(); failed.previous = { ...admitted, revision: C };
  failed.historyChecks[C].push({ name: 'scanner', status: 'completed', conclusion: 'failure' });
  await failed.go(); assert.deepEqual(failed.records, [{ ...withheld, revision: C }]);
});

test('CAS conflict rereads the newer source and current qualifications without rollback', async () => {
  const f = fixture(); f.conflict = () => {
    f.previous = { ...admitted, revision: C };
    f.historyChecks[C].push({ name: 'scanner', status: 'completed', conclusion: 'failure' });
  };
  await f.go(); assert.deepEqual(f.records, [{ ...withheld, revision: C }]); assert.ok(f.calls.checks.includes(C));
  const g = fixture(); g.conflict = () => {
    g.previous = { ...withheld };
    g.historyChecks[A].push({ name: 'late-check', status: 'completed', conclusion: 'failure' });
  };
  await g.go(); assert.deepEqual(g.records, []); // Already withheld after fresh ancestor qualification.
  assert.equal(g.calls.checks.filter((sha) => sha === A).length, 2);
});

test('a candidate skipped for one target can match the newer target after a CAS conflict', async () => {
  const f = fixture(); const other = `${dockerfile}\n# another reviewed Dockerfile\n`;
  f.setInput(A, 'engine/runtime/Dockerfile', other); f.setInput(C, 'engine/runtime/Dockerfile', other);
  const current = f.addRuntime(B, 3);
  f.runtimeHistory = [f.history[A].find((item) => item.name === 'runtime-image'), current];
  f.conflict = () => { f.previous = { ...withheld, revision: C }; };
  await f.go();
  assert.deepEqual(f.records, [{ ...admitted, revision: C }]);
  assert.deepEqual(f.calls.blobs, [blobSha(dockerfile), blobSha(other), blobSha(other)]);
});

test('incomplete trees and unbound Dockerfile bytes fail closed through the real projection helper', async () => {
  const f = fixture(); f.setInput(B, 'service/web.py', '# distinct target tree\n'); f.truncated.add(B);
  await assert.rejects(f.go(), /tree is incomplete/); assert.deepEqual(f.records, []);
  const g = fixture(); g.blobs[blobSha(dockerfile)] = `${dockerfile}\n# changed without matching blob identity\n`;
  await assert.rejects(g.go(), /Command failed|blob identity/); assert.deepEqual(g.records, []);
});

const tag = (name, sha) => ({ name, commit: { sha } });
const DEPLOYED = 'admitted to deploy-ready; the host switches on its next release tick';

test('the commit of the newest version is admitted to deploy-ready with one production deployment record', async () => {
  const f = fixture(); f.tags = [tag('v0.2.0', B)]; await f.go();
  assert.deepEqual(f.records, [admitted]); assert.deepEqual(f.deployed, [admitted]);
  assert.deepEqual(f.parents, { 'main-ready': ['main-ready-tip'], 'deploy-ready': ['deploy-ready-tip'] });
  assert.equal(f.deployments.length, 1);
  const [deployment] = f.deployments;
  assert.equal(deployment.ref, 'v0.2.0'); assert.equal(deployment.environment, 'production');
  assert.equal(deployment.auto_merge, false); assert.deepEqual(deployment.required_contexts, []);
  assert.deepEqual(deployment.statuses, [{ state: 'success', environment: 'production', description: DEPLOYED }]);
  // The same decision again appends nothing and records no second deployment.
  f.previous = admitted; f.production = admitted; await f.go();
  assert.deepEqual(f.deployed, [admitted]); assert.equal(f.deployments.length, 1);
  // A tag push, schedule or dispatch has no workflow_run and reaches the version too; a missing channel is created.
  const g = fixture(); g.tags = [tag('v0.2.0', B)]; g.production = null; g.context.payload = {}; await g.go();
  assert.deepEqual(g.deployed, [admitted]); assert.equal(g.deployments.length, 1);
});

test('a newer untagged main build moves only main-ready, also while it is still running', async () => {
  for (const running of [false, true]) {
    const f = fixture(); f.tags = [tag('v0.2.0', B)]; f.production = admitted;
    f.context.payload.workflow_run = run('quality', 21, { head_sha: C });
    if (running) f.history[C].push(run('ide-web', 24, { head_sha: C, status: 'in_progress', conclusion: null }));
    await f.go();
    const decision = running ? { ...withheld, revision: C } : { ...admitted, revision: C };
    assert.deepEqual(f.records, [decision], `running ${running}`);
    assert.deepEqual(f.deployed, []); assert.deepEqual(f.deployments, []);
    assert.ok(!f.calls.pushes.includes(B), 'the version commit is not even re-read');
  }
});

test('an admitted revision keeps its recorded digests after its artifacts expire; a first decision still needs them', async () => {
  const f = fixture(); f.tags = [tag('v0.2.0', B)]; f.previous = admitted; f.production = admitted; f.context.payload = {};
  f.artifact.expired = true; f.artifacts[12][0].expired = true;
  await f.go(); assert.deepEqual(f.records, []); assert.deepEqual(f.deployed, []); assert.deepEqual(f.deployments, []);
  const g = fixture(); g.tags = [tag('v0.2.0', B)]; g.production = withheld; g.context.payload = {}; g.artifact.expired = true;
  await assert.rejects(g.go(), /no matching attempt artifact/); assert.deepEqual(g.deployed, []);
});

test('a rerun of the version commit withholds it on both channels and records no deployment', async () => {
  const f = fixture(); f.tags = [tag('v0.2.0', B)]; f.previous = admitted; f.production = admitted;
  f.runs.push(run('quality', 9, { workflow_id: 1, status: 'in_progress', conclusion: null }));
  await f.go();
  assert.deepEqual(f.records, [withheld]); assert.deepEqual(f.deployed, [withheld]); assert.deepEqual(f.deployments, []);
});

test('only v0.2.0 or later versions on main count: v0.1.0, other names and tags off main are ignored', async () => {
  const f = fixture(); f.context.payload = {};
  f.tags = [tag('v0.1.0', B), tag('v0.2', B), tag('v0.2.0-rc1', B), tag('0.2.0', B), tag('archive/metrics', B),
    tag('v9.0.0', 'd'.repeat(40))];
  await f.go();
  assert.deepEqual(f.records, [admitted]); assert.deepEqual(f.deployed, []); assert.deepEqual(f.deployments, []);
});

test('the highest version wins by number, and a version behind deploy-ready is ignored without falling back', async () => {
  const f = fixture(); f.context.payload = {}; f.tags = [tag('v0.9.0', B), tag('v0.10.0', C)];
  await f.go(); assert.deepEqual(f.deployed, [{ ...admitted, revision: C }]);
  assert.equal(f.deployments[0].ref, 'v0.10.0');
  const g = fixture(); g.context.payload = {}; g.production = { ...admitted, revision: C };
  g.tags = [tag('v0.3.0', B), tag('v0.2.0', C)];
  await g.go(); assert.deepEqual(g.records, [admitted]); assert.deepEqual(g.deployed, []); assert.deepEqual(g.deployments, []);
});

test('a version whose commit has a red check is withheld from deploy-ready and records no deployment', async () => {
  const f = fixture(); f.tags = [tag('v0.2.0', B)];
  f.checks.push({ name: 'scanner', app: { slug: 'scanner' }, status: 'completed', conclusion: 'failure' });
  await f.go(); assert.deepEqual(f.deployed, [withheld]); assert.deepEqual(f.deployments, []);
  const g = fixture(); g.tags = [tag('v0.2.0', B)]; g.production = null;
  g.runs.push(run('ide-web', 3, { conclusion: 'failure' }));
  await g.go(); assert.deepEqual(g.deployed, [withheld]); assert.deepEqual(g.deployments, []);
});
