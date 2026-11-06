// CI owns eligibility. The host receives only the main source identity and tested native digest.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SHA = /^[0-9a-f]{40}$/;
const IMAGE = /^ghcr\.io\/qoeop\/trade-ide@sha256:[0-9a-f]{64}$/;
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
    const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { ...repo, head_sha: sha, event: 'push', per_page: 100 });
    const latest = new Map();
    for (const run of runs) {
      if (run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== sha
          || run.head_repository?.full_name?.toLowerCase() !== 'qoeop/trade') continue;
      const previous = latest.get(run.workflow_id);
      if (!previous || run.id > previous.id || (run.id === previous.id && run.run_attempt > previous.run_attempt)) latest.set(run.workflow_id, run);
    }
    const values = [...latest.values()], built = values.find((run) => run.name === 'ide-image');
    if (!built) return; // A documentation-only main commit has no new product image to release.
    let eligible = values.some((run) => run.name === 'quality')
      && values.every((run) => run.status === 'completed' && run.conclusion === 'success');
    const checks = await github.paginate(github.rest.checks.listForRef, { ...repo, ref: sha, filter: 'latest', per_page: 100 });
    const required = checks.filter((check) => !(check.app?.slug === 'github-actions' && ownJobs.has(check.name)));
    eligible &&= required.length > 0 && required.every((check) => check.status === 'completed' && ['success', 'skipped'].includes(check.conclusion));
    const record = { revision: sha, image: null };
    if (eligible) {
      const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { ...repo, run_id: built.id, per_page: 100 });
      // A failed-jobs-only rerun can carry the already successful amd64 job from an earlier attempt.
      // Artifacts are uploaded only after native tests; choose the latest tested execution in this run.
      const native = artifacts.filter((item) => !item.expired && /^web-image-amd64-[1-9][0-9]*$/.test(item.name)
        && Number(item.name.split('-').at(-1)) <= built.run_attempt);
      const artifact = native.sort((a, b) => Number(b.name.split('-').at(-1)) - Number(a.name.split('-').at(-1)))[0];
      if (!artifact || artifact.workflow_run?.head_sha !== sha) throw Error('Successful native run has no matching attempt artifact');
      const download = await github.rest.actions.downloadArtifact({ ...repo, artifact_id: artifact.id, archive_format: 'zip' });
      const image = readArchive(download.data);
      if (image.revision !== sha || !IMAGE.test(image.image)) throw Error('Native artifact identity does not match its admitted source');
      record.image = image.image;
    }
    let previous = null, previousRecord = null;
    try {
      previous = await github.rest.git.getRef({ ...repo, ref: 'heads/deploy-ready' });
    } catch (error) { if (error.status !== 404) throw error; }
    if (previous) {
      const file = await github.rest.repos.getContent({ ...repo, path: 'release.json', ref: previous.data.object.sha });
      previousRecord = JSON.parse(Buffer.from(file.data.content, 'base64').toString('utf8'));
      if (!SHA.test(previousRecord.revision)) throw Error('Invalid previous eligibility source');
      if (!forward(await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${previousRecord.revision}...${sha}` }))) return;
      if (previousRecord.revision === record.revision && previousRecord.image === record.image) return;
    }
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
