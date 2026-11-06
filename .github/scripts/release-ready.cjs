// CI owns eligibility. The host receives only the main source identity and tested native digest.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SHA = /^[0-9a-f]{40}$/;
const IMAGE = /^ghcr\.io\/qoeop\/trade-ide@sha256:[0-9a-f]{64}$/;
const SERVICE = /^ghcr\.io\/qoeop\/trade-service@sha256:[0-9a-f]{64}$/;
const RUNTIME = /^ghcr\.io\/qoeop\/trade-runtime@sha256:[0-9a-f]{64}$/;
const ownJobs = new Set(['release-ready', 'eligibility-tests']);

function archive(bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-image-'));
  try {
    const file = path.join(root, 'image.zip');
    fs.writeFileSync(file, Buffer.from(bytes));
    return JSON.parse(execFileSync('unzip', ['-p', file, 'release.json'], { encoding: 'utf8', maxBuffer: 4096 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const forward = (comparison) => ['identical', 'ahead'].includes(comparison.data.status);

async function testedArtifact(github, repo, built, prefix, sha, readArchive, allowMissing = false) {
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { ...repo, run_id: built.id, per_page: 100 });
  const native = artifacts.filter((item) => !item.expired && item.name.startsWith(`${prefix}-amd64-`)
    && /^[1-9][0-9]*$/.test(item.name.slice(`${prefix}-amd64-`.length))
    && Number(item.name.split('-').at(-1)) <= built.run_attempt);
  const artifact = native.sort((a, b) => Number(b.name.split('-').at(-1)) - Number(a.name.split('-').at(-1)))[0];
  if (!artifact && allowMissing) return null;
  if (!artifact || artifact.workflow_run?.head_sha !== sha) throw Error('Successful native run has no matching attempt artifact');
  const download = await github.rest.actions.downloadArtifact({ ...repo, artifact_id: artifact.id, archive_format: 'zip' });
  const record = readArchive(download.data);
  if (record.revision !== sha) throw Error('Native artifact identity does not match its admitted source');
  return record;
}

async function pushRuns(github, repo, sha) {
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { ...repo, head_sha: sha, event: 'push', per_page: 100 });
  const latest = new Map();
  for (const run of runs) {
    if (run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== sha
        || run.head_repository?.full_name?.toLowerCase() !== 'qoeop/trade') continue;
    const previous = latest.get(run.workflow_id);
    if (!previous || run.id > previous.id || (run.id === previous.id && run.run_attempt > previous.run_attempt)) latest.set(run.workflow_id, run);
  }
  return [...latest.values()];
}

async function green(github, repo, sha, values) {
  if (!values.some((run) => run.name === 'quality')
      || !values.every((run) => run.status === 'completed' && run.conclusion === 'success')) return false;
  const checks = await github.paginate(github.rest.checks.listForRef, { ...repo, ref: sha, filter: 'latest', per_page: 100 });
  const required = checks.filter((check) => !(check.app?.slug === 'github-actions' && ownJobs.has(check.name)));
  return required.length > 0 && required.every((check) => check.status === 'completed' && ['success', 'skipped'].includes(check.conclusion));
}

async function bootstrapRuntime(github, repo, sha, readArchive) {
  const found = await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: 'runtime-image.yml',
    branch: 'main', event: 'push', status: 'success', per_page: 10 });
  for (const run of found.data.workflow_runs) {
    if (run.event !== 'push' || run.head_branch !== 'main'
        || run.head_repository?.full_name?.toLowerCase() !== 'qoeop/trade' || !SHA.test(run.head_sha)) continue;
    if (!forward(await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${run.head_sha}...${sha}` }))) continue;
    const values = await pushRuns(github, repo, run.head_sha);
    const latest = values.find((item) => item.name === 'runtime-image');
    if (!latest || latest.id !== run.id || latest.run_attempt !== run.run_attempt
        || !await green(github, repo, run.head_sha, values)) continue;
    // Legacy workflow versions did not publish a digest artifact. Never infer it from a mutable tag.
    const artifact = await testedArtifact(github, repo, latest, 'runtime-image', run.head_sha, readArchive, true);
    if (!artifact) continue;
    if (!RUNTIME.test(artifact.runtime)) throw Error('Native runtime artifact identity is invalid');
    return artifact.runtime;
  }
  return null;
}

module.exports = async function publish({ github, context, core, readArchive = archive }) {
  const repo = context.repo;
  if (`${repo.owner}/${repo.repo}`.toLowerCase() !== 'qoeop/trade') throw Error('Unexpected publishing repository');
  let subject = context.payload.workflow_run;
  if (subject) {
    if (subject.event !== 'push' || subject.head_branch !== 'main'
        || subject.head_repository?.full_name?.toLowerCase() !== 'qoeop/trade') return;
  } else {
    const found = await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: 'ide-image.yml', branch: 'main',
      event: 'push', per_page: 1 });
    subject = found.data.workflow_runs[0];
    if (!subject) return;
  }
  const sha = subject.head_sha;
  if (!SHA.test(sha)) throw Error('Invalid main source identity');
  for (let attempt = 0; attempt < 3; attempt++) {
    const main = await github.rest.git.getRef({ ...repo, ref: 'heads/main' });
    if (!forward(await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${sha}...${main.data.object.sha}` }))) return;
    const values = await pushRuns(github, repo, sha);
    const built = values.find((run) => run.name === 'ide-image');
    if (!built) return; // A documentation-only main commit has no new product image to release.
    const eligible = await green(github, repo, sha, values);
    let previous = null, previousRecord = null;
    try {
      previous = await github.rest.git.getRef({ ...repo, ref: 'heads/deploy-ready' });
    } catch (error) { if (error.status !== 404) throw error; }
    if (previous) {
      const file = await github.rest.repos.getContent({ ...repo, path: 'release.json', ref: previous.data.object.sha });
      previousRecord = JSON.parse(Buffer.from(file.data.content, 'base64').toString('utf8'));
      if (!SHA.test(previousRecord.revision)) throw Error('Invalid previous eligibility source');
      if (!forward(await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${previousRecord.revision}...${sha}` }))) return;
    }
    // Retain the last admitted runtime even while this source is withheld, so a later callback
    // cannot forget the qualified default when this commit does not rebuild engine packaging.
    const record = { revision: sha, image: null, service: null, runtime: previousRecord?.runtime ?? null };
    if (record.runtime !== null && !RUNTIME.test(record.runtime)) throw Error('Invalid previously admitted runtime');
    if (eligible) {
      const image = await testedArtifact(github, repo, built, 'web-image', sha, readArchive);
      if (!IMAGE.test(image.image) || !SERVICE.test(image.service)) throw Error('Native service/IDE artifact identity is invalid');
      record.image = image.image; record.service = image.service;
      const runtimeRun = values.find((run) => run.name === 'runtime-image');
      if (runtimeRun) {
        const runtime = await testedArtifact(github, repo, runtimeRun, 'runtime-image', sha, readArchive);
        if (!RUNTIME.test(runtime.runtime)) throw Error('Native runtime artifact identity is invalid');
        record.runtime = runtime.runtime;
      }
      if (!record.runtime) record.runtime = await bootstrapRuntime(github, repo, sha, readArchive);
      if (!record.runtime) throw Error('No admitted runtime; first execution release must build it');
    }
    if (previousRecord && JSON.stringify(previousRecord) === JSON.stringify(record)) return;
    const blob = await github.rest.git.createBlob({ ...repo, content: `${JSON.stringify(record)}\n`, encoding: 'utf-8' });
    const tree = await github.rest.git.createTree({ ...repo, tree: [{ path: 'release.json', mode: '100644', type: 'blob', sha: blob.data.sha }] });
    const commit = await github.rest.git.createCommit({ ...repo, message: 'chore(deploy): publish CI eligibility',
      tree: tree.data.sha, parents: previous ? [previous.data.object.sha] : [] });
    try {
      if (previous) await github.rest.git.updateRef({ ...repo, ref: 'heads/deploy-ready', sha: commit.data.sha, force: false });
      else await github.rest.git.createRef({ ...repo, ref: 'refs/heads/deploy-ready', sha: commit.data.sha });
      core.info(`${record.image ? 'Admitted' : 'Withheld'} main Web release ${sha}`);
      return;
    } catch (error) {
      if (![409, 422].includes(error.status)) throw error;
      // A concurrent append won. Re-read source/checks/channel and never force over that decision.
      if (attempt === 2) throw error;
    }
  }
};
