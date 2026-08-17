#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { validateDevelopmentChunkRecord } from './lib/development-chunk-record.mjs';

const contract = JSON.parse(
  await readFile(new URL('../lib/architecture-contract.json', import.meta.url), 'utf8'),
);

const inputs = process.argv.slice(2);
let result;

const optionValues = new Map();
const positional = [];
for (let index = 0; index < inputs.length; index += 1) {
  const value = inputs[index];
  if (['--candidate-tree', '--repo', '--verification-context'].includes(value)) {
    const optionValue = inputs[index + 1];
    if (optionValues.has(value) || !optionValue || optionValue.startsWith('--')) {
      positional.push('__INVALID_OPTIONS__');
      break;
    }
    optionValues.set(value, optionValue);
    index += 1;
  } else {
    positional.push(value);
  }
}

const usage = 'usage: validate-development-chunk.mjs --candidate-tree <40hex> --verification-context <context.json> [--repo <git-repository>] [record.json|-]';

if (
  positional.length > 1
  || positional.includes('__INVALID_OPTIONS__')
  || !optionValues.has('--candidate-tree')
  || !optionValues.has('--verification-context')
) {
  result = {
    outcome: 'INVALID',
    reasons: [usage],
  };
} else {
  try {
    const candidateTree = optionValues.get('--candidate-tree');
    if (!/^[0-9a-f]{40}$/.test(candidateTree)) throw new Error('candidate tree must be exactly 40 lowercase hexadecimal characters');
    const repository = resolve(optionValues.get('--repo') ?? process.cwd());
    const git = (args, encoding = 'utf8') => {
      const execution = spawnSync('git', ['-C', repository, ...args], { encoding, maxBuffer: 16 * 1024 * 1024 });
      if (execution.status !== 0) {
        const detail = typeof execution.stderr === 'string'
          ? execution.stderr
          : execution.stderr?.toString('utf8') ?? execution.error?.message ?? '';
        throw new Error(detail.trim() || `git ${args[0]} failed`);
      }
      return execution.stdout;
    };
    if (git(['cat-file', '-t', candidateTree]).trim() !== 'tree') throw new Error('candidate tree authority does not resolve to a Git tree object');

    const verificationContext = JSON.parse(await readFile(optionValues.get('--verification-context'), 'utf8'));
    if (
      verificationContext === null
      || typeof verificationContext !== 'object'
      || Array.isArray(verificationContext)
      || Object.keys(verificationContext).sort().join(',') !== 'candidateTree,verificationContextDigests'
      || verificationContext.candidateTree !== candidateTree
      || verificationContext.verificationContextDigests === null
      || typeof verificationContext.verificationContextDigests !== 'object'
      || Array.isArray(verificationContext.verificationContextDigests)
    ) throw new Error('verification context must exactly bind the supplied candidate tree and per-locator digests');

    let source;
    if (positional.length === 0 || positional[0] === '-') {
      source = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) source += chunk;
    } else {
      source = await readFile(positional[0], 'utf8');
    }
    result = validateDevelopmentChunkRecord(JSON.parse(source), contract, {
      candidateTree,
      verificationContextDigests: verificationContext.verificationContextDigests,
      resolveLocator: (locator) => {
        const listing = git(['ls-tree', '-z', candidateTree, '--', locator], null);
        const text = listing.toString('utf8');
        const match = text.match(/^([0-7]{6}) (blob|tree) ([0-9a-f]{40})\t([^\0]+)\0$/);
        if (!match || match[2] !== 'blob' || match[4] !== locator) throw new Error(`locator is absent or is not one exact blob: ${locator}`);
        return {
          blobId: match[3],
          bytes: git(['cat-file', 'blob', match[3]], null),
        };
      },
    });
  } catch (error) {
    result = {
      outcome: 'INVALID',
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.outcome !== 'VALID') process.exitCode = 1;
