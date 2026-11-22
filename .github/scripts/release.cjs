// The release workflow's last step: once main-ready admitted the commit that carries a version's product, create the
// GitHub release (and with it the version tag) on that commit and wake release-ready, which admits it to deploy-ready.
// A tag created with the workflow's token starts no workflow, so release-ready is dispatched instead of woken by it.
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const STAGING = 'main-ready';
const MINUTE = 60 * 1000;

const atOrAfter = async (github, repo, before, after) => ['identical', 'ahead'].includes(
  (await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${before}...${after}` })).data.status);

async function pushRuns(github, repo, sha) {
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { ...repo, head_sha: sha, event: 'push', per_page: 100 });
  return runs.filter((run) => run.event === 'push' && run.head_branch === 'main' && run.head_sha === sha
    && run.head_repository?.full_name?.toLowerCase() === 'qoeop/trade');
}

// The newest main commit at or before `merged` that built the product images. A commit that changes only documentation
// builds none (CHANGELOG.md), so a version raised earlier is released on the newest commit that did.
async function product(github, repo, merged) {
  for (let page = 1; page <= 5; page++) {
    const runs = (await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: 'ide-image.yml', branch: 'main',
      event: 'push', per_page: 100, page })).data.workflow_runs;
    for (const run of runs) {
      if (run.event === 'push' && run.head_branch === 'main' && SHA.test(run.head_sha)
          && run.head_repository?.full_name?.toLowerCase() === 'qoeop/trade'
          && await atOrAfter(github, repo, run.head_sha, merged)) return run.head_sha;
    }
    if (runs.length < 100) break;
  }
  throw Error(`No main commit at or before ${merged} built the product images`);
}

// main-ready's last decision about `sha`: 'admitted', 'withheld', 'passed' (the channel moved past it without one) or
// null (none yet). Records are read newest first until one is about an earlier commit; records made after `before`
// are left out.
async function staged(github, repo, sha, before) {
  const commits = (await github.rest.repos.listCommits({ ...repo, sha: STAGING, per_page: 30 })).data;
  let passed = false;
  for (const commit of commits) {
    if (before && Date.parse(commit.commit.committer.date) > before) continue;
    const file = await github.rest.repos.getContent({ ...repo, path: 'release.json', ref: commit.sha });
    const record = JSON.parse(Buffer.from(file.data.content, 'base64').toString('utf8'));
    if (!SHA.test(record.revision)) throw Error(`Invalid ${STAGING} record`);
    if (record.revision === sha) return record.image ? 'admitted' : 'withheld';
    if (!await atOrAfter(github, repo, sha, record.revision)) break;
    passed = true;
  }
  return passed ? 'passed' : null;
}

module.exports = async function release({ github, context, core, version, merged, notes,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)), now = Date.now, minutes = 180 }) {
  const repo = context.repo;
  if (`${repo.owner}/${repo.repo}`.toLowerCase() !== 'qoeop/trade') throw Error('Unexpected repository');
  if (!VERSION.test(version) || !SHA.test(merged) || !notes.trim()) throw Error('A version, its merged commit and its notes are required');
  const deadline = now() + minutes * MINUTE;
  const wait = async (what) => {
    if (now() > deadline) throw Error(`Gave up after ${minutes} minutes waiting for ${what}`);
    await sleep(MINUTE);
  };
  // quality runs on every main push: once it exists, so do the commit's other push runs.
  while (!(await pushRuns(github, repo, merged)).some((run) => run.name === 'quality')) await wait(`the push runs of ${merged}`);
  const sha = await product(github, repo, merged);
  const file = await github.rest.repos.getContent({ ...repo, path: 'pyproject.toml', ref: sha });
  const carried = /^version = "([^"]+)"$/m.exec(Buffer.from(file.data.content, 'base64').toString('utf8'))?.[1];
  if (carried !== version) throw Error(`${sha}, the newest commit that built the product, carries ${carried}, not ${version}`);
  // This run's own check lands on the commit it was started on, and release-ready admits a commit only when every
  // check of it passed: while it runs, main-ready withholds that commit. When that commit is the one to release, the
  // decision that counts is the last one made before this run started; release-ready admits the version once this
  // run has ended.
  const before = sha === context.sha
    ? Date.parse((await github.rest.actions.getWorkflowRun({ ...repo, run_id: context.runId })).data.run_started_at) : null;
  core.info(`Releasing v${version} on ${sha}, once ${STAGING} admits it`);
  for (;;) {
    const state = await staged(github, repo, sha, before);
    if (state === 'admitted') break;
    const runs = await pushRuns(github, repo, sha);
    const failed = runs.filter((run) => run.status === 'completed' && run.conclusion !== 'success');
    if (failed.length) throw Error(`${STAGING} cannot admit ${sha}: ${failed.map((run) => `${run.name} ${run.conclusion}`).join(', ')}`);
    if (state === 'passed' && runs.every((run) => run.status === 'completed')) {
      throw Error(`${STAGING} moved past ${sha} without a decision about it; release it by hand once its checks pass`);
    }
    await wait(`${STAGING} to admit ${sha}`);
  }
  await github.rest.repos.createRelease({ ...repo, tag_name: `v${version}`, target_commitish: sha, name: `v${version}`,
    body: notes, make_latest: 'true' });
  await github.rest.actions.createWorkflowDispatch({ ...repo, workflow_id: 'release-ready.yml', ref: 'main' });
  core.info(`Released v${version} on ${sha}; release-ready admits it to deploy-ready`);
};
